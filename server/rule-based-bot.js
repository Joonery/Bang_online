export const BOT_NAMES = [
  "뱅돌이", "독사", "장고", "맥크리", "석양맨", "명사수", "총총이", 
];

const OFFENSIVE_CHARACTERS = new Set(["slab", "willy", "calamity"]);
const DEFENSIVE_CARDS = new Set(["missed", "beer", "barrel", "mustang"]);
const DRAW_CARDS = new Set(["stagecoach", "wells_fargo", "general_store"]);
const ATTACK_CARDS = new Set(["bang", "duel", "gatling", "indians"]);

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function cardKey(action) { return JSON.stringify(action); }
function isExplosive(card) { return card?.suit === "spade" && Number(card.rank) >= 2 && Number(card.rank) <= 9; }
function isHeart(card) { return card?.suit === "heart"; }

export function chooseUniqueBotName(existingNames, random = Math.random) {
  const used = new Set([...existingNames].map((name) => String(name).toLowerCase()));
  const available = BOT_NAMES.filter((name) => !used.has(name.toLowerCase()));
  if (!available.length) throw new Error("사용할 수 있는 봇 이름이 없습니다.");
  return available[Math.floor(random() * available.length)];
}

export class BotBeliefModel {
  constructor(botId) {
    this.botId = botId;
    this.lastLogId = null;
    this.scores = new Map();
    this.knownRoles = new Map();
    this.sheriffAttackers = new Set();
  }

  score(playerId) {
    if (!this.scores.has(playerId)) this.scores.set(playerId, { outlaw: 0, law: 0, renegade: 0 });
    return this.scores.get(playerId);
  }

  consume(log = [], sheriffId = null) {
    let start = 0;
    if (this.lastLogId) {
      const found = log.findIndex((entry) => entry.id === this.lastLogId);
      if (found >= 0) start = found + 1;
    }
    for (const entry of log.slice(start)) this.consumeEntry(entry, sheriffId);
    if (log.length) this.lastLogId = log.at(-1).id;
  }

  consumeEntry(entry, sheriffId) {
    const meta = entry?.meta;
    if (!meta || typeof meta !== "object") return;
    if (meta.kind === "elimination" && meta.playerId && meta.role) {
      this.knownRoles.set(meta.playerId, meta.role);
      const score = this.score(meta.playerId);
      score.outlaw = meta.role === "outlaw" ? 100 : -100;
      score.law = ["sheriff", "deputy"].includes(meta.role) ? 100 : -100;
      score.renegade = meta.role === "renegade" ? 100 : -100;
      return;
    }
    if (meta.kind === "damage" && meta.playerId === sheriffId && meta.attackerId && meta.attackerId !== sheriffId) {
      const attacker = this.score(meta.attackerId);
      attacker.outlaw = clamp(attacker.outlaw + 2, -20, 20);
      attacker.law = clamp(attacker.law - 1.5, -20, 20);
    }
    if (meta.kind !== "card" || !meta.actorId) return;
    const actor = this.score(meta.actorId);
    const directAttack = ["bang", "duel"].includes(meta.cardType);
    const disruption = ["panic", "cat_balou", "jail"].includes(meta.cardType);
    if (meta.targetId === sheriffId && (directAttack || disruption)) {
      actor.outlaw = clamp(actor.outlaw + (directAttack ? 5 : 2), -20, 20);
      actor.law = clamp(actor.law - (directAttack ? 4 : 1.5), -20, 20);
      if (directAttack) this.sheriffAttackers.add(meta.actorId);
    }
    if (meta.targetId && this.sheriffAttackers.has(meta.targetId) && directAttack) {
      actor.law = clamp(actor.law + 2.5, -20, 20);
      actor.outlaw = clamp(actor.outlaw - 1.5, -20, 20);
    }
  }

  estimate(playerId) { return { ...this.score(playerId), knownRole: this.knownRoles.get(playerId) ?? null }; }
}

export class RuleBasedBangBot {
  constructor({ id, random = Math.random }) {
    this.id = id;
    this.random = random;
    this.beliefs = new BotBeliefModel(id);
    this.failed = new Map();
  }

  rememberFailure(revision, action) {
    if (!this.failed.has(revision)) this.failed.set(revision, new Set());
    this.failed.get(revision).add(cardKey(action));
    for (const key of this.failed.keys()) if (key !== revision) this.failed.delete(key);
  }

  isFailed(state, action) { return this.failed.get(state.revision)?.has(cardKey(action)) ?? false; }

  canAct(state) {
    if (!state) return false;
    if (state.phase === "character_selection") return Boolean(state.characterOptions?.length);
    if (state.pending?.mine) return true;
    return state.phase === "playing" && !state.pending && state.currentPlayerId === this.id && ["play", "discard"].includes(state.turnPhase);
  }

  chooseAction(state) {
    const me = state.players.find((player) => player.id === this.id);
    if (!me) return null;
    const sheriff = state.players.find((player) => player.role?.id === "sheriff");
    this.beliefs.consume(state.log, sheriff?.id ?? null);
    if (state.phase === "character_selection" && state.characterOptions?.length) return this.chooseCharacter(state, me);
    if (state.pending?.mine) return this.choosePending(state, me);
    if (state.phase !== "playing" || state.pending || state.currentPlayerId !== this.id) return null;
    if (state.turnPhase === "discard") return this.chooseDiscard(state, me);
    if (state.turnPhase === "play") return this.choosePlay(state, me);
    return null;
  }

  chooseCharacter(state, me) {
    const role = me.role?.id;
    const ranked = state.characterOptions.map((character) => {
      let score = character.hp * 3 + this.random() * 2;
      if (["jourdonnais", "paul", "bart", "sid", "lucky"].includes(character.id)) score += role === "sheriff" ? 4 : 2;
      if (["slab", "willy", "calamity"].includes(character.id)) score += role === "outlaw" ? 4 : 1;
      if (["kit", "jesse", "pedro", "blackjack"].includes(character.id)) score += 2;
      return { character, score };
    }).sort((a, b) => b.score - a.score);
    return { type: "chooseCharacter", characterId: ranked[0].character.id };
  }

  choosePending(state, me) {
    const pending = state.pending;
    if (pending.type === "judgment_wait") return { type: "flipJudgment" };
    if (pending.type === "judgment_choice") {
      let chosen = pending.cards[0];
      if (pending.reason === "dynamite") chosen = pending.cards.find((card) => !isExplosive(card)) ?? chosen;
      else chosen = pending.cards.find(isHeart) ?? chosen;
      return { type: "judgment", cardId: chosen.id };
    }
    if (pending.type === "kit_draw") return this.chooseKit(state, me, pending.cards);
    if (pending.type === "draw_source") return this.chooseDrawSource(state, me, pending);
    if (pending.type === "store") return { type: "storePick", cardId: this.bestCard(pending.cards, state, me).id };
    if (pending.type === "dying" && me.character?.id === "sid" && me.hand.length >= 2 && !me.hand.some((card) => card.type === "beer")) {
      return { type: "sid", cardIds: this.lowestCards(me.hand, state, me, 2).map((card) => card.id) };
    }
    if (["bang", "duel", "indians", "dying"].includes(pending.type)) return this.chooseResponse(state, me, pending);
    return null;
  }

  chooseResponse(state, me, pending) {
    const required = pending.type === "bang" ? "missed" : pending.type === "dying" ? "beer" : "bang";
    const usable = me.hand.filter((card) => card.type === required || (me.character?.id === "calamity" && ((required === "bang" && card.type === "missed") || (required === "missed" && card.type === "bang"))));
    let shouldUse = false;
    if (pending.type === "dying") shouldUse = usable.length > 0 && state.players.filter((player) => player.alive).length > 2;
    else if (pending.type === "bang") shouldUse = usable.length > 0 && (me.hp <= 2 || pending.needed <= usable.length || !["bart", "elgringo"].includes(me.character?.id) || this.random() > 0.72);
    else shouldUse = usable.length > 0 && (me.hp <= 2 || usable.length > 1 || this.random() > 0.42);
    return { type: "respond", ...(shouldUse ? { cardId: this.lowestCards(usable, state, me, 1)[0].id } : {}) };
  }

  chooseKit(state, me, cards) {
    const next = this.nextAlive(state, me.id);
    const ranked = cards.map((card) => ({ card, value: this.cardValue(card, state, me) })).sort((a, b) => b.value - a.value);
    let leave = ranked.at(-1).card;
    if (next) {
      const nextBelief = this.beliefs.estimate(next.id);
      const allied = this.isLikelyAlly(me.role?.id, next, nextBelief, state);
      const hasJail = next.equipment.some((card) => card.type === "jail");
      const hasDynamite = next.equipment.some((card) => card.type === "dynamite");
      if (hasDynamite) {
        const desired = cards.find((card) => allied ? !isExplosive(card) : isExplosive(card));
        if (desired && this.cardValue(desired, state, me) <= ranked[0].value + 4) leave = desired;
      } else if (hasJail) {
        const desired = cards.find((card) => allied ? isHeart(card) : !isHeart(card));
        if (desired && this.cardValue(desired, state, me) <= ranked[0].value + 4) leave = desired;
      }
    }
    return { type: "kitDraw", cardIds: cards.filter((card) => card.id !== leave.id).map((card) => card.id) };
  }

  chooseDrawSource(state, me, pending) {
    if (pending.canPedro && state.discardTop && this.cardValue(state.discardTop, state, me) >= 8) return { type: "drawSource", source: "discard" };
    if (pending.canJesse) {
      const targets = state.players.filter((player) => player.alive && player.id !== me.id && player.handCount > 0)
        .map((player) => ({ player, score: this.targetScore(state, me, player) + player.handCount * 0.8 }))
        .sort((a, b) => b.score - a.score);
      if (targets[0]?.score > 3) return { type: "drawSource", source: targets[0].player.id };
    }
    return { type: "drawSource", source: "deck" };
  }

  chooseDiscard(state, me) {
    const card = this.lowestCards(me.hand, state, me, 1)[0];
    return card ? { type: "discard", cardId: card.id } : null;
  }

  choosePlay(state, me) {
    if (me.character?.id === "sid" && me.hp < me.maxHp && me.hand.length >= 2 && (me.hp <= 2 || me.hand.length > me.hp + 1)) {
      const sid = { type: "sid", cardIds: this.lowestCards(me.hand, state, me, 2).map((card) => card.id) };
      if (!this.isFailed(state, sid)) return sid;
    }
    const candidates = [];
    for (const card of me.hand) candidates.push(...this.cardActions(card, state, me));
    const usable = candidates.filter((candidate) => !this.isFailed(state, candidate.action)).sort((a, b) => b.score - a.score);
    if (usable.length && usable[0].score > 0) return usable[0].action;
    const end = { type: "endTurn" };
    return this.isFailed(state, end) ? null : end;
  }

  cardActions(card, state, me) {
    const actions = [];
    const alive = state.players.filter((player) => player.alive);
    const add = (action, score) => actions.push({ action, score: score + this.random() * 1.4 });
    const simple = (score) => add({ type: "play", cardId: card.id }, score);
    if (card.kind === "response") return actions;
    if (card.type === "beer") { if (me.hp < me.maxHp && alive.length > 2) simple(me.hp <= 2 ? 18 : 9); return actions; }
    if (["stagecoach", "wells_fargo"].includes(card.type)) { simple(card.type === "wells_fargo" ? 14 : 11); return actions; }
    if (card.type === "saloon") {
      const sheriff = alive.find((player) => player.role?.id === "sheriff");
      let score = me.hp < me.maxHp ? 9 : -3;
      if (me.role?.id === "deputy" && sheriff?.hp < sheriff?.maxHp) score += 7;
      if (me.role?.id === "outlaw" && sheriff?.hp < sheriff?.maxHp) score -= 8;
      add({ type: "play", cardId: card.id }, score); return actions;
    }
    if (card.type === "general_store") { simple(8 + alive.length * 0.4); return actions; }
    if (card.kind === "weapon") {
      const current = me.equipment.find((item) => item.kind === "weapon");
      const score = !current ? 8 + (card.range ?? 1) : (card.range ?? 1) - (current.range ?? 1) >= 0 ? 5 : -4;
      simple(score); return actions;
    }
    if (["barrel", "mustang", "scope"].includes(card.type)) {
      if (!me.equipment.some((item) => item.type === card.type)) simple((card.type === "scope" ? 5 : 8) + (me.hp <= 2 ? 5 : 0));
      return actions;
    }
    if (card.type === "dynamite") {
      if (!me.equipment.some((item) => item.type === "dynamite") && me.hp >= 3) simple(me.role?.id === "outlaw" ? 3 : 1);
      return actions;
    }
    if (card.type === "jail") {
      this.rankTargets(state, me, { excludeSheriff: true }).forEach(({ player, score }) => {
        if (!player.equipment.some((item) => item.type === "jail")) add({ type: "play", cardId: card.id, targetId: player.id }, score + 6);
      });
      return actions;
    }
    if (["bang", "duel"].includes(card.type)) {
      if (card.type === "bang" && state.bangUsed > 0 && me.character?.id !== "willy" && !me.equipment.some((item) => item.type === "volcanic")) return actions;
      const range = me.equipment.find((item) => item.kind === "weapon")?.range ?? 1;
      this.rankTargets(state, me).forEach(({ player, score }) => {
        if (card.type === "bang" && player.distance > range) return;
        add({ type: "play", cardId: card.id, targetId: player.id }, score + (player.hp === 1 ? 8 : 2));
      });
      return actions;
    }
    if (["panic", "cat_balou"].includes(card.type)) {
      const targets = state.players.filter((player) => player.alive && player.id !== me.id && (card.type !== "panic" || player.distance <= 1));
      for (const target of targets) {
        const base = this.targetScore(state, me, target);
        const equipment = [...target.equipment].sort((a, b) => this.publicEquipmentValue(b) - this.publicEquipmentValue(a))[0];
        if (equipment) add({ type: "play", cardId: card.id, targetId: target.id, targetCardId: equipment.id }, base + this.publicEquipmentValue(equipment));
        else if (target.handCount > 0) add({ type: "play", cardId: card.id, targetId: target.id, targetCardId: "hand" }, base + 3);
      }
      return actions;
    }
    if (["gatling", "indians"].includes(card.type)) {
      const net = alive.filter((player) => player.id !== me.id).reduce((sum, player) => sum + this.targetScore(state, me, player), 0);
      simple(net / Math.max(1, alive.length - 1) + (me.role?.id === "outlaw" ? 2 : -1));
      return actions;
    }
    if (["equipment", "instant", "multi", "store"].includes(card.kind)) simple(2);
    return actions;
  }

  rankTargets(state, me, options = {}) {
    return state.players.filter((player) => player.alive && player.id !== me.id && (!options.excludeSheriff || player.role?.id !== "sheriff"))
      .map((player) => ({ player, score: this.targetScore(state, me, player) + this.random() * 1.2 }))
      .filter(({ score }) => score > -12).sort((a, b) => b.score - a.score);
  }

  targetScore(state, me, target) {
    const role = me.role?.id; const belief = this.beliefs.estimate(target.id);
    const sheriff = state.players.find((player) => player.role?.id === "sheriff");
    const threat = target.handCount * 0.55 + target.equipment.length * 1.2 + (OFFENSIVE_CHARACTERS.has(target.character?.id) ? 2.5 : 0) + (target.hp <= 1 ? 3 : 0);
    if (role === "outlaw") return target.id === sheriff?.id ? 22 + (sheriff.maxHp - sheriff.hp) * 2 : belief.law * 1.8 - belief.outlaw * 1.6 + threat * 0.4;
    if (role === "deputy") {
      if (target.id === sheriff?.id) return -100;
      return belief.outlaw * 2.4 - belief.law * 2 + threat;
    }
    if (role === "sheriff") {
      let score = belief.outlaw * 2.4 - belief.law * 2 + threat;
      if (target.hp === 1 && belief.law > belief.outlaw) score -= 14;
      return score;
    }
    if (role === "renegade") {
      const alive = state.players.filter((player) => player.alive);
      if (alive.length === 2) return target.id === sheriff?.id ? 30 : 20;
      if (target.id === sheriff?.id) return sheriff.hp <= 2 ? -18 : 2 + threat * 0.3;
      return threat + belief.law * 0.5 + belief.outlaw * 0.5;
    }
    return threat;
  }

  isLikelyAlly(role, target, belief, state) {
    const sheriff = state.players.find((player) => player.role?.id === "sheriff");
    if (["sheriff", "deputy"].includes(role)) return target.id === sheriff?.id || belief.law > belief.outlaw + 2;
    if (role === "outlaw") return target.id !== sheriff?.id && belief.outlaw > belief.law + 2;
    return false;
  }

  cardValue(card, state, me) {
    let value = 3;
    if (card.type === "beer") value = me.hp <= 2 ? 14 : me.hp < me.maxHp ? 9 : 4;
    else if (card.type === "missed") value = me.hp <= 2 ? 13 : 8;
    else if (card.type === "bang") value = me.role?.id === "outlaw" || me.character?.id === "willy" ? 9 : 6;
    else if (DRAW_CARDS.has(card.type)) value = card.type === "wells_fargo" ? 12 : 9;
    else if (["barrel", "mustang"].includes(card.type)) value = me.hp <= 2 ? 11 : 7;
    else if (card.type === "scope" || card.kind === "weapon") value = 5 + (card.range ?? 0);
    else if (["duel", "panic", "cat_balou", "jail"].includes(card.type)) value = 7;
    else if (["gatling", "indians"].includes(card.type)) value = 5;
    else if (card.type === "dynamite") value = me.hp <= 2 ? 0 : 3;
    if (me.character?.id === "calamity" && ["bang", "missed"].includes(card.type)) value += 2;
    return value;
  }

  lowestCards(cards, state, me, count) {
    return [...cards].sort((a, b) => this.cardValue(a, state, me) - this.cardValue(b, state, me) || this.random() - 0.5).slice(0, count);
  }

  bestCard(cards, state, me) { return [...cards].sort((a, b) => this.cardValue(b, state, me) - this.cardValue(a, state, me))[0]; }
  publicEquipmentValue(card) { return card.kind === "weapon" ? 6 + (card.range ?? 1) : ({ barrel: 9, mustang: 8, scope: 7, dynamite: 6, jail: 5 })[card.type] ?? 4; }

  nextAlive(state, playerId) {
    const start = state.players.findIndex((player) => player.id === playerId);
    for (let offset = 1; offset < state.players.length; offset += 1) {
      const candidate = state.players[(start + offset) % state.players.length];
      if (candidate.alive) return candidate;
    }
    return null;
  }
}

export class BotManager {
  constructor({ getState, perform, random = Math.random, minDelayMs = 1200, maxDelayMs = 3200 }) {
    this.getState = getState;
    this.perform = perform;
    this.random = random;
    this.minDelayMs = Math.max(0, Number(minDelayMs));
    this.maxDelayMs = Math.max(this.minDelayMs, Number(maxDelayMs));
    this.bots = new Map();
    this.timers = new Map();
    this.destroyed = false;
  }

  add(botId) { if (!this.bots.has(botId)) this.bots.set(botId, new RuleBasedBangBot({ id: botId, random: this.random })); }

  remove(botId) {
    const timer = this.timers.get(botId); if (timer) clearTimeout(timer);
    this.timers.delete(botId); this.bots.delete(botId);
  }

  poke() {
    if (this.destroyed) return;
    for (const [botId, bot] of this.bots) {
      if (this.timers.has(botId)) continue;
      const state = this.getState(botId);
      if (!bot.canAct(state)) continue;
      const delay = this.minDelayMs + Math.floor(this.random() * (this.maxDelayMs - this.minDelayMs + 1));
      const timer = setTimeout(() => this.run(botId), delay);
      timer.unref?.(); this.timers.set(botId, timer);
    }
  }

  async run(botId) {
    this.timers.delete(botId);
    if (this.destroyed) return;
    const bot = this.bots.get(botId); const state = this.getState(botId);
    if (!bot || !bot.canAct(state)) return this.poke();
    const action = bot.chooseAction(state);
    if (!action) return;
    let result;
    try { result = await this.perform(botId, action); } catch (error) { result = { ok: false, error: error.message }; }
    if (!result?.ok) bot.rememberFailure(state.revision, action);
    this.poke();
  }

  destroy() {
    this.destroyed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.bots.clear();
  }
}
