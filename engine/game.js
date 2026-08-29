import { randomInt } from "node:crypto";
import { BASE_DECK, CARD_INFO, CHARACTERS, ROLE_SETS, ROLES } from "../game-data.js";

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export class BangGame {
  constructor() { this.reset(); }

  reset() {
    this.phase = "lobby";
    this.players = [];
    this.hostId = null;
    this.deck = [];
    this.discard = [];
    this.turnIndex = 0;
    this.turnPhase = null;
    this.pending = null;
    this.bangUsed = 0;
    this.log = [];
    this.winners = [];
    this.announcement = null;
    this.revision = 0;
    this.serial = 0;
  }

  addPlayer({ id, token, nickname, host = false, isBot = false }) {
    assert(this.phase === "lobby", "게임이 시작되어 참가할 수 없습니다.");
    assert(this.players.length < 7, "방이 가득 찼습니다.");
    const clean = String(nickname ?? "").trim().slice(0, 18);
    assert(clean.length >= 1, "닉네임을 입력하세요.");
    assert(!this.players.some((p) => p.nickname.toLowerCase() === clean.toLowerCase()), "이미 사용 중인 닉네임입니다.");
    const player = { id, token, nickname: clean, connected: Boolean(isBot), isBot: Boolean(isBot), alive: true, role: null, character: null, hp: 0, maxHp: 0, hand: [], equipment: [], bangUsed: 0 };
    this.players.push(player);
    if (host || !this.hostId) this.hostId = id;
    this.addLog(`${clean}${isBot ? " 봇" : "님"}이 방에 참가했습니다.`, "system", { kind: "join", playerId: id, isBot: Boolean(isBot) });
    return player;
  }

  start(playerId) {
    assert(this.phase === "lobby", "이미 시작한 게임입니다.");
    assert(playerId === this.hostId, "방장만 게임을 시작할 수 있습니다.");
    assert(this.players.length >= 4 && this.players.length <= 7, "4~7명이 모여야 시작할 수 있습니다.");
    // 참가 순서가 테이블 거리로 고정되지 않도록 매 게임마다 먼저 자리를 섞는다.
    this.players = shuffle(this.players);
    const roles = shuffle(ROLE_SETS[this.players.length]);
    this.players.forEach((player, index) => {
      player.role = roles[index];
      player.character = null;
      player.characterOptions = [];
      player.maxHp = 0;
      player.hp = 0;
      player.alive = true;
      player.hand = [];
      player.equipment = [];
    });
    const sheriff = this.players.findIndex((p) => p.role === "sheriff");
    this.players = [...this.players.slice(sheriff), ...this.players.slice(0, sheriff)];
    this.turnIndex = 0;
    const choices = shuffle(CHARACTERS);
    this.players.forEach((player, index) => { player.characterOptions = choices.slice(index * 2, index * 2 + 2); });
    this.phase = "character_selection";
    this.turnPhase = null;
    this.addLog(`역할 배분이 완료되었습니다. 보안관은 ${this.players[0].nickname}님입니다.`, "important");
    this.addLog("각 플레이어가 인물 카드 두 장 중 한 장을 선택합니다.", "system");
  }

  chooseCharacter(playerId, characterId) {
    assert(this.phase === "character_selection", "지금은 인물을 선택할 수 없습니다.");
    const player = this.player(playerId);
    assert(player && !player.character, "이미 인물을 선택했습니다.");
    const character = player.characterOptions.find((item) => item.id === characterId);
    assert(character, "제시된 인물 카드 중 한 장을 선택하세요.");
    player.character = character;
    player.characterOptions = [];
    this.addLog(`${player.nickname}님이 ${character.name}을(를) 선택했습니다.`, "ability");
    if (this.players.some((item) => !item.character)) { this.revision += 1; return; }
    this.dealStartingHands();
  }

  dealStartingHands() {
    assert(this.phase === "character_selection", "손패를 분배할 준비가 되지 않았습니다.");
    this.deck = shuffle(BASE_DECK.map((card) => ({ ...card, id: `c${++this.serial}` })));
    this.discard = [];
    this.players.forEach((player) => {
      player.maxHp = this.maximumHp(player);
      player.hp = player.maxHp;
      for (let n = 0; n < player.hp; n += 1) player.hand.push(this.drawOne());
    });
    this.phase = "dealing";
    this.addLog("인물 선택이 완료되어 시작 손패를 분배합니다.", "important");
  }

  finishSetup() {
    assert(this.phase === "dealing", "게임을 시작할 준비가 되지 않았습니다.");
    this.phase = "playing";
    this.addLog("모든 준비가 끝났습니다. BANG! 게임을 시작합니다.", "important");
    this.beginTurn();
  }

  addLog(text, tone = "normal", meta = null) {
    this.log.push({ id: `l${++this.serial}`, text, tone, at: Date.now(), ...(meta ? { meta } : {}) });
    if (this.log.length > 240) this.log.shift();
    this.revision += 1;
  }

  current() { return this.players[this.turnIndex]; }
  player(id) { return this.players.find((p) => p.id === id); }
  alive() { return this.players.filter((p) => p.alive); }
  cardInfo(card) { return CARD_INFO[card.type]; }

  drawOne() {
    if (!this.deck.length) {
      assert(this.discard.length > 1, "카드 더미에 카드가 부족합니다.");
      const top = this.discard.pop();
      this.deck = shuffle(this.discard.splice(0));
      this.discard.push(top);
      this.addLog("버린 카드 더미를 섞어 새 카드 더미를 만들었습니다.", "system");
    }
    return this.deck.pop();
  }

  draw(player, count, publicText = true) {
    for (let n = 0; n < count; n += 1) player.hand.push(this.drawOne());
    if (publicText) this.addLog(`${player.nickname}님이 카드 ${count}장을 가져왔습니다.`);
  }

  discardCard(card) { this.discard.push(card); }

  beginTurn() {
    if (this.phase !== "playing") return;
    const current = this.current();
    if (!current?.alive) return this.advanceTurn();
    this.turnPhase = "start";
    this.pending = null;
    this.bangUsed = 0;
    this.addLog(`${current.nickname}님의 차례입니다.`, "turn", { kind: "turn", playerId: current.id });
    if (this.equipment(current, "dynamite")) return this.requestJudgment(current, "dynamite");
    this.afterDynamite(current);
  }

  afterDynamite(player) {
    if (!player.alive || this.phase !== "playing") return;
    if (this.equipment(player, "jail")) return this.requestJudgment(player, "jail");
    this.beginDraw(player);
  }

  requestJudgment(player, reason, context = {}) {
    this.pending = { type: "judgment_wait", responderId: player.id, reason, context };
    const label = reason === "dynamite" ? "다이너마이트" : reason === "jail" ? "감옥" : context.judgmentSource === "jourdonnais" ? "주르도네 능력" : "술통";
    this.addLog(`${player.nickname}님의 ${label} 카드 뒤집기를 기다립니다.`, "important");
  }

  flipJudgment(playerId) {
    const pending = this.pending;
    assert(pending?.type === "judgment_wait" && pending.responderId === playerId, "지금 뒤집을 판정 카드가 없습니다.");
    const player = this.player(playerId);
    const count = player.character.id === "lucky" ? 2 : 1;
    const cards = Array.from({ length: count }, () => this.drawOne());
    if (count === 2) {
      this.pending = { type: "judgment_choice", responderId: player.id, reason: pending.reason, cards, context: pending.context };
      this.addLog(`${player.nickname}님의 럭키 듀크 능력이 발동했습니다. 두 장 중 한 장을 고릅니다.`, "ability");
      return;
    }
    this.beginJudgmentReveal(player, pending.reason, cards[0], cards, pending.context);
  }

  chooseJudgment(playerId, cardId) {
    const pending = this.pending;
    assert(pending?.type === "judgment_choice" && pending.responderId === playerId, "선택할 카드 펼치기가 없습니다.");
    const chosen = pending.cards.find((card) => card.id === cardId);
    assert(chosen, "올바른 카드를 선택하세요.");
    this.beginJudgmentReveal(this.player(playerId), pending.reason, chosen, pending.cards, pending.context);
  }

  beginJudgmentReveal(player, reason, chosen, allCards, context) {
    this.pending = null;
    if (["dynamite", "jail"].includes(reason)) {
      const explodes = chosen.suit === "spade" && Number(chosen.rank) >= 2 && Number(chosen.rank) <= 9;
      const next = reason === "dynamite" && !explodes ? this.nextAliveWithNoDynamite(player.id) : null;
      const result = reason === "jail"
        ? chosen.suit === "heart" ? "탈출!" : "탈출 실패!"
        : explodes ? "폭발!" : next ? `${next.nickname}님에게로 넘어갑니다.` : "다음 플레이어에게로 넘어갑니다.";
      this.announcement = {
        id: `a${++this.serial}`, type: "judgment", reason, result, playerId: player.id,
        playerName: player.nickname, card: this.publicCard(chosen), at: Date.now(), expiresAt: Date.now() + 5000
      };
    }
    this.resolveJudgment(player, reason, chosen, allCards, context);
  }

  resolveJudgment(player, reason, chosen, allCards, context) {
    allCards.forEach((card) => this.discardCard(card));
    this.addLog(`${player.nickname}님의 카드 펼치기: ${this.cardLabel(chosen)}`, "reveal");
    const heart = chosen.suit === "heart";
    if (reason === "dynamite") {
      const dynamite = this.removeEquipment(player, "dynamite");
      if (chosen.suit === "spade" && Number(chosen.rank) >= 2 && Number(chosen.rank) <= 9) {
        if (dynamite) this.discardCard(dynamite);
        this.addLog(`다이너마이트가 폭발해 ${player.nickname}님이 생명력 3을 잃습니다!`, "danger");
        this.damage(player, 3, null, { kind: "after-dynamite" });
      } else {
        const next = this.nextAliveWithNoDynamite(player.id);
        if (dynamite && next) next.equipment.push(dynamite);
        this.addLog(`다이너마이트가 ${next?.nickname ?? "다음 플레이어"}님에게 넘어갔습니다.`);
        this.afterDynamite(player);
      }
    } else if (reason === "jail") {
      const jail = this.removeEquipment(player, "jail");
      if (jail) this.discardCard(jail);
      if (heart) {
        this.addLog(`${player.nickname}님이 감옥에서 탈출했습니다.`, "success");
        this.beginDraw(player);
      } else {
        this.addLog(`${player.nickname}님이 감옥에서 탈출하지 못해 차례를 건너뜁니다.`, "danger");
        this.advanceTurn();
      }
    } else if (reason === "barrel") {
      const nextContext = { ...context, needed: heart ? context.needed - 1 : context.needed };
      if (heart) this.addLog(`${player.nickname}님의 술통/능력 판정이 성공했습니다.`, "success");
      else this.addLog(`${player.nickname}님의 술통/능력 판정이 실패했습니다.`, "danger");
      const [nextSource, ...remainingSources] = nextContext.judgmentSources ?? [];
      if (nextContext.needed > 0 && nextSource) return this.requestJudgment(player, "barrel", { ...nextContext, judgmentSource: nextSource, judgmentSources: remainingSources });
      this.continueBangDefense(nextContext);
    }
  }

  beginDraw(player) {
    this.turnPhase = "draw";
    if (player.character.id === "kit") {
      this.pending = { type: "kit_draw", responderId: player.id, cards: [this.drawOne(), this.drawOne(), this.drawOne()] };
      this.addLog(`${player.nickname}님이 키트 칼슨 능력으로 카드 세 장을 확인합니다.`, "ability");
      return;
    }
    const canJesse = player.character.id === "jesse" && this.alive().some((p) => p.id !== player.id && p.hand.length);
    const canPedro = player.character.id === "pedro" && this.discard.length;
    if (canJesse || canPedro) {
      this.pending = { type: "draw_source", responderId: player.id, canJesse, canPedro };
      this.revision += 1;
      return;
    }
    this.normalDraw(player);
  }

  chooseDrawSource(playerId, source) {
    const pending = this.pending;
    assert(pending?.type === "draw_source" && pending.responderId === playerId, "가져오기 선택 단계가 아닙니다.");
    const player = this.player(playerId);
    let first;
    if (source === "discard") {
      assert(pending.canPedro && this.discard.length, "버린 카드 더미에서 가져올 수 없습니다.");
      first = this.discard.pop();
      this.addLog(`${player.nickname}님이 페드로 라미레즈 능력으로 버린 카드 더미에서 한 장을 가져왔습니다.`, "ability");
    } else if (source !== "deck") {
      const target = this.player(source);
      assert(pending.canJesse && target?.alive && target.id !== player.id && target.hand.length, "그 플레이어에게서 가져올 수 없습니다.");
      first = target.hand.splice(randomInt(target.hand.length), 1)[0];
      this.addLog(`${player.nickname}님이 제시 존스 능력으로 ${target.nickname}님의 손에서 한 장을 가져왔습니다.`, "ability");
      this.checkSuzy(target);
    } else first = this.drawOne();
    player.hand.push(first);
    const second = this.drawOne();
    player.hand.push(second);
    this.pending = null;
    this.addLog(`${player.nickname}님이 카드 두 장을 가져왔습니다.`);
    this.blackJackBonus(player, second);
    this.enterPlay(player);
  }

  chooseKit(playerId, cardIds) {
    const pending = this.pending;
    assert(pending?.type === "kit_draw" && pending.responderId === playerId, "키트 칼슨 선택 단계가 아닙니다.");
    assert(Array.isArray(cardIds) && cardIds.length === 2 && new Set(cardIds).size === 2, "서로 다른 카드 두 장을 고르세요.");
    assert(cardIds.every((id) => pending.cards.some((card) => card.id === id)), "올바른 카드를 고르세요.");
    const player = this.player(playerId);
    pending.cards.forEach((card) => (cardIds.includes(card.id) ? player.hand.push(card) : this.deck.push(card)));
    this.pending = null;
    this.addLog(`${player.nickname}님이 키트 칼슨 능력으로 카드 두 장을 골랐습니다.`, "ability");
    this.enterPlay(player);
  }

  normalDraw(player) {
    const first = this.drawOne(); const second = this.drawOne();
    player.hand.push(first, second);
    this.addLog(`${player.nickname}님이 카드 두 장을 가져왔습니다.`);
    this.blackJackBonus(player, second);
    this.enterPlay(player);
  }

  blackJackBonus(player, second) {
    if (player.character.id === "blackjack") {
      this.addLog(`블랙 잭이 두 번째 카드 ${this.cardLabel(second)}을 공개했습니다.`, "ability");
      if (["heart", "diamond"].includes(second.suit)) {
        this.draw(player, 1);
        this.addLog("블랙 잭의 능력으로 카드 한 장을 더 가져왔습니다.", "ability");
      }
    }
  }

  enterPlay(player) {
    if (this.phase !== "playing" || !player.alive) return;
    this.turnPhase = "play";
    this.revision += 1;
  }

  playCard(playerId, cardId, targetId = null, targetCardId = null) {
    const player = this.player(playerId);
    assert(this.phase === "playing" && this.turnPhase === "play" && !this.pending, "지금은 카드를 사용할 수 없습니다.");
    assert(this.current().id === playerId && player?.alive, "자기 차례에만 사용할 수 있습니다.");
    const index = player.hand.findIndex((card) => card.id === cardId);
    assert(index >= 0, "가지고 있지 않은 카드입니다.");
    const card = player.hand[index]; const info = this.cardInfo(card);
    assert(info.kind !== "response", "이 카드는 공격에 대응할 때 사용합니다.");
    this.validateCardPlay(player, card, targetId, targetCardId);
    player.hand.splice(index, 1);
    const target = targetId ? this.player(targetId) : null;
    const actionText = target
      ? `${player.nickname}님이 ${target.nickname}님에게 <${info.name}>을(를) 사용했습니다.`
      : `${player.nickname}님이 <${info.name}>을(를) 사용했습니다.`;
    this.addLog(actionText, "card", {
      kind: "card", actorId: player.id, targetId: target?.id ?? null, cardType: card.type,
      card: this.publicCard(card)
    });
    this.checkSuzy(player);
    this.resolvePlayedCard(player, card, targetId, targetCardId);
  }

  validateCardPlay(player, card, targetId, targetCardId) {
    const info = this.cardInfo(card); const target = targetId ? this.player(targetId) : null;
    const targeted = ["bang", "duel", "target-card", "equipment-target"].includes(info.kind);
    if (targeted) assert(target?.alive && (card.type === "cat_balou" || target.id !== player.id), "유효한 플레이어를 선택하세요.");
    if (card.type === "bang") {
      assert(this.bangUsed === 0 || player.character.id === "willy" || this.equipment(player, "volcanic"), "이번 차례에는 이미 뱅!을 사용했습니다.");
      assert(this.distance(player.id, target.id) <= this.weaponRange(player), "대상이 뱅! 사정거리 밖에 있습니다.");
    }
    if (card.type === "beer") {
      assert(this.alive().length > 2, "생존자가 두 명뿐일 때는 맥주가 효과가 없습니다.");
      assert(player.hp < this.maximumHp(player), "현재 생명력이 최대라 맥주 효과를 받을 수 없습니다.");
    }
    if (card.type === "panic") assert(this.distance(player.id, target.id) <= 1, "강탈은 거리 1인 플레이어에게만 사용할 수 있습니다.");
    if (["panic", "cat_balou"].includes(card.type)) {
      const targetHandCount = target.id === player.id ? target.hand.length - 1 : target.hand.length;
      assert(targetHandCount > 0 || target.equipment.length, "대상에게 가져오거나 버릴 카드가 없습니다.");
      if (targetCardId === "hand" || !targetCardId) assert(targetHandCount > 0, "대상의 손에 처리할 카드가 없습니다.");
      else assert(target.equipment.some((item) => item.id === targetCardId), "선택한 장착 카드가 없습니다.");
    }
    if (card.type === "jail") assert(target.role !== "sheriff", "보안관에게는 감옥을 놓을 수 없습니다.");
    if (["barrel", "dynamite", "jail", "mustang", "scope"].includes(card.type)) {
      const owner = card.type === "jail" ? target : player;
      assert(!this.equipment(owner, card.type), "같은 이름의 카드를 두 장 장착할 수 없습니다.");
    }
  }

  resolvePlayedCard(player, card, targetId, targetCardId) {
    const info = this.cardInfo(card); const target = targetId ? this.player(targetId) : null;
    if (card.type === "bang") {
      this.bangUsed += 1; this.discardCard(card);
      this.beginBangDefense(target, player.id, player.character.id === "slab" ? 2 : 1, { kind: "none" });
    } else if (card.type === "beer") { this.discardCard(card); this.heal(player, 1); }
    else if (card.type === "saloon") { this.discardCard(card); this.alive().forEach((p) => this.heal(p, 1, false)); this.addLog("주점 효과로 모든 생존자가 생명력 1을 회복했습니다."); }
    else if (card.type === "stagecoach") { this.discardCard(card); this.draw(player, 2); }
    else if (card.type === "wells_fargo") { this.discardCard(card); this.draw(player, 3); }
    else if (card.type === "duel") { this.discardCard(card); this.pending = { type: "duel", responderId: target.id, otherId: player.id, initiatorId: player.id }; this.revision += 1; }
    else if (card.type === "gatling") { this.discardCard(card); this.startAttackQueue("gatling", player.id, this.clockwiseAfter(player.id).filter((p) => p.id !== player.id)); }
    else if (card.type === "indians") { this.discardCard(card); this.startAttackQueue("indians", player.id, this.clockwiseAfter(player.id).filter((p) => p.id !== player.id)); }
    else if (card.type === "general_store") { this.discardCard(card); const cards = this.alive().map(() => this.drawOne()); this.pending = { type: "store", responderId: player.id, order: this.clockwiseAfter(player.id).map((p) => p.id), cards, position: 0 }; this.revision += 1; }
    else if (["panic", "cat_balou"].includes(card.type)) { this.discardCard(card); this.takeTargetCard(player, target, targetCardId, card.type === "panic"); }
    else if (info.kind === "weapon") { const old = player.equipment.find((item) => CARD_INFO[item.type].kind === "weapon"); if (old) { player.equipment.splice(player.equipment.indexOf(old), 1); this.discardCard(old); } player.equipment.push(card); this.revision += 1; }
    else if (card.type === "jail") { target.equipment.push(card); this.revision += 1; }
    else { player.equipment.push(card); this.revision += 1; }
  }

  useSid(playerId, cardIds) {
    const player = this.player(playerId);
    assert(this.phase === "playing" && player?.alive, "지금은 능력을 쓸 수 없습니다.");
    assert(!this.pending || this.pending.responderId === playerId, "다른 플레이어의 응답을 기다리는 동안에는 능력을 쓸 수 없습니다.");
    assert(player.character.id === "sid" && player.hp < this.maximumHp(player), "시드 케첨의 능력을 쓸 수 없습니다.");
    assert(Array.isArray(cardIds) && cardIds.length === 2 && new Set(cardIds).size === 2, "카드 두 장을 고르세요.");
    const chosen = cardIds.map((id) => player.hand.find((card) => card.id === id));
    assert(chosen.every(Boolean), "가지고 있는 카드 두 장을 고르세요.");
    chosen.forEach((card) => { player.hand.splice(player.hand.indexOf(card), 1); this.discardCard(card); });
    this.addLog(`${player.nickname}님이 시드 케첨 능력으로 카드 두 장을 버렸습니다.`, "ability");
    this.heal(player, 1); this.checkSuzy(player);
    if (this.pending?.type === "dying" && this.pending.responderId === playerId && player.hp > 0) {
      const continuation = this.pending.continuation; this.pending = null; this.resume(continuation);
    }
  }

  respond(playerId, cardId = null) {
    const pending = this.pending;
    assert(pending && pending.responderId === playerId, "현재 응답할 차례가 아닙니다.");
    const player = this.player(playerId);
    if (pending.type === "bang") return this.respondBang(player, cardId);
    if (pending.type === "duel") return this.respondDuel(player, cardId);
    if (pending.type === "indians") return this.respondIndians(player, cardId);
    if (pending.type === "dying") return this.respondDying(player, cardId);
    throw new Error("이 상호작용에는 다른 응답이 필요합니다.");
  }

  responseCard(player, cardId, allowed) {
    if (!cardId) return null;
    const index = player.hand.findIndex((card) => card.id === cardId);
    assert(index >= 0, "가지고 있지 않은 카드입니다.");
    const card = player.hand[index];
    const converted = player.character.id === "calamity" && ((allowed === "missed" && card.type === "bang") || (allowed === "bang" && card.type === "missed"));
    assert(card.type === allowed || converted, `이 상황에는 <${CARD_INFO[allowed].name}> 카드가 필요합니다.`);
    player.hand.splice(index, 1); this.discardCard(card); this.checkSuzy(player);
    this.addLog(`${player.nickname}님이 <${CARD_INFO[card.type].name}>으로 응답했습니다.`, "card", {
      kind: "response", actorId: player.id, cardType: card.type, pendingType: this.pending?.type ?? null,
      card: this.publicCard(card)
    });
    return card;
  }

  beginBangDefense(target, attackerId, needed, continuation, allowJudgment = true) {
    const sources = allowJudgment ? [this.equipment(target, "barrel") && "barrel", target.character.id === "jourdonnais" && "jourdonnais"].filter(Boolean) : [];
    const context = { targetId: target.id, attackerId, needed, continuation, judgmentSource: sources[0], judgmentSources: sources.slice(1) };
    if (sources.length) return this.requestJudgment(target, "barrel", context);
    this.continueBangDefense(context);
  }

  continueBangDefense(context) {
    if (context.needed <= 0) {
      this.addLog(`${this.player(context.targetId).nickname}님이 공격을 피했습니다.`, "success");
      return this.resume(context.continuation);
    }
    this.pending = { type: "bang", responderId: context.targetId, ...context };
    this.revision += 1;
  }

  respondBang(player, cardId) {
    const pending = this.pending;
    if (cardId) {
      this.responseCard(player, cardId, "missed");
      pending.needed -= 1;
      if (pending.needed > 0) { this.revision += 1; return; }
      this.pending = null;
      this.addLog(`${player.nickname}님이 공격을 피했습니다.`, "success");
      this.resume(pending.continuation);
    } else {
      this.pending = null;
      this.damage(player, 1, pending.attackerId, pending.continuation);
    }
  }

  respondDuel(player, cardId) {
    const pending = this.pending;
    if (cardId) {
      this.responseCard(player, cardId, "bang");
      const previous = pending.otherId;
      pending.otherId = player.id; pending.responderId = previous;
      this.revision += 1;
    } else {
      this.pending = null;
      const ignoreElGringo = player.id === pending.initiatorId;
      this.damage(player, 1, pending.otherId, { kind: "none" }, { ignoreElGringo });
    }
  }

  startAttackQueue(type, attackerId, targets) {
    const queue = targets.filter((p) => p.alive).map((p) => p.id);
    this.resume({ kind: "attack-queue", type, attackerId, queue, position: 0 });
  }

  respondIndians(player, cardId) {
    const pending = this.pending;
    this.pending = null;
    if (cardId) { this.responseCard(player, cardId, "bang"); this.resume(pending.continuation); }
    else this.damage(player, 1, pending.attackerId, pending.continuation);
  }

  pickStore(playerId, cardId) {
    const pending = this.pending;
    assert(pending?.type === "store" && pending.responderId === playerId, "지금은 잡화점 카드를 고를 차례가 아닙니다.");
    const index = pending.cards.findIndex((card) => card.id === cardId);
    assert(index >= 0, "공개된 카드 중 한 장을 고르세요.");
    const player = this.player(playerId); const [card] = pending.cards.splice(index, 1); player.hand.push(card);
    this.addLog(`${player.nickname}님이 잡화점에서 카드 한 장을 골랐습니다.`);
    pending.position += 1;
    if (!pending.cards.length) this.pending = null;
    else pending.responderId = pending.order[pending.position];
    this.revision += 1;
  }

  takeTargetCard(actor, target, targetCardId, steal) {
    let card;
    if (targetCardId && targetCardId !== "hand") {
      const index = target.equipment.findIndex((item) => item.id === targetCardId);
      assert(index >= 0, "선택한 장착 카드가 없습니다.");
      [card] = target.equipment.splice(index, 1);
    } else {
      assert(target.hand.length, "대상의 손에 카드가 없습니다.");
      [card] = target.hand.splice(randomInt(target.hand.length), 1);
      this.checkSuzy(target);
    }
    if (steal) actor.hand.push(card); else this.discardCard(card);
    this.addLog(`${actor.nickname}님이 ${target.nickname}님의 카드 한 장을 ${steal ? "가져왔습니다" : "버렸습니다"}.`, "normal", {
      kind: "card_effect", actorId: actor.id, targetId: target.id, effect: steal ? "steal" : "discard"
    });
  }

  endTurn(playerId) {
    assert(this.phase === "playing" && !this.pending && this.current()?.id === playerId && this.turnPhase === "play", "지금은 차례를 마칠 수 없습니다.");
    const player = this.player(playerId);
    if (player.hand.length > player.hp) { this.turnPhase = "discard"; this.revision += 1; }
    else this.advanceTurn();
  }

  discardFromHand(playerId, cardId) {
    const player = this.player(playerId);
    assert(this.current()?.id === playerId && this.turnPhase === "discard" && !this.pending, "지금은 손패를 버릴 단계가 아닙니다.");
    assert(player.hand.length > player.hp, "더 버릴 필요가 없습니다.");
    const index = player.hand.findIndex((card) => card.id === cardId); assert(index >= 0, "가지고 있지 않은 카드입니다.");
    this.discardCard(player.hand.splice(index, 1)[0]); this.checkSuzy(player);
    if (player.hand.length <= player.hp) this.advanceTurn(); else this.revision += 1;
  }

  advanceTurn() {
    if (this.phase !== "playing") return;
    this.pending = null;
    do this.turnIndex = (this.turnIndex + 1) % this.players.length; while (!this.current().alive);
    this.beginTurn();
  }

  damage(player, amount, attackerId, continuation, options = {}) {
    if (!player.alive) return this.resume(continuation);
    player.hp -= amount;
    this.addLog(`${player.nickname}님이 생명력 ${amount}을 잃었습니다. (${Math.max(0, player.hp)}/${this.maximumHp(player)})`, "danger", {
      kind: "damage", playerId: player.id, attackerId: attackerId ?? null, amount
    });
    if (player.character.id === "bart") { this.draw(player, amount); this.addLog("바트 캐시디의 능력이 발동했습니다.", "ability"); }
    const attacker = attackerId ? this.player(attackerId) : null;
    if (player.character.id === "elgringo" && !options.ignoreElGringo && attacker?.hand.length) {
      const count = Math.min(amount, attacker.hand.length);
      for (let n = 0; n < count; n += 1) player.hand.push(attacker.hand.splice(randomInt(attacker.hand.length), 1)[0]);
      this.addLog(`엘 그링고가 공격자의 손에서 카드 ${count}장을 가져왔습니다.`, "ability");
      this.checkSuzy(attacker);
    }
    if (player.hp <= 0) {
      this.pending = { type: "dying", responderId: player.id, attackerId, continuation };
      this.addLog(`${player.nickname}님이 쓰러졌습니다. 맥주로 생존할 수 있습니다.`, "danger");
      return;
    }
    this.resume(continuation);
  }

  respondDying(player, cardId) {
    const pending = this.pending;
    if (cardId) {
      assert(this.alive().length > 2, "생존자가 두 명뿐일 때는 맥주가 효과가 없습니다.");
      const card = this.responseCard(player, cardId, "beer");
      assert(card, "맥주 카드가 필요합니다.");
      player.hp += 1;
      this.addLog(`${player.nickname}님이 맥주로 생명력 1을 회복했습니다.`, "success");
      if (player.hp > 0) { this.pending = null; this.resume(pending.continuation); }
      else this.revision += 1;
    } else {
      this.pending = null;
      this.eliminate(player, pending.attackerId, pending.continuation);
    }
  }

  eliminate(player, attackerId, continuation) {
    player.alive = false; player.hp = 0;
    this.addLog(`${player.nickname}님이 제거되었습니다. 역할은 ${ROLES[player.role].name}입니다.`, "important", {
      kind: "elimination", playerId: player.id, attackerId: attackerId ?? null, role: player.role
    });
    const cards = [...player.hand, ...player.equipment]; player.hand = []; player.equipment = [];
    const vulture = this.alive().find((p) => p.character.id === "vulture");
    if (vulture && cards.length) { vulture.hand.push(...cards); this.addLog(`벌쳐 샘이 제거된 플레이어의 카드 ${cards.length}장을 가져왔습니다.`, "ability"); }
    else cards.forEach((card) => this.discardCard(card));
    const attacker = attackerId ? this.player(attackerId) : null;
    if (attacker && player.role === "outlaw" && attacker.alive) { this.draw(attacker, 3); this.addLog(`${attacker.nickname}님이 무법자 현상금 카드 3장을 받았습니다.`, "important"); }
    if (attacker?.role === "sheriff" && player.role === "deputy" && attacker.alive) {
      [...attacker.hand, ...attacker.equipment].forEach((card) => this.discardCard(card)); attacker.hand = []; attacker.equipment = [];
      this.addLog("보안관이 부관을 제거해 자신의 모든 카드를 버렸습니다.", "danger"); this.checkSuzy(attacker);
    }
    if (this.checkVictory()) return;
    if (this.current().id === player.id) return this.advanceTurn();
    this.resume(continuation);
  }

  checkVictory() {
    const sheriff = this.players.find((p) => p.role === "sheriff"); const alive = this.alive();
    if (!sheriff.alive) {
      const renegadeSolo = alive.length === 1 && alive[0].role === "renegade";
      this.winners = renegadeSolo ? ["renegade"] : ["outlaw"];
    } else if (!alive.some((p) => p.role === "outlaw" || p.role === "renegade")) this.winners = ["sheriff", "deputy"];
    else return false;
    this.phase = "game_over"; this.turnPhase = null; this.pending = null;
    this.addLog(`게임 종료! ${this.winners.map((role) => ROLES[role].name).join("·")} 승리입니다.`, "victory");
    return true;
  }

  resume(continuation = { kind: "none" }) {
    if (!continuation || continuation.kind === "none" || this.phase !== "playing") { this.revision += 1; return; }
    if (continuation.kind === "after-dynamite") return this.afterDynamite(this.current());
    if (continuation.kind === "attack-queue") {
      while (continuation.position < continuation.queue.length && !this.player(continuation.queue[continuation.position])?.alive) continuation.position += 1;
      if (continuation.position >= continuation.queue.length) { this.revision += 1; return; }
      const target = this.player(continuation.queue[continuation.position]);
      const next = { ...continuation, queue: [...continuation.queue], position: continuation.position + 1 };
      if (continuation.type === "gatling") return this.beginBangDefense(target, continuation.attackerId, 1, next, false);
      this.pending = { type: "indians", responderId: target.id, attackerId: continuation.attackerId, continuation: next };
      this.revision += 1;
    }
  }

  heal(player, amount, announce = true) {
    const before = player.hp; player.maxHp = this.maximumHp(player); player.hp = Math.min(player.maxHp, player.hp + amount);
    if (announce && player.hp > before) this.addLog(`${player.nickname}님이 생명력 ${player.hp - before}을 회복했습니다. (${player.hp}/${player.maxHp})`, "success");
    else this.revision += 1;
  }

  checkSuzy(player) {
    if (player.alive && player.character?.id === "suzy" && player.hand.length === 0) {
      player.hand.push(this.drawOne()); this.addLog("수지 라파예트의 손이 비어 카드 한 장을 가져왔습니다.", "ability");
    }
  }

  equipment(player, type) { return player.equipment.find((card) => card.type === type); }
  maximumHp(player) { return player?.character ? player.character.hp + (player.role === "sheriff" ? 1 : 0) : 0; }
  removeEquipment(player, type) { const i = player.equipment.findIndex((card) => card.type === type); return i < 0 ? null : player.equipment.splice(i, 1)[0]; }
  weaponRange(player) { return this.cardInfo(player.equipment.find((card) => CARD_INFO[card.type].kind === "weapon") ?? { type: "bang" }).range ?? 1; }

  clockwiseAfter(playerId) {
    const index = this.players.findIndex((p) => p.id === playerId); const result = [];
    for (let n = 0; n < this.players.length; n += 1) { const p = this.players[(index + n) % this.players.length]; if (p.alive) result.push(p); }
    return result;
  }

  nextAliveWithNoDynamite(playerId) {
    return this.clockwiseAfter(playerId).slice(1).find((p) => !this.equipment(p, "dynamite"));
  }

  distance(originId, targetId) {
    const alive = this.alive(); const a = alive.findIndex((p) => p.id === originId); const b = alive.findIndex((p) => p.id === targetId);
    if (a < 0 || b < 0 || a === b) return a === b ? 0 : Infinity;
    const raw = Math.abs(a - b); let value = Math.min(raw, alive.length - raw);
    const origin = alive[a]; const target = alive[b];
    if (origin.character.id === "rose") value -= 1;
    if (this.equipment(origin, "scope")) value -= 1;
    if (target.character.id === "paul") value += 1;
    if (this.equipment(target, "mustang")) value += 1;
    return Math.max(1, value);
  }

  cardLabel(card) { const info = this.cardInfo(card); const suits = { heart: "♥", diamond: "◆", spade: "♠", club: "♣" }; return `${info.name} ${suits[card.suit]} ${card.rank}`; }

  viewFor(playerId) {
    const viewer = this.player(playerId); assert(viewer, "플레이어를 찾을 수 없습니다.");
    const pending = this.pending ? this.publicPending(this.pending, playerId) : null;
    return {
      revision: this.revision, phase: this.phase, turnPhase: this.turnPhase, hostId: this.hostId, bangUsed: this.bangUsed,
      me: playerId, currentPlayerId: this.phase === "playing" ? this.current()?.id ?? null : null, deckCount: this.deck.length,
      discardTop: this.discard.length ? this.publicCard(this.discard.at(-1)) : null,
      characterOptions: viewer.characterOptions?.map((character) => ({ ...character })) ?? [],
      players: this.players.map((player) => ({
        id: player.id, nickname: player.nickname, connected: player.connected, isBot: player.isBot, alive: player.alive,
        hp: player.hp, maxHp: this.maximumHp(player), character: player.character,
        role: player.role && (player.id === playerId || player.role === "sheriff" || !player.alive || this.phase === "game_over") ? { id: player.role, ...ROLES[player.role] } : null,
        handCount: player.hand.length,
        hand: player.id === playerId ? player.hand.map((card) => this.publicCard(card)) : undefined,
        equipment: player.equipment.map((card) => this.publicCard(card)),
        distance: this.phase !== "playing" || player.id === playerId || !viewer.alive || !player.alive ? null : this.distance(playerId, player.id)
      })),
      pending, winners: this.winners,
      announcement: this.announcement?.expiresAt > Date.now() ? this.announcement : null,
      log: this.log
    };
  }

  publicCard(card) { return { ...CARD_INFO[card.type], ...card }; }

  publicPending(pending, playerId) {
    const mine = pending.responderId === playerId;
    const base = { type: pending.type, responderId: pending.responderId, mine };
    if (pending.type === "bang") return { ...base, needed: pending.needed, attackerId: pending.attackerId };
    if (pending.type === "duel") return { ...base, otherId: pending.otherId };
    if (pending.type === "indians" || pending.type === "dying") return { ...base, attackerId: pending.attackerId };
    if (pending.type === "store") return { ...base, cards: pending.cards.map((card) => this.publicCard(card)) };
    if (pending.type === "judgment_wait") return { ...base, reason: pending.reason, judgmentSource: pending.context?.judgmentSource };
    if (pending.type === "judgment_choice" && mine) return { ...base, reason: pending.reason, cards: pending.cards.map((card) => this.publicCard(card)) };
    if (pending.type === "kit_draw" && mine) return { ...base, cards: pending.cards.map((card) => this.publicCard(card)) };
    if (pending.type === "draw_source" && mine) return { ...base, canJesse: pending.canJesse, canPedro: pending.canPedro };
    return base;
  }
}
