export type FeedUser = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarTone: number;
  stats: { records: number; followers: number; following: number };
};

export type FeedPost = {
  id: string;
  userId: string;
  image: string;
  //: 사진이 여러 장일 때 전체(앞이 대표 사진 = image). 한 장이면 비워 둔다.
  images?: readonly string[];
  label: string;
  size: "short" | "medium" | "tall";
  crop: number;
  glazeName: string;
  firing: string;
  cone: string;
  finish: string;
  clayBody: string;
  application: string;
  recipe: readonly { name: string; amount: number }[];
  colorants: readonly { name: string; amount: number }[];
  curve: readonly { minute: number; temperatureC: number }[];
  memo: string;
  publishedAt: string;
  kind?: "work" | "sale";
  price?: number | null;
  priceNegotiable?: boolean;
  saleDetails?: {
    condition: string;
    dimensions: string;
    location: string;
    delivery: string;
  };
};

const FEED_POST_COUNT = 3;

export const DUMMY_FOLLOWING: Readonly<Record<string, readonly string[]>> = {
  chloe: ["mira", "sena", "jun"],
  mira: ["sori", "haeun", "noa", "chae"],
  dohoon: ["chloe", "mira"],
  sena: ["mira", "jun", "yuna", "arin", "dami"],
  jun: ["dohoon", "haneul", "jiho"],
  haeun: ["sori", "tae", "boram", "chae"],
  noa: ["chloe", "sena", "leo"],
  yeon: ["dohoon", "jun", "haneul", "ian", "minu"],
  sori: ["mira", "haeun"],
  tae: ["chloe", "yeon", "sori", "yuna"],
  yuna: ["sena", "noa", "chae"],
  haneul: ["jun", "yeon", "jiho", "arin"],
  jiho: ["dohoon", "haneul", "ian"],
  boram: ["haeun", "sori"],
  ian: ["chloe", "jun", "yeon", "minu", "leo"],
  chae: ["mira", "sena", "yuna", "dami"],
  minu: ["dohoon", "jiho", "ian"],
  arin: ["sena", "haneul", "leo", "dami"],
  leo: ["noa", "ian"],
  dami: ["mira", "boram", "chae"],
};

export function dummyFollowingIds(userId: string) {
  return DUMMY_FOLLOWING[userId] ?? [];
}

export function dummyFollowerIds(userId: string) {
  return Object.entries(DUMMY_FOLLOWING).filter(([, ids]) => ids.includes(userId)).map(([id]) => id);
}

function dummyStats(userId: string) {
  return { records: FEED_POST_COUNT, followers: dummyFollowerIds(userId).length, following: dummyFollowingIds(userId).length };
}

export const FEED_USERS: readonly FeedUser[] = [
  { id: "chloe", username: "chloe.jung", displayName: "가마쟁이", bio: "가마 앞에서 매일 새로운 색을 실험합니다.", avatarTone: 1, stats: dummyStats("chloe") },
  { id: "mira", username: "mira.ceramic", displayName: "미라의 흙방", bio: "손으로 빚은 그릇과 흙의 질감을 기록해요.", avatarTone: 2, stats: dummyStats("mira") },
  { id: "dohoon", username: "dohoon.kiln", displayName: "도훈 소성실", bio: "온도와 시간을 쌓아 나만의 소성 곡선을 찾습니다.", avatarTone: 3, stats: dummyStats("dohoon") },
  { id: "sena", username: "sena.glaze", displayName: "세나유약", bio: "빛에 따라 달라지는 유약 색을 좋아해요.", avatarTone: 4, stats: dummyStats("sena") },
  { id: "jun", username: "jun.claylab", displayName: "준 클레이랩", bio: "흙과 유약의 작은 변화를 실험하는 작업실.", avatarTone: 5, stats: dummyStats("jun") },
  { id: "haeun", username: "haeun.pottery", displayName: "해은도예", bio: "일상에서 오래 쓰이는 그릇을 만듭니다.", avatarTone: 6, stats: dummyStats("haeun") },
  { id: "noa", username: "noa.studio", displayName: "노아 스튜디오", bio: "차분한 형태와 부드러운 표면을 탐색해요.", avatarTone: 7, stats: dummyStats("noa") },
  { id: "yeon", username: "yeon.fire", displayName: "연의 불기록", bio: "매번 다른 불의 흔적을 기록합니다.", avatarTone: 8, stats: dummyStats("yeon") },
  { id: "sori", username: "sori.celadon", displayName: "소리청자", bio: "푸른 청자빛과 맑은 빙렬을 연구해요.", avatarTone: 9, stats: dummyStats("sori") },
  { id: "tae", username: "tae.works", displayName: "태 작업실", bio: "흙으로 담백한 일상을 빚습니다.", avatarTone: 10, stats: dummyStats("tae") },
  { id: "yuna", username: "yuna.ceramics", displayName: "유나 세라믹스", bio: "따뜻한 색감의 식기를 만들어요.", avatarTone: 11, stats: dummyStats("yuna") },
  { id: "haneul", username: "haneul.glaze", displayName: "하늘빛 유약", bio: "푸른 유약의 깊이를 찾아가는 중입니다.", avatarTone: 12, stats: dummyStats("haneul") },
  { id: "jiho", username: "jiho.kilnlog", displayName: "지호 가마일지", bio: "소성 결과와 배움을 꾸준히 남겨요.", avatarTone: 13, stats: dummyStats("jiho") },
  { id: "boram", username: "boram.clay", displayName: "보람의 흙", bio: "흙의 자연스러운 결을 좋아합니다.", avatarTone: 14, stats: dummyStats("boram") },
  { id: "ian", username: "ian.stoneware", displayName: "이안 스톤웨어", bio: "튼튼하고 편안한 생활 도자기를 만들어요.", avatarTone: 15, stats: dummyStats("ian") },
  { id: "chae", username: "chae.pot", displayName: "채의 그릇", bio: "매일 손이 가는 그릇을 빚습니다.", avatarTone: 16, stats: dummyStats("chae") },
  { id: "minu", username: "minu.oxide", displayName: "민우 산화물", bio: "산화물 배합으로 새로운 표면을 실험해요.", avatarTone: 17, stats: dummyStats("minu") },
  { id: "arin", username: "arin.firebox", displayName: "아린 파이어박스", bio: "가마 속 색의 변화를 관찰합니다.", avatarTone: 18, stats: dummyStats("arin") },
  { id: "leo", username: "leo.glazebook", displayName: "레오 유약책", bio: "유약 레시피와 테스트를 한 장씩 모아요.", avatarTone: 19, stats: dummyStats("leo") },
  { id: "dami", username: "dami.mud", displayName: "다미의 진흙", bio: "흙을 만지는 느린 시간을 좋아해요.", avatarTone: 20, stats: dummyStats("dami") },
] as const;

const textures = [
  { image: "/glaze-textures/crystalline-turquoise.png", glazeName: "청록 결정유", firing: "산화 소성", cone: "Cone 6", finish: "고광택 · 결정" },
  { image: "/glaze-textures/shino-ivory.png", glazeName: "아이보리 시노유", firing: "환원 소성", cone: "Cone 10", finish: "반광 · 철점" },
  { image: "/glaze-textures/tenmoku-oilspot.png", glazeName: "흑유 오일스팟", firing: "산화 소성", cone: "Cone 9", finish: "고광택 · 금속점" },
  { image: "/glaze-textures/celadon-crackle.png", glazeName: "연청색 빙렬유", firing: "환원 소성", cone: "Cone 8", finish: "투명 · 빙렬" },
  { image: "/glaze-textures/copper-red.png", glazeName: "동적유", firing: "강환원 소성", cone: "Cone 10", finish: "고광택 · 유동" },
  { image: "/glaze-textures/lavender-cobalt.png", glazeName: "보라 코발트유", firing: "산화 소성", cone: "Cone 6", finish: "유광 · 흐름무늬" },
  { image: "/glaze-textures/white-crawl.png", glazeName: "백색 크롤링유", firing: "산화 소성", cone: "Cone 6", finish: "무광 · 크롤링" },
  { image: "/glaze-textures/moss-ash.png", glazeName: "이끼빛 재유", firing: "장작가마 소성", cone: "Cone 11", finish: "반광 · 자연재" },
] as const;

const postDetails = [
  { clayBody: "백색 석기토", application: "담금 2회 · 1.1 mm", recipe: [["장석", 45], ["규석", 25], ["석회석", 20], ["카올린", 10]], colorants: [["산화구리", 2.5], ["산화티타늄", 3]], peak: 1220, hold: 18, memo: "결정이 가장자리에서 크게 자랐어요. 다음 작업에서는 최고온도 유지 시간을 5분 줄여 흐름을 확인해보려 합니다." },
  { clayBody: "철분 석기토", application: "담금 1회 · 0.9 mm", recipe: [["장석", 40], ["카올린", 30], ["규석", 20], ["백운석", 10]], colorants: [["적철석", 4]], peak: 1285, hold: 25, memo: "얇게 시유한 입술 부분은 따뜻한 아이보리, 몸통은 철점이 선명하게 나왔습니다. 환원 시작 시점이 잘 맞았어요." },
  { clayBody: "갈색 석기토", application: "분무 3회 · 1.3 mm", recipe: [["장석", 50], ["규석", 25], ["석회석", 15], ["카올린", 10]], colorants: [["산화철", 10], ["산화망간", 2]], peak: 1260, hold: 30, memo: "두꺼운 부분에서 오일스팟이 잘 열렸습니다. 바닥에서 12 mm는 닦아내야 선반 부착을 피할 수 있어요." },
  { clayBody: "청자토", application: "담금 1회 · 0.8 mm", recipe: [["장석", 48], ["규석", 27], ["석회석", 15], ["카올린", 10]], colorants: [["산화철", 1.2]], peak: 1250, hold: 15, memo: "맑은 연청색과 고른 빙렬이 나왔습니다. 700℃까지 천천히 냉각한 구간이 표면 안정에 도움이 된 것 같아요." },
  { clayBody: "백자토", application: "붓칠 3회 · 1.0 mm", recipe: [["장석", 45], ["규석", 30], ["석회석", 15], ["카올린", 10]], colorants: [["탄산동", 1.5], ["주석", 0.5]], peak: 1290, hold: 20, memo: "강환원 구간에서 붉은 색이 안정적으로 올라왔습니다. 기물 안쪽보다 바깥쪽 발색이 조금 더 선명합니다." },
  { clayBody: "백색 석기토", application: "담금 1회 · 1.0 mm", recipe: [["프릿", 38], ["장석", 27], ["규석", 20], ["카올린", 15]], colorants: [["탄산코발트", 0.4], ["산화주석", 4]], peak: 1220, hold: 12, memo: "겹쳐 바른 부분에서 보라색 흐름이 깊어졌어요. 얇은 부분은 푸른 기가 강해서 다음에는 도포 두께를 조금 높일 예정입니다." },
  { clayBody: "적색 조형토", application: "붓칠 2회 · 1.5 mm", recipe: [["네펠린 섬장석", 40], ["탄산마그네슘", 25], ["카올린", 20], ["규석", 15]], colorants: [], peak: 1205, hold: 10, memo: "수축 차이가 커서 크롤링 간격이 넓게 형성됐습니다. 가장자리 박리를 줄이려면 초벌 표면의 먼지를 더 꼼꼼히 제거해야 해요." },
  { clayBody: "내화 점토", application: "국자 시유 · 1.2 mm", recipe: [["참나무재", 45], ["장석", 25], ["규석", 20], ["점토", 10]], colorants: [["산화철", 3]], peak: 1300, hold: 35, memo: "불길이 직접 닿은 면은 짙은 이끼색, 반대편은 올리브색으로 나왔습니다. 자연재가 흐른 자국을 다음 형태에도 활용하고 싶어요." },
] as const;

function firingCurve(peak: number, hold: number) {
  return [
    { minute: 0, temperatureC: 20 },
    { minute: 90, temperatureC: 600 },
    { minute: 210, temperatureC: Math.round(peak * .82) },
    { minute: 330, temperatureC: peak },
    { minute: 330 + hold, temperatureC: peak },
    { minute: 510 + hold, temperatureC: 650 },
    { minute: 690 + hold, temperatureC: 120 },
  ] as const;
}

const sizes = ["medium", "tall", "short"] as const;

const WORK_POSTS: readonly FeedPost[] = FEED_USERS.flatMap((user, userIndex) =>
  Array.from({ length: FEED_POST_COUNT }, (_, postIndex) => {
    const textureIndex = (userIndex * 3 + postIndex) % textures.length;
    const detail = postDetails[textureIndex];
    return {
      id: `${user.id}-${postIndex + 1}`,
      userId: user.id,
      image: textures[textureIndex].image,
      label: `${user.displayName}의 ${textures[textureIndex].glazeName} 표면`,
      size: sizes[(userIndex + postIndex) % sizes.length],
      crop: ((userIndex * 2 + postIndex) % 6) + 1,
      glazeName: textures[textureIndex].glazeName,
      firing: textures[textureIndex].firing,
      cone: textures[textureIndex].cone,
      finish: textures[textureIndex].finish,
      clayBody: detail.clayBody,
      application: detail.application,
      recipe: detail.recipe.map(([name, amount]) => ({ name, amount })),
      colorants: detail.colorants.map(([name, amount]) => ({ name, amount })),
      curve: firingCurve(detail.peak, detail.hold),
      memo: detail.memo,
      publishedAt: `${3 + postIndex}일 전`,
    };
  }),
);

export const SALE_POSTS: readonly FeedPost[] = [
  {
    id: "sale-moon-jar",
    userId: "mira",
    image: "/sale-pottery/moon-jar.webp",
    label: "햇살 아래 놓인 푸른 빙렬 백자 달항아리",
    size: "tall",
    crop: 1,
    glazeName: "푸른 빙렬 백자 달항아리",
    firing: "환원 소성",
    cone: "Cone 9",
    finish: "유광 · 옅은 빙렬",
    clayBody: "백자토",
    application: "담금 시유",
    recipe: [],
    colorants: [],
    curve: [],
    memo: "직접 물레 성형해 만든 백자 달항아리입니다. 자연스럽게 흐르는 푸른 빙렬과 손맛이 느껴지는 비대칭 형태가 매력적이에요. 전시용으로만 사용해 물을 담은 적은 없으며, 깨짐이나 이 빠짐 없이 상태가 좋습니다. 공간에 포인트가 되는 넉넉한 크기예요.",
    publishedAt: "방금 전",
    kind: "sale",
    price: 128000,
    priceNegotiable: true,
    saleDetails: { condition: "거의 새 상품", dimensions: "지름 24 · 높이 27 cm", location: "서울 성수동", delivery: "직거래 · 안전 포장 택배" },
  },
  {
    id: "sale-celadon-cups",
    userId: "sori",
    image: "/sale-pottery/celadon-cup-set.webp",
    label: "월넛 트레이 위 청자 구름 찻잔 2인 세트",
    size: "medium",
    crop: 2,
    glazeName: "청자 구름 찻잔 2인 세트",
    firing: "환원 소성",
    cone: "Cone 10",
    finish: "유광 · 음각 문양",
    clayBody: "청자토",
    application: "담금 시유",
    recipe: [],
    colorants: [],
    curve: [],
    memo: "은은한 비색이 예쁜 수제 청자 찻잔 두 점 세트입니다. 구름 문양을 손으로 얕게 새겼고 입술이 편안하게 닿도록 얇게 다듬었습니다. 촬영과 전시만 한 미사용 제품이며 두 잔의 색감과 크기가 자연스럽게 어우러져 선물용으로도 좋아요.",
    publishedAt: "35분 전",
    kind: "sale",
    price: 62000,
    priceNegotiable: false,
    saleDetails: { condition: "미사용", dimensions: "각 지름 9 · 높이 6 cm", location: "경기 이천시", delivery: "택배 가능 · 배송비 별도" },
  },
  {
    id: "sale-speckled-vase",
    userId: "haeun",
    image: "/sale-pottery/speckled-vase.webp",
    label: "흰 들꽃을 꽂은 철점 웨이브 화병",
    size: "tall",
    crop: 3,
    glazeName: "철점 웨이브 롱 화병",
    firing: "산화 소성",
    cone: "Cone 6",
    finish: "무광 · 철점",
    clayBody: "샌드 베이지 석기토",
    application: "분무 시유",
    recipe: [],
    colorants: [],
    curve: [],
    memo: "입구의 물결 모양을 한 장씩 손으로 빚은 하나뿐인 화병입니다. 작은 들꽃이나 긴 가지 한두 송이를 꽂았을 때 형태가 가장 잘 살아나요. 바닥에 사용 흔적이 아주 조금 있지만 유약면과 내부는 깨끗하고 누수도 없습니다.",
    publishedAt: "2시간 전",
    kind: "sale",
    price: 48000,
    priceNegotiable: true,
    saleDetails: { condition: "상태 좋음", dimensions: "폭 10 · 높이 28 cm", location: "서울 연남동", delivery: "직거래 선호 · 택배 가능" },
  },
  {
    id: "sale-tenmoku-bowl",
    userId: "dohoon",
    image: "/sale-pottery/tenmoku-bowl.webp",
    label: "먹빛 패브릭 위 흑유 전무늬 다용도 볼",
    size: "medium",
    crop: 4,
    glazeName: "흑유 전무늬 다용도 볼",
    firing: "산화 소성",
    cone: "Cone 9",
    finish: "고광택 · 흑갈색 흐름",
    clayBody: "갈색 석기토",
    application: "국자 시유",
    recipe: [],
    colorants: [],
    curve: [],
    memo: "깊은 흑갈색 유약 아래 물레 자국이 은은하게 보이는 넓은 볼입니다. 샐러드나 과일을 담는 서빙볼로 사용하기 좋고, 가장자리의 붉은 갈색 흐름이 빛에 따라 다르게 보여요. 두 번 사용했으며 금이나 이 빠짐 없이 깨끗합니다.",
    publishedAt: "어제",
    kind: "sale",
    price: 73000,
    priceNegotiable: false,
    saleDetails: { condition: "사용감 적음", dimensions: "지름 26 · 높이 8 cm", location: "서울 망원동", delivery: "직거래 · 택배 가능" },
  },
] as const;

const saleInsertAfter = new Map([[1, 0], [7, 1], [13, 2], [19, 3]]);

export const FEED_POSTS: readonly FeedPost[] = WORK_POSTS.flatMap((post, index) => {
  const saleIndex = saleInsertAfter.get(index);
  return saleIndex === undefined ? [post] : [post, SALE_POSTS[saleIndex]];
});

export const YEJIN_DEMO_POSTS: readonly FeedPost[] = WORK_POSTS.slice(0, 7).map((post, index) => ({
  ...post,
  id: `yejin-demo-${index + 1}`,
  userId: "self",
  label: `${post.glazeName} 작업 기록`,
  crop: (index % 6) + 1,
}));

export function postsForAccount(email?: string | null) {
  return email?.trim().toLowerCase() === "yejin1046@gmail.com" ? YEJIN_DEMO_POSTS : [];
}

//: 실제 가입자(다른 계정)가 올린 글의 작성자. 피드를 불러올 때 채워 넣고,
//: 더미 목록에 없는 id는 여기서 찾는다 — 없으면 더미 첫 사용자로 잘못 표시된다.
const remoteFeedUsers = new Map<string, FeedUser>();

export function registerFeedUser(id: string, displayName: string) {
  const name = displayName.trim() || "가마쟁이";
  // 같은 사람은 항상 같은 아바타 색이 나오도록 id에서 1~4를 정한다.
  const tone = ([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4) + 1;
  remoteFeedUsers.set(id, {
    id, username: name, displayName: name, bio: "", avatarTone: tone,
    stats: { records: 0, followers: 0, following: 0 },
  });
}

export function findFeedUser(userId: string) {
  return FEED_USERS.find((user) => user.id === userId) ?? remoteFeedUsers.get(userId) ?? FEED_USERS[0];
}

export function findFeedPost(postId: string) {
  return FEED_POSTS.find((post) => post.id === postId)
    ?? YEJIN_DEMO_POSTS.find((post) => post.id === postId)
    ?? FEED_POSTS[0];
}

export function postsForUser(userId: string) {
  return FEED_POSTS.filter((post) => post.userId === userId);
}
