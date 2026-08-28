import test from "node:test";
import assert from "node:assert/strict";
import { BotBeliefModel, BotManager, BOT_NAMES, RuleBasedBangBot, chooseUniqueBotName } from "../server/rule-based-bot.js";
import { BangGame } from "../engine/game.js";

function baseState(overrides = {}) {
  return {
    revision: 1, phase: "playing", turnPhase: "play", currentPlayerId: "bot", bangUsed: 0,
    me: "bot", discardTop: null, characterOptions: [], pending: null, log: [], winners: [],
    players: [
      { id: "bot", nickname: "Bangbot", isBot: true, alive: true, hp: 4, maxHp: 4, handCount: 1, hand: [], equipment: [], distance: null, character: { id: "willy" }, role: { id: "outlaw" } },
      { id: "sheriff", nickname: "보안관", alive: true, hp: 5, maxHp: 5, handCount: 4, equipment: [], distance: 1, character: { id: "bart" }, role: { id: "sheriff" } },
      { id: "other", nickname: "상대", alive: true, hp: 4, maxHp: 4, handCount: 3, equipment: [], distance: 1, character: { id: "paul" }, role: null }
    ],
    ...overrides
  };
}

test("기본 봇 이름은 사용 중인 이름을 제외하고 중복 없이 선택한다", () => {
  const used = new Set();
  for (let index = 0; index < BOT_NAMES.length; index += 1) used.add(chooseUniqueBotName(used, () => 0));
  assert.deepEqual([...used], BOT_NAMES);
  assert.throws(() => chooseUniqueBotName(used, () => 0), /사용할 수 있는 봇 이름/);
});

test("역할 추론은 공개 로그에서 보안관 공격 이력만 소비한다", () => {
  const beliefs = new BotBeliefModel("bot");
  beliefs.consume([
    { id: "l1", meta: { kind: "card", actorId: "suspect", targetId: "sheriff", cardType: "bang" } },
    { id: "l2", meta: { kind: "card", actorId: "helper", targetId: "suspect", cardType: "duel" } }
  ], "sheriff");
  assert.ok(beliefs.estimate("suspect").outlaw >= 5);
  assert.ok(beliefs.estimate("helper").law > 0);
});

test("봇은 판정과 치명 상태의 필수 선택을 우선한다", () => {
  const bot = new RuleBasedBangBot({ id: "bot", random: () => 0.5 });
  const judgment = baseState({ pending: { type: "judgment_wait", responderId: "bot", mine: true, reason: "jail" } });
  assert.deepEqual(bot.chooseAction(judgment), { type: "flipJudgment" });

  const beer = { id: "beer-1", type: "beer", kind: "instant" };
  const dying = baseState({ pending: { type: "dying", responderId: "bot", mine: true }, players: baseState().players.map((player) => player.id === "bot" ? { ...player, hp: 0, hand: [beer], handCount: 1 } : player) });
  assert.deepEqual(bot.chooseAction(dying), { type: "respond", cardId: "beer-1" });
});

test("무법자 봇은 공개 상태만으로 사거리 안의 보안관을 우선 공격한다", () => {
  const bang = { id: "bang-1", type: "bang", kind: "bang", name: "뱅!" };
  const state = baseState({ players: baseState().players.map((player) => player.id === "bot" ? { ...player, hand: [bang], handCount: 1 } : player) });
  const bot = new RuleBasedBangBot({ id: "bot", random: () => 0.2 });
  assert.deepEqual(bot.chooseAction(JSON.parse(JSON.stringify(state))), { type: "play", cardId: "bang-1", targetId: "sheriff" });
});

test("BotManager는 행동을 즉시 실행하지 않고 설정된 지연 뒤 실행한다", async () => {
  const actions = [];
  const state = baseState({ phase: "character_selection", turnPhase: null, currentPlayerId: null, characterOptions: [{ id: "willy", hp: 4 }, { id: "bart", hp: 4 }] });
  const manager = new BotManager({ getState: () => state, perform: async (_id, action) => { actions.push(action); return { ok: true }; }, random: () => 0, minDelayMs: 20, maxDelayMs: 20 });
  manager.add("bot"); manager.poke();
  assert.equal(actions.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(actions.length, 1);
  manager.destroy();
});

test("공개 상태 API만 받은 봇 네 명이 모든 선택·응답 단계를 막힘 없이 진행한다", () => {
  const game = new BangGame(); const bots = new Map();
  for (let index = 0; index < 4; index += 1) {
    const id = `bot-${index}`;
    game.addPlayer({ id, token: `token-${index}`, nickname: BOT_NAMES[index], host: index === 0, isBot: true });
    bots.set(id, new RuleBasedBangBot({ id, random: () => 0.37 + index * 0.03 }));
  }
  const apply = (id, action) => {
    if (action.type === "chooseCharacter") game.chooseCharacter(id, action.characterId);
    else if (action.type === "play") game.playCard(id, action.cardId, action.targetId, action.targetCardId);
    else if (action.type === "respond") game.respond(id, action.cardId ?? null);
    else if (action.type === "endTurn") game.endTurn(id);
    else if (action.type === "discard") game.discardFromHand(id, action.cardId);
    else if (action.type === "flipJudgment") game.flipJudgment(id);
    else if (action.type === "judgment") game.chooseJudgment(id, action.cardId);
    else if (action.type === "kitDraw") game.chooseKit(id, action.cardIds);
    else if (action.type === "drawSource") game.chooseDrawSource(id, action.source);
    else if (action.type === "storePick") game.pickStore(id, action.cardId);
    else if (action.type === "sid") game.useSid(id, action.cardIds);
    else throw new Error(`지원하지 않는 봇 액션: ${action.type}`);
  };

  game.start("bot-0");
  for (const [id, bot] of bots) apply(id, bot.chooseAction(structuredClone(game.viewFor(id))));
  assert.equal(game.phase, "dealing"); game.finishSetup();

  let actions = 0;
  while (game.phase !== "game_over" && actions < 400) {
    let acted = false;
    for (const [id, bot] of bots) {
      const state = structuredClone(game.viewFor(id));
      if (!bot.canAct(state)) continue;
      const action = bot.chooseAction(state);
      assert.ok(action, `${id}가 필요한 선택을 만들지 못했습니다.`);
      apply(id, action); actions += 1; acted = true; break;
    }
    assert.equal(acted, true, `진행 불가 상태: ${game.phase}/${game.turnPhase}/${game.pending?.type ?? "none"}`);
  }
  assert.ok(actions >= 40, "봇들이 충분한 수의 행동을 진행해야 합니다.");
});
