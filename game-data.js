export const ROLES = {
  sheriff: { name: "보안관", goal: "모든 무법자와 배신자를 처단하세요.", image: "01_sceriffo.png" },
  deputy: { name: "부관", goal: "보안관을 보호하며 모든 무법자와 배신자를 처단하세요.", image: "01_vice.png" },
  outlaw: { name: "무법자", goal: "보안관을 제거하세요.", image: "01_fuorilegge.png" },
  renegade: { name: "배신자", goal: "마지막 생존자가 되세요.", image: "01_rinnegato.png" }
};

export const ROLE_SETS = {
  4: ["sheriff", "outlaw", "outlaw", "renegade"],
  5: ["sheriff", "deputy", "outlaw", "outlaw", "renegade"],
  6: ["sheriff", "deputy", "outlaw", "outlaw", "outlaw", "renegade"],
  7: ["sheriff", "deputy", "deputy", "outlaw", "outlaw", "outlaw", "renegade"]
};

export const CHARACTERS = [
  ["willy", "윌리 더 키드", 4, "자기 차례에 <뱅!>을 원하는 만큼 사용할 수 있습니다.", "01_willythekid.png"],
  ["calamity", "캘러미티 자넷", 4, "<뱅!>과 <빗나감!>을 서로 바꾸어 사용할 수 있습니다.", "01_calamityjanet.png"],
  ["kit", "키트 칼슨", 4, "카드 가져오기 단계에 세 장을 보고 두 장을 선택합니다.", "01_kitcarlson.png"],
  ["bart", "바트 캐시디", 4, "생명력 1을 잃을 때마다 카드 한 장을 가져옵니다.", "01_bartcassidy.png"],
  ["sid", "시드 케첨", 4, "자기 차례에 카드 두 장을 버려 생명력 1을 회복할 수 있습니다.", "01_sidketchum.png"],
  ["lucky", "럭키 듀크", 4, "카드 펼치기를 할 때 두 장 중 한 장을 선택합니다.", "01_luckyduke.png"],
  ["jourdonnais", "주르도네", 4, "<뱅!>의 표적이 될 때마다 술통처럼 카드 펼치기를 할 수 있습니다.", "01_jourdonnais.png"],
  ["blackjack", "블랙 잭", 4, "두 번째로 가져온 카드가 하트나 다이아몬드면 한 장 더 가져옵니다.", "01_blackjack.png"],
  ["vulture", "벌쳐 샘", 4, "제거된 플레이어가 가진 모든 카드를 가져옵니다.", "01_vulturesam.png"],
  ["jesse", "제시 존스", 4, "첫 번째 카드를 다른 플레이어의 손에서 무작위로 가져올 수 있습니다.", "01_jessejones.png"],
  ["suzy", "수지 라파예트", 4, "손에 카드가 한 장도 없으면 즉시 한 장을 가져옵니다.", "01_suzylafayette.png"],
  ["pedro", "페드로 라미레즈", 4, "첫 번째 카드를 버린 카드 더미 맨 위에서 가져올 수 있습니다.", "01_pedroramirez.png"],
  ["slab", "슬랩 더 킬러", 4, "슬랩의 <뱅!>은 <빗나감!> 두 장으로 막아야 합니다.", "01_slab.png"],
  ["rose", "로즈 둘란", 4, "다른 플레이어를 볼 때 거리가 1 가까워집니다.", "01_rosedoolan.png"],
  ["paul", "폴 리그레트", 3, "다른 플레이어가 볼 때 거리가 1 멀어집니다.", "01_paulregret.png"],
  ["elgringo", "엘 그링고", 3, "생명력 1을 잃을 때마다 공격자의 손에서 카드 한 장을 가져옵니다.", "01_elgringo.png"]
].map(([id, name, hp, ability, image]) => ({ id, name, hp, ability, image }));

const CARD_TYPES = {
  bang: ["뱅!", "상대 한 명에게 뱅! 공격을 합니다.", "bang", "01_bang.png"],
  beer: ["맥주", "생명력 1을 회복합니다. 생존자가 2명뿐이면 효과가 없습니다.", "instant", "01_birra.png"],
  cat_balou: ["캣 벌로우", "거리와 관계없이 상대의 카드 한 장을 버립니다.", "target-card", "01_catbalou.png"],
  duel: ["결투", "서로 번갈아 뱅!을 내며, 먼저 내지 못한 사람이 생명력 1을 잃습니다.", "duel", "01_duello.png"],
  gatling: ["기관총", "자신을 제외한 모두에게 뱅! 공격을 합니다.", "multi-bang", "01_gatling.png"],
  general_store: ["잡화점", "생존자 수만큼 공개하고 차례대로 한 장씩 가져갑니다.", "store", "01_emporio.png"],
  indians: ["인디언", "자신을 제외한 모두가 뱅!을 내거나 생명력 1을 잃습니다.", "indians", "01_indiani.png"],
  missed: ["빗나감!", "뱅! 공격을 피합니다.", "response", "01_mancato.png"],
  panic: ["강탈", "거리 1인 플레이어에게서 카드 한 장을 가져옵니다.", "target-card", "01_panico.png"],
  saloon: ["주점", "모든 생존자가 생명력 1을 회복합니다.", "instant", "01_saloon.png"],
  stagecoach: ["역마차", "카드 두 장을 가져옵니다.", "instant", "01_diligenza.png"],
  wells_fargo: ["웰스 파고 은행", "카드 세 장을 가져옵니다.", "instant", "01_wellsfargo.png"],
  barrel: ["술통", "뱅!의 표적이 되었을 때 하트 카드가 펼쳐지면 피합니다.", "equipment", "01_barile.png"],
  dynamite: ["다이너마이트", "차례 시작에 스페이드 2-9가 펼쳐지면 생명력 3을 잃습니다.", "equipment", "01_dinamite.png"],
  jail: ["감옥", "차례 시작에 하트가 아니면 그 차례를 건너뜁니다.", "equipment-target", "01_prigione.png"],
  mustang: ["야생마", "다른 사람이 나를 볼 때 거리가 1 멀어집니다.", "equipment", "01_mustang.png"],
  scope: ["조준경", "다른 사람을 볼 때 거리가 1 가까워집니다.", "equipment", "01_mirino.png"],
  remington: ["레밍턴", "뱅! 사정거리가 3이 됩니다.", "weapon", "01_remington.png", 3],
  carabine: ["카빈", "뱅! 사정거리가 4가 됩니다.", "weapon", "01_carabine.png", 4],
  schofield: ["스코필드", "뱅! 사정거리가 2가 됩니다.", "weapon", "01_schofield.png", 2],
  volcanic: ["볼캐닉", "사정거리 1, 뱅!을 원하는 만큼 사용할 수 있습니다.", "weapon", "01_volcanic.png", 1],
  winchester: ["윈체스터", "뱅! 사정거리가 5가 됩니다.", "weapon", "01_winchester.png", 5]
};

export const CARD_INFO = Object.fromEntries(Object.entries(CARD_TYPES).map(([id, [name, description, kind, image, range]]) => [id, { id, name, description, kind, image, range }]));

const S = { H: "heart", D: "diamond", S: "spade", C: "club" };
const cards = [];
function add(type, suit, ranks) { for (const rank of ranks) cards.push({ type, suit: S[suit], rank: String(rank) }); }
add("bang", "S", ["A"]); add("bang", "D", ["A",2,3,4,5,6,7,8,9,10,"J","Q","K"]); add("bang", "C", [2,3,4,5,6,7,8,9]); add("bang", "H", ["A","Q","K"]);
add("beer", "H", [6,7,8,9,10,"J"]); add("cat_balou", "H", ["K"]); add("cat_balou", "D", [9,10,"J"]);
add("duel", "D", ["Q"]); add("duel", "S", ["J"]); add("duel", "C", [8]); add("gatling", "H", [10]);
add("general_store", "C", [9]); add("general_store", "S", ["Q"]); add("indians", "D", ["A","K"]);
add("missed", "C", ["A",10,"J","Q","K"]); add("missed", "S", [2,3,4,5,6,7,8]);
add("panic", "H", ["A","J","Q"]); add("panic", "D", [8]); add("saloon", "H", [5]); add("stagecoach", "S", [9,9]); add("wells_fargo", "H", [3]);
add("barrel", "S", ["Q","K"]); add("dynamite", "H", [2]); add("jail", "S", [10,"J"]); add("jail", "H", [4]);
add("mustang", "H", [8,9]); add("scope", "S", ["A"]); add("remington", "C", ["K"]); add("carabine", "C", ["A"]);
add("schofield", "C", ["J","Q"]); add("schofield", "S", ["K"]); add("volcanic", "C", [10]); add("volcanic", "S", [10]); add("winchester", "S", [8]);
export const BASE_DECK = cards;

export const SUIT_SYMBOL = { heart: "♥", diamond: "♦", spade: "♠", club: "♣" };
export const RULE_SUMMARY = [
  ["목표", "보안관·부관은 무법자와 배신자를 제거합니다. 무법자는 보안관을 제거하고, 배신자는 마지막 생존자가 되어야 합니다."],
  ["차례", "다이너마이트 → 감옥 → 카드 2장 가져오기 → 카드 사용 → 현재 생명력만큼 손패 제한 순으로 진행합니다."],
  ["거리", "양방향으로 가장 가까운 생존자 수가 기본 거리입니다. 무기 사정거리와 조준경·야생마·캐릭터 효과를 적용합니다."],
  ["제거", "무법자를 제거한 사람은 카드 3장을 받고, 보안관이 부관을 제거하면 손패와 장착 카드를 모두 버립니다."],
  ["카드 펼치기", "카드 더미 맨 위 카드를 공개해 문양·숫자를 확인한 뒤 버린 카드 더미에 둡니다."]
];
