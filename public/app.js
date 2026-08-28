import { CARD_INFO, CHARACTERS, ROLES, RULE_SUMMARY, SUIT_SYMBOL } from "/game-data.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let token = localStorage.getItem("bang.token");
let state = null;
let source = null;
let inviteUrl = "";
let choiceCards = new Set();
let toastTimer = null;
let setupTimer = null;
let roleIntroShown = false;
let judgmentHideTimer = null;
let lastAnnouncementId = null;
let victoryDismissed = false;
let unreadChat = false;
const mobileSocialQuery = window.matchMedia("(max-width: 980px)");
const joinId = new URLSearchParams(location.search).get("join");

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2600); }
async function request(path, body) { const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "요청에 실패했습니다."); return result; }
async function send(action) { try { await request("/api/action", { token, action }); return true; } catch (error) { showToast(error.message); return false; } }

function connect() {
  source?.close(); source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener("state", (event) => {
    const previousPhase = state?.phase;
    const next = JSON.parse(event.data);
    if (!next.log) { const known = new Map((state?.log ?? []).map((entry) => [entry.id, entry])); (next.logDelta ?? []).forEach((entry) => known.set(entry.id, entry)); next.log = [...known.values()].slice(-240); }
    delete next.logDelta; next.chat ??= state?.chat ?? []; state = next;
    $("#home").classList.add("hidden"); $("#game").classList.remove("hidden"); render(); handleSetup(previousPhase); handleJudgment(); handleVictory();
  });
  source.addEventListener("chat", (event) => {
    const message = JSON.parse(event.data);
    if (state) {
      state.chat.push(message); renderSocial();
      if (message.playerId !== state.me && !isChatVisible()) unreadChat = true;
      renderChatAlerts();
    }
  });
  source.addEventListener("session_closed", () => {
    source.close(); source = null; token = null; localStorage.removeItem("bang.token");
    const homeUrl = new URL(location.href); homeUrl.search = ""; homeUrl.hash = ""; location.replace(homeUrl);
  });
  source.onerror = () => { $("#connection").textContent = "재연결 중…"; };
}

async function restore() {
  if (!token) return setupEntry();
  try { await request("/api/reconnect", { token }); $("#forget-session").classList.remove("hidden"); connect(); }
  catch { token = null; localStorage.removeItem("bang.token"); setupEntry(); }
}

function setupEntry() {
  if (joinId) { $("#home-mode").textContent = "WANTED · INVITATION"; $("#home-title").textContent = "게임 참가하기"; $("#home-copy").textContent = "초대받은 방에 들어갈 별명을 정하세요."; $("#entry-button").textContent = "황야에 입장"; }
}

$("#entry-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const nickname = $("#nickname").value.trim(); $("#home-error").textContent = "";
  try { const result = await request(joinId ? "/api/join" : "/api/create", joinId ? { sessionId: joinId, nickname } : { nickname }); token = result.token; inviteUrl = result.inviteUrl || ""; localStorage.setItem("bang.token", token); connect(); }
  catch (error) { $("#home-error").textContent = error.message; }
});
$("#forget-session").addEventListener("click", () => { localStorage.removeItem("bang.token"); location.reload(); });

function imagePath(kind, filename) { return `/assets/${kind}/${filename}`; }
function cardImage(card) { return imagePath("playing_card", card.image); }
function suitClass(card) { return ["heart", "diamond"].includes(card.suit) ? "red-suit" : "black-suit"; }
function cardNode(card, options = {}) {
  const button = document.createElement(options.static ? "article" : "button"); button.className = `playing-card ${options.small ? "small" : ""} ${options.selected ? "selected" : ""}`;
  button.innerHTML = `<img src="${cardImage(card)}" alt="${escapeHtml(card.name)}"><span class="card-name-strip">${escapeHtml(card.name)}</span><span class="card-corner ${suitClass(card)}">${SUIT_SYMBOL[card.suit]} ${card.rank}</span><span class="card-tooltip"><b>${escapeHtml(card.name)}</b><small>${SUIT_SYMBOL[card.suit]} ${card.rank}</small>${escapeHtml(card.description)}</span>`;
  if (!options.static && options.onClick) button.addEventListener("click", options.onClick); return button;
}

function render() {
  const me = state.players.find((p) => p.id === state.me); const connected = state.players.filter((p) => p.connected).length;
  $("#connection").textContent = `${connected}/${state.players.length}명 연결 · 실시간`;
  $("#deck-count").textContent = state.deckCount;
  renderPlayers(me); renderIdentity(me); renderHand(me); renderCenter(me); renderDiscard(); renderSocial();
}

function renderPlayers(me) {
  const ring = $("#players"); ring.replaceChildren();
  state.players.forEach((player, index) => {
    const node = document.createElement("article"); node.className = `player-seat seat-${index} ${player.id === state.currentPlayerId ? "current" : ""} ${!player.alive ? "dead" : ""}`;
    const role = player.role ? `<img class="role-chip" src="${imagePath("role_card", player.role.image)}" alt="${player.role.name}">` : `<span class="role-back">?</span>`;
    const equipment = player.equipment.map((card) => `<span title="${escapeHtml(card.description)}"><img src="${cardImage(card)}" alt="${escapeHtml(card.name)}"></span>`).join("");
    const avatar = player.character ? `<img class="avatar" src="${imagePath("character_card", player.character.image)}" alt="${player.character.name}">` : `<span class="avatar avatar-back">★</span>`;
    const health = player.maxHp ? `${"♥".repeat(Math.max(0, player.hp))} ${player.hp}/${player.maxHp}` : player.character ? "인물 선택 완료" : "준비 중";
    node.innerHTML = `<div class="seat-card">${avatar}<div class="seat-copy"><strong>${player.isBot ? '<em class="bot-badge">BOT</em>' : ""}${escapeHtml(player.nickname)}</strong><span>${player.alive ? health : "제거됨"}</span><small>${player.character?.name ?? "인물 선택 중"} · ${player.handCount}장</small></div>${role}</div><div class="equipment-row">${equipment}</div><i class="connection-dot ${player.connected ? "online" : ""}"></i>`;
    ring.append(node);
  });
}

function renderIdentity(me) {
  $("#my-name").textContent = me.nickname; $("#my-role").textContent = me.role ? `${me.role.name} · ${me.role.goal}` : "숨겨진 역할";
  $("#my-hp").textContent = me.maxHp ? `${"♥".repeat(Math.max(0, me.hp))} ${me.hp}/${me.maxHp}` : state.phase === "lobby" ? "입장 대기" : "게임 준비 중";
  $("#my-character").innerHTML = me.character ? `<img src="${imagePath("character_card", me.character.image)}" alt="${me.character.name}">` : "★";
}

function renderHand(me) {
  const hand = $("#hand"); hand.replaceChildren();
  if (!me.hand?.length) { hand.innerHTML = `<p class="empty-note">손에 카드가 없습니다.</p>`; return; }
  const playable = state.phase === "playing" && state.currentPlayerId === state.me && state.turnPhase === "play" && !state.pending;
  const discarding = state.turnPhase === "discard" && state.currentPlayerId === state.me && !state.pending;
  me.hand.forEach((card) => hand.append(cardNode(card, { onClick: () => discarding ? send({ type: "discard", cardId: card.id }) : playable ? beginCardPlay(card) : showToast("지금은 이 카드를 사용할 수 없습니다.") })));
  $("#hand-help").textContent = discarding ? `생명력 ${me.hp}장 이하가 되도록 버리세요.` : playable ? "카드를 눌러 사용하세요." : "현재 진행 중인 행동을 기다리고 있습니다.";
}

function phaseCopy(me) {
  if (state.phase === "lobby") return ["입장 대기", `${state.players.length}/7명의 총잡이가 모였습니다`, state.players.length < 4 ? "4명 이상 모이면 게임을 시작할 수 있습니다." : state.hostId === state.me ? "초대가 끝났다면 게임을 시작하세요." : "방장이 게임을 시작하기를 기다립니다."];
  if (state.phase === "character_selection") { const selected = state.players.filter((player) => player.character).length; return ["인물 선택", `${selected}/${state.players.length}명 선택 완료`, me.character ? "다른 플레이어가 인물을 고르는 중입니다." : "제시된 두 인물 카드 중 한 장을 선택하세요."]; }
  if (state.phase === "dealing") return ["손패 분배", "시작 카드를 나누는 중입니다", "각자의 생명력만큼 카드를 분배하고 있습니다."];
  if (state.phase === "game_over") return ["게임 종료", `${state.winners.map((id) => ROLES[id].name).join(" · ")} 승리`, "역할을 확인하고 새 결투를 준비하세요."];
  if (state.pending) {
    if (state.pending.mine) return ["응답 필요", pendingTitle(state.pending), "선택을 마쳐야 게임이 계속됩니다."];
    const responder = state.players.find((p) => p.id === state.pending.responderId); return ["결정 대기", `${responder?.nickname ?? "다른 플레이어"}님의 선택을 기다립니다`, pendingTitle(state.pending)];
  }
  const current = state.players.find((p) => p.id === state.currentPlayerId); const mine = current.id === state.me;
  const copy = { start: "차례 시작 효과를 처리합니다.", draw: "카드 가져오기 단계입니다.", play: mine ? "카드를 사용하거나 차례를 마치세요." : "카드 사용 단계입니다.", discard: "손패 제한에 맞게 카드를 버립니다." };
  return [state.turnPhase?.toUpperCase() || "PLAY", mine ? "당신의 차례입니다" : `${current.nickname}님의 차례`, copy[state.turnPhase] || "게임이 진행 중입니다."];
}

function pendingTitle(pending) {
  const judgmentName = pending.reason === "dynamite" ? "다이너마이트" : pending.reason === "jail" ? "감옥" : pending.judgmentSource === "jourdonnais" ? "주르도네 능력" : "술통";
  return ({ bang: `뱅! 방어 — 빗나감! ${pending.needed}장 필요`, duel: "결투 — 뱅!을 내거나 피해를 받습니다", indians: "인디언 — 뱅!을 내거나 피해를 받습니다", dying: "쓰러짐 — 맥주로 생존하세요", judgment_wait: `${judgmentName} — 카드를 뒤집으세요`, judgment_choice: "럭키 듀크 — 판정 카드 한 장을 고르세요", kit_draw: "키트 칼슨 — 가져갈 두 장을 고르세요", draw_source: "첫 번째 카드를 어디서 가져올까요?", store: "잡화점 — 한 장을 고르세요" })[pending.type] || "선택이 필요합니다";
}

function renderCenter(me) {
  const [kicker, title, copy] = phaseCopy(me); $("#phase-kicker").textContent = kicker; $("#turn-title").textContent = title; $("#turn-copy").textContent = copy;
  const actions = $("#actions"); actions.replaceChildren();
  if (state.phase === "lobby") {
    if (state.hostId === state.me) { actions.append(actionButton("초대 링크 복사", copyInvite)); actions.append(actionButton("봇 추가", addBot, "", state.players.length >= 7)); actions.append(actionButton("게임 시작", () => send({ type: "start" }), "primary", state.players.length < 4)); }
    return;
  }
  if (["character_selection", "dealing"].includes(state.phase)) return;
  if (state.phase === "game_over") { if (state.hostId === state.me) actions.append(actionButton("같은 멤버로 새 게임", restart, "primary")); return; }
  if (state.pending?.mine) {
    renderPending(actions, me);
    if (me.character?.id === "sid" && me.hp < me.maxHp && me.hand.length >= 2) actions.append(actionButton("시드 케첨 능력", () => chooseSid(me)));
    return;
  }
  if (!state.pending && me.character?.id === "sid" && me.hp < me.maxHp && me.hand.length >= 2) actions.append(actionButton("시드 케첨 능력", () => chooseSid(me)));
  if (state.currentPlayerId === state.me && state.turnPhase === "play" && !state.pending) {
    actions.append(actionButton("차례 마치기", () => send({ type: "endTurn" }), "primary"));
  }
}

function renderPending(actions, me) {
  const p = state.pending;
  if (p.type === "judgment_wait") {
    actions.append(actionButton("카드 뒤집기", () => send({ type: "flipJudgment" }), "judgment-button"));
  } else if (["bang", "duel", "indians", "dying"].includes(p.type)) {
    const neededType = p.type === "bang" ? "missed" : p.type === "dying" ? "beer" : "bang";
    const usable = me.hand.filter((card) => card.type === neededType || (me.character.id === "calamity" && ((neededType === "bang" && card.type === "missed") || (neededType === "missed" && card.type === "bang"))));
    usable.forEach((card) => actions.append(actionButton(`<${card.name}> 사용`, () => send({ type: "respond", cardId: card.id }))));
    actions.append(actionButton(p.type === "dying" ? "포기하고 제거" : "카드 내지 않기", () => send({ type: "respond" }), "danger"));
  } else if (["judgment_choice", "kit_draw", "store"].includes(p.type)) {
    p.cards.forEach((card) => actions.append(actionButton(`${card.name} ${SUIT_SYMBOL[card.suit]}${card.rank}`, () => pickPendingCard(p, card))));
    if (p.type === "kit_draw") actions.append(actionButton(`선택 확정 (${choiceCards.size}/2)`, confirmKit, "primary", choiceCards.size !== 2));
  } else if (p.type === "draw_source") {
    actions.append(actionButton("카드 더미", () => send({ type: "drawSource", source: "deck" }), "primary"));
    if (p.canPedro) actions.append(actionButton("버린 카드 맨 위 (페드로)", () => send({ type: "drawSource", source: "discard" })));
    if (p.canJesse) state.players.filter((player) => player.alive && player.id !== state.me && player.handCount).forEach((player) => actions.append(actionButton(`${player.nickname}의 손 (제시)`, () => send({ type: "drawSource", source: player.id }))));
  }
}

function pickPendingCard(pending, card) {
  if (pending.type === "judgment_choice") send({ type: "judgment", cardId: card.id });
  else if (pending.type === "store") send({ type: "storePick", cardId: card.id });
  else { choiceCards.has(card.id) ? choiceCards.delete(card.id) : choiceCards.size < 2 && choiceCards.add(card.id); renderCenter(state.players.find((p) => p.id === state.me)); }
}
function confirmKit() { const ids = [...choiceCards]; choiceCards.clear(); send({ type: "kitDraw", cardIds: ids }); }
function actionButton(label, onClick, className = "", disabled = false) { const button = document.createElement("button"); button.textContent = label; button.className = className; button.disabled = disabled; button.addEventListener("click", onClick); return button; }

function beginCardPlay(card) {
  const targetKinds = ["bang", "duel", "target-card", "equipment-target"];
  if (!targetKinds.includes(card.kind)) return send({ type: "play", cardId: card.id });
  const targets = state.players.filter((player) => player.alive && (card.type === "cat_balou" || player.id !== state.me) && !(card.type === "jail" && player.role?.id === "sheriff"));
  openChoice(`대상 선택 · ${card.name}`, card.description, targets.map((player) => ({ label: `${player.nickname}${player.distance ? ` · 거리 ${player.distance}` : ""}`, image: player.character ? imagePath("character_card", player.character.image) : null, onClick: () => chooseTargetCard(card, player) })));
}

function chooseTargetCard(card, target) {
  if (!["panic", "cat_balou"].includes(card.type)) { closeChoice(); return send({ type: "play", cardId: card.id, targetId: target.id }); }
  const choices = [];
  const hiddenCount = target.id === state.me ? target.handCount - 1 : target.handCount;
  if (hiddenCount > 0) choices.push({ label: `손패에서 무작위 1장 (${hiddenCount}장)`, onClick: () => { closeChoice(); send({ type: "play", cardId: card.id, targetId: target.id, targetCardId: "hand" }); } });
  target.equipment.forEach((item) => choices.push({ label: `장착: ${item.name}`, image: cardImage(item), onClick: () => { closeChoice(); send({ type: "play", cardId: card.id, targetId: target.id, targetCardId: item.id }); } }));
  openChoice(`${target.nickname}님의 카드`, "손패는 무작위로, 공개된 장착 카드는 직접 골라 처리합니다.", choices);
}

function chooseSid(me) {
  choiceCards.clear();
  openChoice("시드 케첨 능력", "버릴 카드 두 장을 고르세요.", me.hand.map((card) => ({ label: `${card.name} ${SUIT_SYMBOL[card.suit]}${card.rank}`, image: cardImage(card), toggle: card.id })), () => send({ type: "sid", cardIds: [...choiceCards] }), 2);
}

function openChoice(title, copy, choices, confirm = null, required = 0) {
  $("#choice-title").textContent = title; $("#choice-copy").textContent = copy; const options = $("#choice-options"); options.replaceChildren();
  choices.forEach((choice) => { const button = actionButton(choice.label, () => { if (choice.toggle) { choiceCards.has(choice.toggle) ? choiceCards.delete(choice.toggle) : choiceCards.size < required && choiceCards.add(choice.toggle); button.classList.toggle("selected", choiceCards.has(choice.toggle)); confirmButton && (confirmButton.disabled = choiceCards.size !== required); } else choice.onClick(); }); if (choice.image) button.innerHTML = `<img src="${choice.image}" alt=""><span>${escapeHtml(choice.label)}</span>`; options.append(button); });
  let confirmButton = null; if (confirm) { confirmButton = actionButton("선택 확정", () => { closeChoice(); confirm(); }, "primary", true); options.append(confirmButton); }
  $("#choice-dialog").showModal();
}
function closeChoice() { $("#choice-dialog").close(); }

function showSetup(stage, kicker, title, copy, icon = "★") {
  const overlay = $("#setup-overlay");
  $("#setup-kicker").textContent = kicker; $("#setup-title").textContent = title; $("#setup-copy").textContent = copy; $("#setup-icon").innerHTML = icon;
  $$(".setup-steps i").forEach((step, index) => step.classList.toggle("active", index <= stage));
  overlay.classList.remove("hidden"); overlay.dataset.stage = String(stage);
}

function hideSetup() { $("#setup-overlay").classList.add("hidden"); }

function closeCharacterDialog() {
  const dialog = $("#character-dialog"); if (dialog.open) dialog.close();
}

function openCharacterDialog() {
  if (state.phase !== "character_selection" || !state.characterOptions?.length) return;
  hideSetup(); const dialog = $("#character-dialog"); const container = $("#character-options"); container.replaceChildren();
  state.characterOptions.forEach((character) => {
    const button = document.createElement("button"); button.className = "character-choice-card";
    button.innerHTML = `<img src="${imagePath("character_card", character.image)}" alt="${escapeHtml(character.name)}"><div><span>${character.hp} HP</span><h3>${escapeHtml(character.name)}</h3><p>${escapeHtml(character.ability)}</p><b>이 인물 선택</b></div>`;
    button.addEventListener("click", async () => {
      container.querySelectorAll("button").forEach((item) => { item.disabled = true; }); button.classList.add("chosen");
      const ok = await send({ type: "chooseCharacter", characterId: character.id });
      if (!ok) { container.querySelectorAll("button").forEach((item) => { item.disabled = false; }); button.classList.remove("chosen"); return; }
      closeCharacterDialog(); showSetup(1, "CHARACTER LOCKED", `${character.name} 선택 완료`, "다른 플레이어의 선택을 기다리고 있습니다.", `<img src="${imagePath("character_card", character.image)}" alt="">`);
    });
    container.append(button);
  });
  if (!dialog.open) dialog.showModal();
}

function handleSetup(previousPhase) {
  const me = state.players.find((player) => player.id === state.me);
  if (state.phase === "lobby") { roleIntroShown = false; clearTimeout(setupTimer); setupTimer = null; hideSetup(); closeCharacterDialog(); return; }
  if (state.phase === "character_selection") {
    if (me.character) {
      clearTimeout(setupTimer); setupTimer = null; closeCharacterDialog();
      showSetup(1, "CHARACTER LOCKED", `${me.character.name} 선택 완료`, "다른 플레이어가 인물을 고르는 중입니다.", `<img src="${imagePath("character_card", me.character.image)}" alt="">`);
      return;
    }
    if (!roleIntroShown) {
      roleIntroShown = true; const role = me.role;
      showSetup(0, "ROLE ASSIGNED", `당신은 ${role.name}입니다`, role.goal, `<img src="${imagePath("role_card", role.image)}" alt="">`);
      clearTimeout(setupTimer); setupTimer = setTimeout(() => { setupTimer = null; openCharacterDialog(); }, 1650);
    } else if (!setupTimer && !$("#character-dialog").open) openCharacterDialog();
    return;
  }
  if (state.phase === "dealing") {
    clearTimeout(setupTimer); setupTimer = null; closeCharacterDialog();
    showSetup(2, "DEALING CARDS", "시작 손패를 분배하는 중…", "생명력만큼 카드를 받고 곧 보안관의 차례로 시작합니다.", "✦");
    return;
  }
  if (state.phase === "playing" && previousPhase === "dealing") {
    showSetup(2, "READY", "결투를 시작합니다!", "행운을 빕니다, 총잡이.", "BANG!");
    clearTimeout(setupTimer); setupTimer = setTimeout(() => { setupTimer = null; hideSetup(); }, 720);
  } else if (state.phase === "playing") hideSetup();
}

function judgmentLabel(reason) { return reason === "dynamite" ? "다이너마이트" : reason === "jail" ? "감옥" : "술통"; }

function handleJudgment() {
  const overlay = $("#judgment-overlay");
  const announcement = state.announcement;
  if (announcement?.type === "judgment" && announcement.id !== lastAnnouncementId) {
    lastAnnouncementId = announcement.id; clearTimeout(judgmentHideTimer);
    const card = announcement.card;
    $("#judgment-kicker").textContent = `${judgmentLabel(announcement.reason)} · RESULT`;
    $("#judgment-title").textContent = `${announcement.playerName}님의 판정 결과`;
    $("#judgment-card").innerHTML = `<img src="${cardImage(card)}" alt="${escapeHtml(card.name)}"><div><strong>${escapeHtml(card.name)}</strong><b class="${suitClass(card)}">${SUIT_SYMBOL[card.suit]} ${card.rank}</b></div>`;
    $("#judgment-card").classList.remove("hidden");
    $("#judgment-copy").innerHTML = `<strong>${escapeHtml(announcement.result)}</strong><span>${SUIT_SYMBOL[card.suit]} ${card.rank} · ${escapeHtml(card.name)}</span>`;
    overlay.classList.remove("hidden");
    judgmentHideTimer = setTimeout(() => overlay.classList.add("hidden"), 3000);
  } else if (!judgmentHideTimer) overlay.classList.add("hidden");
}

function handleVictory() {
  const overlay = $("#victory-overlay");
  if (state.phase !== "game_over") { victoryDismissed = false; overlay.classList.add("hidden"); return; }
  if (victoryDismissed) return;
  const winnerNames = state.winners.map((id) => ROLES[id].name);
  const winningPlayers = state.players.filter((player) => player.role && state.winners.includes(player.role.id));
  $("#victory-roles").innerHTML = state.winners.map((id) => `<img src="${imagePath("role_card", ROLES[id].image)}" alt="${escapeHtml(ROLES[id].name)}">`).join("");
  $("#victory-title").textContent = `${winnerNames.join(" · ")} 승리`;
  $("#victory-copy").textContent = winningPlayers.length ? `승리한 총잡이: ${winningPlayers.map((player) => player.nickname).join(", ")}` : "황야의 결투가 끝났습니다.";
  overlay.classList.remove("hidden");
}

function renderDiscard() { const card = state.discardTop; const node = $("#discard-card"); if (!card) { node.className = "mini-card empty"; node.innerHTML = "<span>버린 카드</span>"; } else { node.className = "mini-card"; node.innerHTML = `<img src="${cardImage(card)}" alt="${card.name}"><span>${SUIT_SYMBOL[card.suit]}${card.rank}</span>`; } }
function renderSocial() {
  if (!state) return; const log = $("#log-list"); const logBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.innerHTML = state.log.map((entry) => `<article class="log ${entry.tone}"><small>${new Date(entry.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</small><p>${escapeHtml(entry.text)}</p></article>`).join(""); if (logBottom) log.scrollTop = log.scrollHeight;
  const chat = $("#chat-list"); const chatBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80; chat.innerHTML = state.chat.map((message) => `<article class="chat ${message.playerId === state.me ? "mine" : ""}"><small>${escapeHtml(message.nickname)}</small><p>${escapeHtml(message.text)}</p></article>`).join("") || `<p class="empty-note">아직 채팅이 없습니다.</p>`; if (chatBottom) chat.scrollTop = chat.scrollHeight;
}

function isSocialPanelVisible() { return !mobileSocialQuery.matches || $("#social-panel").classList.contains("mobile-open"); }
function isChatVisible() { return document.visibilityState === "visible" && isSocialPanelVisible() && $('[data-tab="chat"]').classList.contains("active"); }
function renderChatAlerts() {
  $("#chat-tab-dot").classList.toggle("hidden", !unreadChat);
  const showTopAlert = unreadChat && mobileSocialQuery.matches && !$("#social-panel").classList.contains("mobile-open");
  $("#chat-dot").classList.toggle("hidden", !showTopAlert);
}
function markChatRead() { unreadChat = false; renderChatAlerts(); }

async function copyInvite() {
  const url = inviteUrl || `${location.origin}/?join=${state.sessionId}`;
  let copied = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(url); copied = true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = url; fallback.readOnly = true; fallback.setAttribute("aria-hidden", "true");
    fallback.style.position = "fixed"; fallback.style.left = "-9999px"; fallback.style.opacity = "0";
    document.body.append(fallback); fallback.select(); fallback.setSelectionRange(0, url.length);
    copied = document.execCommand("copy"); fallback.remove();
  }
  showToast(copied ? "초대 링크를 클립보드에 복사했습니다." : "링크를 복사하지 못했습니다. 브라우저 권한을 확인하세요.");
}
async function restart() { try { await request("/api/restart", { token }); } catch (error) { showToast(error.message); } }
async function addBot() {
  try { const result = await request("/api/bot", { token }); showToast(`${result.nickname} 봇이 참가했습니다.`); }
  catch (error) { showToast(error.message); }
}

function buildReferences() {
  $("#rules-content").innerHTML = `<div class="rule-grid">${RULE_SUMMARY.map(([title, body]) => `<article><span>✦</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div></article>`).join("")}</div><section class="role-grid">${Object.values(ROLES).map((role) => `<article><img src="${imagePath("role_card", role.image)}" alt="${role.name}"><div><h3>${role.name}</h3><p>${role.goal}</p></div></article>`).join("")}</section>`;
  $("#dictionary-content").innerHTML = Object.values(CARD_INFO).map((card) => `<article class="catalog-entry"><img src="${cardImage(card)}" alt="${card.name}"><div><h3>${card.name}</h3><small>${card.kind === "equipment" || card.kind === "weapon" || card.kind === "equipment-target" ? "장착 카드" : "사용 카드"}</small><p>${card.description}</p></div></article>`).join("") + `<h2 class="catalog-heading">인물 16종</h2>` + CHARACTERS.map((character) => `<article class="catalog-entry"><img src="${imagePath("character_card", character.image)}" alt="${character.name}"><div><h3>${character.name} · ${character.hp} 생명력</h3><p>${character.ability}</p></div></article>`).join("");
}

$$('[data-dialog]').forEach((button) => button.addEventListener("click", () => { $(`#${button.dataset.dialog}-dialog`).showModal(); }));
$$('.close-dialog').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#social-toggle").addEventListener("click", () => { $("#social-panel").classList.add("mobile-open"); if (isChatVisible()) markChatRead(); else renderChatAlerts(); });
$("#social-close").addEventListener("click", () => { $("#social-panel").classList.remove("mobile-open"); renderChatAlerts(); });
$$('[data-tab]').forEach((button) => button.addEventListener("click", () => { $$('[data-tab]').forEach((x) => x.classList.toggle("active", x === button)); $("#log-list").classList.toggle("hidden", button.dataset.tab !== "log"); $("#chat-list").classList.toggle("hidden", button.dataset.tab !== "chat"); $("#chat-form").classList.toggle("hidden", button.dataset.tab !== "chat"); if (button.dataset.tab === "chat" && isSocialPanelVisible()) markChatRead(); else renderChatAlerts(); }));
const handleSocialViewportChange = () => { if (isChatVisible()) markChatRead(); else renderChatAlerts(); };
if (mobileSocialQuery.addEventListener) mobileSocialQuery.addEventListener("change", handleSocialViewportChange); else mobileSocialQuery.addListener(handleSocialViewportChange);
document.addEventListener("visibilitychange", () => { if (isChatVisible()) markChatRead(); });
$("#character-dialog").addEventListener("cancel", (event) => event.preventDefault());
$("#victory-close").addEventListener("click", () => { victoryDismissed = true; $("#victory-overlay").classList.add("hidden"); });
$("#chat-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = $("#chat-input"); const text = input.value.trim(); if (!text) return; input.value = ""; try { await request("/api/chat", { token, text }); } catch (error) { showToast(error.message); } });

buildReferences(); restore();
