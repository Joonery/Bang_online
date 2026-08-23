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

async function firstState(token) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events?token=${encodeURIComponent(token)}`, { signal: controller.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = "";
  while (!text.includes("\n\n")) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value); }
  controller.abort();
  const line = text.split("\n").find((item) => item.startsWith("data: ")); return JSON.parse(line.slice(6));
}

test.before(async () => { child = spawn(process.execPath, ["server/server.js"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), SETUP_DELAY_MS: "10" }, stdio: "ignore" }); await waitForServer(); });
test.after(() => child?.kill());

test("방 생성·4인 참가·token 재접속·비공개 상태 필터링", async () => {
  const host = await post("/api/create", { nickname: "보안관 후보" });
  const guests = [];
  for (let index = 1; index < 4; index += 1) guests.push(await post("/api/join", { sessionId: host.sessionId, nickname: `총잡이 ${index}` }));
  const reconnect = await post("/api/reconnect", { token: guests[0].token }); assert.equal(reconnect.playerId, guests[0].playerId);
  await post("/api/action", { token: host.token, action: { type: "start" } });
  for (const participant of [host, ...guests]) {
    const selection = await firstState(participant.token);
    assert.equal(selection.phase, "character_selection"); assert.equal(selection.characterOptions.length, 2);
    await post("/api/action", { token: participant.token, action: { type: "chooseCharacter", characterId: selection.characterOptions[0].id } });
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const state = await firstState(guests[0].token); assert.equal(state.phase, "playing"); assert.equal(state.players.length, 4);
  assert.ok(state.players.find((player) => player.id === guests[0].playerId).hand.length > 0);
  assert.equal(state.players.find((player) => player.id === host.playerId).hand, undefined);
  assert.equal("deck" in state, false);
});
