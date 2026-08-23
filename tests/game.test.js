import test from "node:test";
import assert from "node:assert/strict";
import { BangGame } from "../engine/game.js";
import { BASE_DECK, CHARACTERS, ROLE_SETS } from "../game-data.js";

function readyGame(count = 4) {
  const game = new BangGame();
  for (let index = 0; index < count; index += 1) game.addPlayer({ id: `p${index}`, token: `t${index}`, nickname: `총잡이${index}`, host: index === 0 });
  game.start("p0");
  for (const player of game.players) game.chooseCharacter(player.id, player.characterOptions[0].id);
  game.finishSetup();
  return game;
}

test("공식 카드 80장과 캐릭터 16종을 사용한다", () => {
  assert.equal(BASE_DECK.length, 80);
  assert.equal(CHARACTERS.length, 16);
  assert.equal(BASE_DECK.filter((card) => card.type === "bang").length, 25);
  assert.equal(BASE_DECK.filter((card) => card.type === "missed").length, 12);
  assert.equal(BASE_DECK.filter((card) => card.type === "beer").length, 6);
});

test("역할 배분 뒤 각 플레이어에게 중복 없는 인물 두 장을 제시한다", () => {
  const game = new BangGame();
  for (let index = 0; index < 7; index += 1) game.addPlayer({ id: `s${index}`, token: `st${index}`, nickname: `선택${index}`, host: index === 0 });
  game.start("s0");
  assert.equal(game.phase, "character_selection");
  game.players.forEach((player) => assert.equal(player.characterOptions.length, 2));
  assert.equal(new Set(game.players.flatMap((player) => player.characterOptions.map((item) => item.id))).size, 14);
  const view = game.viewFor(game.players[0].id);
  assert.equal(view.characterOptions.length, 2);
  assert.equal("characterOptions" in view.players[1], false);
});

test("공개 카드의 인스턴스 ID가 카드 종류 ID로 덮어써지지 않는다", () => {
  const game = readyGame(4); const source = game.current().hand[0]; const visible = game.publicCard(source);
  assert.equal(visible.id, source.id); assert.match(visible.id, /^c\d+$/); assert.equal(visible.type, source.type);
});

test("브라우저에 공개한 카드 ID를 그대로 보내 실제 카드를 사용할 수 있다", () => {
  const game = readyGame(4); const player = game.current(); game.pending = null; game.turnPhase = "play";
  const scope = { id: "c-browser-use", type: "scope", suit: "spade", rank: "A" }; player.hand.push(scope);
  game.playCard(player.id, game.publicCard(scope).id);
  assert.equal(player.hand.includes(scope), false); assert.equal(player.equipment.includes(scope), true);
});

test("새 총을 장착하면 확인 절차 없이 기존 총을 버리고 즉시 교체한다", () => {
  const game = readyGame(4); const player = game.current(); game.pending = null; game.turnPhase = "play";
  const oldWeapon = { id: "old-gun", type: "schofield", suit: "club", rank: "J" };
  const newWeapon = { id: "new-gun", type: "remington", suit: "club", rank: "K" };
  player.equipment.push(oldWeapon); player.hand.push(newWeapon);
  game.playCard(player.id, newWeapon.id);
  assert.ok(player.equipment.includes(newWeapon)); assert.ok(game.discard.includes(oldWeapon)); assert.equal(player.hand.includes(newWeapon), false);
});

test("게임 로그의 카드 문양은 영문 대신 아이콘으로 표시한다", () => {
  const game = readyGame(4);
  assert.match(game.cardLabel({ type: "bang", suit: "heart", rank: "A" }), /♥ A/);
  assert.match(game.cardLabel({ type: "bang", suit: "diamond", rank: "7" }), /◆ 7/);
  assert.doesNotMatch(game.cardLabel({ type: "bang", suit: "diamond", rank: "7" }), /diamond/);
});

test("주르도네의 뱅 판정은 카드 뒤집기 입력 전까지 진행되지 않는다", () => {
  const game = readyGame(4); const attacker = game.current(); const target = game.players[1]; game.pending = null;
  target.character = CHARACTERS.find((item) => item.id === "jourdonnais");
  game.deck.push({ id: "jourd-heart", type: "bang", suit: "heart", rank: "A" });
  const before = game.deck.length;
  game.beginBangDefense(target, attacker.id, 1, { kind: "none" });
  assert.equal(game.pending.type, "judgment_wait"); assert.equal(game.pending.context.judgmentSource, "jourdonnais"); assert.equal(game.deck.length, before);
  game.flipJudgment(target.id);
  assert.equal(game.pending, null); assert.equal(game.deck.length, before - 1);
});

for (const reason of ["dynamite", "jail"]) test(`${reason} 판정은 클릭 즉시 결과 문구와 카드를 전체 공개한다`, () => {
  const game = readyGame(4); const player = game.current(); game.pending = null; player.character = CHARACTERS.find((item) => item.id === "willy");
  game.deck.push({ id: `${reason}-heart`, type: "bang", suit: "heart", rank: "A" });
  game.requestJudgment(player, reason); game.flipJudgment(player.id);
  assert.equal(game.announcement.reason, reason); assert.equal(game.announcement.card.id, `${reason}-heart`);
  if (reason === "jail") assert.equal(game.announcement.result, "탈출!");
  else assert.match(game.announcement.result, /님에게로 넘어갑니다/);
  assert.equal(game.viewFor(game.players[1].id).announcement.card.rank, "A");
});

test("감옥 실패와 다이너마이트 폭발 결과 문구도 정확히 공개한다", () => {
  const jailGame = readyGame(4); const jailed = jailGame.current(); jailGame.pending = null; jailed.character = CHARACTERS.find((item) => item.id === "willy");
  jailGame.deck.push({ id: "jail-fail", type: "bang", suit: "spade", rank: "K" });
  jailGame.requestJudgment(jailed, "jail"); jailGame.flipJudgment(jailed.id);
  assert.equal(jailGame.announcement.result, "탈출 실패!");

  const dynamiteGame = readyGame(4); const target = dynamiteGame.current(); dynamiteGame.pending = null; target.character = CHARACTERS.find((item) => item.id === "willy");
  dynamiteGame.deck.push({ id: "dynamite-hit", type: "bang", suit: "spade", rank: "7" });
  dynamiteGame.requestJudgment(target, "dynamite"); dynamiteGame.flipJudgment(target.id);
  assert.equal(dynamiteGame.announcement.result, "폭발!");
});

for (const count of [4, 5, 6, 7]) test(`${count}인 역할 분배와 시작 손패가 정확하다`, () => {
  const game = readyGame(count);
  assert.deepEqual(game.players.map((player) => player.role).sort(), [...ROLE_SETS[count]].sort());
  assert.equal(game.players[0].role, "sheriff");
  assert.equal(game.players[0].hp, game.players[0].character.hp + 1);
  game.players.slice(1).forEach((player) => assert.equal(player.hand.length, player.hp));
  assert.ok(game.players[0].hand.length >= game.players[0].hp);
  const pendingCards = game.pending?.cards?.length ?? 0;
  assert.equal(game.deck.length + game.discard.length + pendingCards + game.players.reduce((sum, player) => sum + player.hand.length + player.equipment.length, 0), 80);
});

test("플레이어별 상태는 상대 손패·숨은 역할·덱 순서를 노출하지 않는다", () => {
  const game = readyGame(5); const viewer = game.players[1]; const view = game.viewFor(viewer.id);
  for (const player of view.players) {
    if (player.id === viewer.id) assert.ok(Array.isArray(player.hand));
    else assert.equal(player.hand, undefined);
    const source = game.player(player.id);
    if (source.role !== "sheriff" && source.id !== viewer.id) assert.equal(player.role, null);
  }
  assert.equal("deck" in view, false);
  assert.equal(view.deckCount, game.deck.length);
});

test("거리 계산에 로즈 둘란·폴 리그레트·조준경·야생마를 적용한다", () => {
  const game = readyGame(4); const [a, b] = game.players;
  a.character = CHARACTERS.find((item) => item.id === "rose"); b.character = CHARACTERS.find((item) => item.id === "paul");
  assert.equal(game.distance(a.id, b.id), 1);
  a.equipment.push({ id: "scope", type: "scope", suit: "spade", rank: "A" });
  b.equipment.push({ id: "mustang", type: "mustang", suit: "heart", rank: "8" });
  assert.equal(game.distance(a.id, b.id), 1);
  a.character = CHARACTERS.find((item) => item.id === "willy");
  assert.equal(game.distance(a.id, b.id), 2);
});

test("잘못된 카드 요청은 상태를 바꾸지 않는다", () => {
  const game = readyGame(4); game.pending = null; game.turnPhase = "play";
  const current = game.current(); const revision = game.revision; const hand = current.hand.map((card) => card.id);
  assert.throws(() => game.playCard(current.id, "not-a-card"), /가지고 있지 않은/);
  assert.equal(game.revision, revision); assert.deepEqual(current.hand.map((card) => card.id), hand);
});

test("캣 벌로우의 잘못된 카드 위치 요청도 손패를 먼저 소모하지 않는다", () => {
  const game = readyGame(4); game.pending = null; game.turnPhase = "play"; const current = game.current(); const target = game.players[1];
  const cat = { id: "cat-test", type: "cat_balou", suit: "heart", rank: "K" }; current.hand = [cat]; target.hand = []; target.equipment = [{ id: "mustang-test", type: "mustang", suit: "heart", rank: "8" }];
  assert.throws(() => game.playCard(current.id, cat.id, target.id), /손에 처리할 카드/);
  assert.deepEqual(current.hand, [cat]); assert.equal(game.discard.includes(cat), false);
});

test("pending interaction은 응답자에게만 선택 카드를 공개한다", () => {
  const game = readyGame(4); const responder = game.players[1];
  const cards = [game.drawOne(), game.drawOne()]; game.pending = { type: "judgment_choice", responderId: responder.id, reason: "jail", cards, context: {} };
  const mine = game.viewFor(responder.id).pending; const other = game.viewFor(game.players[2].id).pending;
  assert.equal(mine.mine, true); assert.equal(mine.cards.length, 2);
  assert.equal(other.mine, false); assert.equal(other.cards, undefined);
});

test("키트 칼슨이 고르지 않은 카드는 덱 맨 위로 돌아간다", () => {
  const game = readyGame(4); const player = game.current();
  const cards = [game.drawOne(), game.drawOne(), game.drawOne()]; game.pending = { type: "kit_draw", responderId: player.id, cards };
  game.chooseKit(player.id, [cards[0].id, cards[1].id]);
  assert.equal(game.deck.at(-1).id, cards[2].id);
});

test("시드 케첨은 다른 플레이어 차례에도 카드 두 장으로 회복한다", () => {
  const game = readyGame(4); game.pending = null; const sid = game.players[1];
  sid.character = CHARACTERS.find((item) => item.id === "sid"); sid.hp = sid.maxHp - 1; const ids = sid.hand.slice(0, 2).map((card) => card.id);
  game.useSid(sid.id, ids);
  assert.equal(sid.hp, sid.maxHp); assert.equal(sid.hand.some((card) => ids.includes(card.id)), false);
});

test("기관총은 술통과 주르도네의 뱅! 판정을 유발하지 않는다", () => {
  const game = readyGame(4); game.pending = null; const target = game.players[1];
  target.character = CHARACTERS.find((item) => item.id === "jourdonnais"); target.equipment.push({ id: "barrel-test", type: "barrel", suit: "spade", rank: "Q" });
  game.resume({ kind: "attack-queue", type: "gatling", attackerId: game.current().id, queue: [target.id], position: 0 });
  assert.equal(game.pending.type, "bang"); assert.equal(game.pending.responderId, target.id);
});

test("생존자가 두 명뿐이면 쓰러진 플레이어도 맥주를 쓸 수 없다", () => {
  const game = readyGame(4); const dying = game.players[1]; game.players[2].alive = false; game.players[3].alive = false;
  const beer = { id: "beer-test", type: "beer", suit: "heart", rank: "6" }; dying.hand.push(beer); dying.hp = 0;
  game.pending = { type: "dying", responderId: dying.id, attackerId: game.current().id, continuation: { kind: "none" } };
  assert.throws(() => game.respond(dying.id, beer.id), /두 명뿐/); assert.ok(dying.hand.includes(beer));
});

test("엘 그링고가 자신이 시작한 결투에서 지면 상대 손패를 가져오지 않는다", () => {
  const game = readyGame(4); const el = game.players[1]; const opponent = game.players[2];
  el.character = CHARACTERS.find((item) => item.id === "elgringo"); const before = el.hand.length; const opponentBefore = opponent.hand.length;
  game.pending = { type: "duel", responderId: el.id, otherId: opponent.id, initiatorId: el.id };
  game.respond(el.id, null);
  assert.equal(el.hand.length, before); assert.equal(opponent.hand.length, opponentBefore);
});

test("보안관 생존 중 무법자와 배신자가 모두 제거되면 보안관 진영이 승리한다", () => {
  const game = readyGame(5);
  game.players.forEach((player) => { if (["outlaw", "renegade"].includes(player.role)) player.alive = false; });
  assert.equal(game.checkVictory(), true); assert.deepEqual(game.winners, ["sheriff", "deputy"]); assert.equal(game.phase, "game_over");
});

test("보안관 사망 시 배신자 단독 생존이 아니면 무법자가 승리한다", () => {
  const game = readyGame(4); game.players.find((player) => player.role === "sheriff").alive = false;
  assert.equal(game.checkVictory(), true); assert.deepEqual(game.winners, ["outlaw"]);
});
