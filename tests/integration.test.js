import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 34000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let child;

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("테스트 서버가 시작되지 않았습니다.");
}

async function waitForSession(expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${base}/api/health`); const health = await response.json();
    if (health.session === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`세션 상태가 ${expected}로 바뀌지 않았습니다.`);
}

async function openEvents(token) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  async function nextEvent(type, predicate = () => true) {
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const eventType = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (eventType === type && data) { const parsed = JSON.parse(data); if (predicate(parsed)) return parsed; }
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`${type} 이벤트를 받기 전에 연결이 종료되었습니다.`);
      buffer += decoder.decode(value, { stream: true });
    }
  }
  return { controller, nextEvent, nextState: (predicate) => nextEvent("state", predicate) };
}

test.before(async () => { child = spawn(process.execPath, ["server/server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), SETUP_DELAY_MS: "10" }, stdio: "ignore" }); await waitForServer(); });
test.after(() => child?.kill());

test("방 생성·4인 참가·token 재접속·비공개 상태 필터링", async () => {
  const host = await post("/api/create", { nickname: "보안관 후보" });
  const guests = [];
  for (let index = 1; index < 4; index += 1) guests.push(await post("/api/join", { sessionId: host.sessionId, nickname: `총잡이 ${index}` }));
  const reconnect = await post("/api/reconnect", { token: guests[0].token }); assert.equal(reconnect.playerId, guests[0].playerId);
  const participants = [host, ...guests]; const clients = [];
  for (const participant of participants) {
    const client = await openEvents(participant.token); await client.nextState((state) => state.phase === "lobby"); clients.push(client);
  }
  await post("/api/action", { token: host.token, action: { type: "start" } });
  for (let index = 0; index < participants.length; index += 1) {
    const selection = await clients[index].nextState((state) => state.phase === "character_selection");
    assert.equal(selection.phase, "character_selection"); assert.equal(selection.characterOptions.length, 2);
    await post("/api/action", { token: participants[index].token, action: { type: "chooseCharacter", characterId: selection.characterOptions[0].id } });
  }
  const state = await clients[1].nextState((item) => item.phase === "playing"); assert.equal(state.players.length, 4);
  assert.ok(state.players.find((player) => player.id === guests[0].playerId).hand.length > 0);
  assert.equal(state.players.find((player) => player.id === host.playerId).hand, undefined);
  assert.equal("deck" in state, false);
  clients.forEach((client) => client.controller.abort());
  await waitForSession(false);
});

test("게임 전 방장이 나가면 참가자가 남아 있어도 세션을 닫는다", async () => {
  const host = await post("/api/create", { nickname: "방장" });
  const guest = await post("/api/join", { sessionId: host.sessionId, nickname: "참가자" });
  const hostClient = await openEvents(host.token); await hostClient.nextState((state) => state.phase === "lobby");
  const guestClient = await openEvents(guest.token); await guestClient.nextState((state) => state.phase === "lobby");
  hostClient.controller.abort();
  const closed = await guestClient.nextEvent("session_closed");
  assert.match(closed.reason, /방장이 나가/);
  await waitForSession(false);
  guestClient.controller.abort();
});
