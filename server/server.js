import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { BangGame } from "../engine/game.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const assetRoot = join(root, "src");
const docsRoot = join(root, "docs");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".svg": "image/svg+xml"
};
let session = null;
let setupTimer = null;
const streams = new Map();
const id = (bytes = 12) => randomBytes(bytes).toString("base64url");

function closeSession(activeSession, reason) {
  if (!activeSession || session !== activeSession) return false;
  session = null;
  if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
  const responses = [...streams.values()];
  streams.clear();
  for (const response of responses) {
    writeEvent(response, "session_closed", { reason });
    response.end();
  }
  return true;
}

function makeSession(nickname) {
  if (session) closeSession(session, "새로운 방이 열렸습니다.");
  const game = new BangGame(); const playerId = id(8); const token = id(24);
  game.addPlayer({ id: playerId, token, nickname, host: true });
  session = { id: id(9), game, chat: [], createdAt: Date.now() };
  return { playerId, token };
}

function playerByToken(token) { return session?.game.players.find((player) => player.token === token) ?? null; }
function requirePlayer(token) { const player = playerByToken(token); if (!player) throw new Error("세션이 만료되었거나 올바르지 않습니다."); return player; }
function stateFor(player, includeHistory = false) {
  const view = { ...session.game.viewFor(player.id), sessionId: session.id };
  if (includeHistory) return { ...view, chat: session.chat };
  view.logDelta = view.log.slice(-10); delete view.log;
  return view;
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) { body += chunk; if (body.length > 32_768) throw new Error("요청이 너무 큽니다."); }
  try { return body ? JSON.parse(body) : {}; } catch { throw new Error("올바른 JSON 요청이 아닙니다."); }
}

function writeEvent(response, type, data) { response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
function pushState(player) { const response = streams.get(player.token); if (response) writeEvent(response, "state", stateFor(player)); }
function broadcast() { if (!session) return; session.game.players.forEach(pushState); }

function action(player, payload) {
  const game = session.game; const type = payload?.type;
  if (type === "start") game.start(player.id);
  else if (type === "chooseCharacter") game.chooseCharacter(player.id, payload.characterId);
  else if (type === "play") game.playCard(player.id, payload.cardId, payload.targetId, payload.targetCardId);
  else if (type === "respond") game.respond(player.id, payload.cardId || null);
  else if (type === "endTurn") game.endTurn(player.id);
  else if (type === "discard") game.discardFromHand(player.id, payload.cardId);
  else if (type === "flipJudgment") game.flipJudgment(player.id);
  else if (type === "judgment") game.chooseJudgment(player.id, payload.cardId);
  else if (type === "kitDraw") game.chooseKit(player.id, payload.cardIds);
  else if (type === "drawSource") game.chooseDrawSource(player.id, payload.source);
  else if (type === "storePick") game.pickStore(player.id, payload.cardId);
  else if (type === "sid") game.useSid(player.id, payload.cardIds);
  else throw new Error("알 수 없는 행동입니다.");
}

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true, session: Boolean(session), uptime: Math.round(process.uptime()) });
  if (request.method === "GET" && url.pathname === "/api/events") {
    const player = requirePlayer(url.searchParams.get("token"));
    const activeSession = session;
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const old = streams.get(player.token); if (old && old !== response) old.end();
    streams.set(player.token, response); player.connected = true; writeEvent(response, "state", stateFor(player, true)); broadcast();
    request.on("close", () => {
      if (streams.get(player.token) !== response) return;
      streams.delete(player.token); player.connected = false;
      const hostLeftLobby = activeSession.game.phase === "lobby" && player.id === activeSession.game.hostId;
      const everyoneLeft = activeSession.game.players.every((item) => !item.connected);
      if (hostLeftLobby) closeSession(activeSession, "게임 시작 전에 방장이 나가 방이 닫혔습니다.");
      else if (everyoneLeft) closeSession(activeSession, "모든 참가자가 나가 방이 닫혔습니다.");
      else if (session === activeSession) broadcast();
    });
    return;
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "허용되지 않은 요청입니다." });
  const body = await readJson(request);
  if (url.pathname === "/api/create") {
    if (session && session.game.phase !== "game_over") throw new Error("이미 진행 중인 방이 있습니다.");
    const { token, playerId } = makeSession(body.nickname);
    const origin = `${request.headers["x-forwarded-proto"] || "http"}://${request.headers.host}`;
    return sendJson(response, 200, { token, playerId, sessionId: session.id, inviteUrl: `${origin}/?join=${session.id}` });
  }
  if (url.pathname === "/api/join") {
    if (!session || body.sessionId !== session.id) throw new Error("존재하지 않거나 만료된 초대 링크입니다.");
    const playerId = id(8); const token = id(24); session.game.addPlayer({ id: playerId, token, nickname: body.nickname });
    broadcast(); return sendJson(response, 200, { token, playerId, sessionId: session.id });
  }
  if (url.pathname === "/api/reconnect") {
    const player = requirePlayer(body.token); return sendJson(response, 200, { ok: true, playerId: player.id, sessionId: session.id });
  }
  if (url.pathname === "/api/action") {
    const player = requirePlayer(body.token); action(player, body.action); broadcast();
    if (session.game.phase === "dealing" && !setupTimer) {
      const activeSession = session;
      const delay = Math.max(10, Number(process.env.SETUP_DELAY_MS || 2200));
      setupTimer = setTimeout(() => {
        setupTimer = null;
        if (session === activeSession && session.game.phase === "dealing") { session.game.finishSetup(); broadcast(); }
      }, delay);
    }
    return sendJson(response, 200, { ok: true });
  }
  if (url.pathname === "/api/chat") {
    const player = requirePlayer(body.token); const text = String(body.text ?? "").trim().slice(0, 300); if (!text) throw new Error("메시지를 입력하세요.");
    const message = { id: id(6), playerId: player.id, nickname: player.nickname, text, at: Date.now() }; session.chat.push(message); if (session.chat.length > 160) session.chat.shift();
    for (const stream of streams.values()) writeEvent(stream, "chat", message);
    return sendJson(response, 200, { ok: true });
  }
  if (url.pathname === "/api/restart") {
    const player = requirePlayer(body.token); if (player.id !== session.game.hostId || session.game.phase !== "game_over") throw new Error("게임이 끝난 뒤 방장만 새 게임을 시작할 수 있습니다.");
    if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
    const oldHostId = session.game.hostId;
    const oldPlayers = session.game.players.map(({ id: pid, token: ptoken, nickname, connected }) => ({ id: pid, token: ptoken, nickname, connected }));
    const game = new BangGame(); oldPlayers.forEach((item) => { const added = game.addPlayer({ ...item, host: item.id === oldHostId }); added.connected = item.connected; });
    session.game = game; session.chat = []; broadcast(); return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: "API를 찾을 수 없습니다." });
}

async function serveFile(response, pathname) {
  let base = publicRoot; let relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (pathname.startsWith("/assets/")) { base = assetRoot; relative = pathname.slice("/assets/".length); }
  if (pathname === "/game-data.js") { base = root; relative = "game-data.js"; }
  if (pathname === "/docs/rulebook.pdf") { base = docsRoot; relative = "뱅 룰북 한글판.pdf"; }
  const resolved = normalize(join(base, relative));
  if (!resolved.startsWith(normalize(base))) return sendJson(response, 403, { error: "잘못된 경로입니다." });
  try {
    const info = await stat(resolved); if (!info.isFile()) throw new Error(); const data = await readFile(resolved); const extension = extname(resolved).toLowerCase();
    const immutable = pathname.startsWith("/assets/");
    response.writeHead(200, {
      "content-type": mime[extension] || "application/octet-stream", "content-length": data.length,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
    }); response.end(data);
  } catch { sendJson(response, 404, { error: "파일을 찾을 수 없습니다." }); }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try { if (url.pathname.startsWith("/api/")) await api(request, response, url); else await serveFile(response, decodeURIComponent(url.pathname)); }
  catch (error) { if (!response.headersSent) sendJson(response, 400, { error: error.message || "요청을 처리하지 못했습니다." }); else response.end(); }
});

const heartbeat = setInterval(() => { for (const response of streams.values()) response.write(": keepalive\n\n"); }, 25_000); heartbeat.unref();
server.listen(port, host, () => console.log(`BANG! Online listening on http://${host}:${port}`));

export { server };
