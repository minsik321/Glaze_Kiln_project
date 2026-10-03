export type FeedUser = {
  id: string;
  username: string;
  displayName: string;
  avatarTone: number;
  stats: { records: number; followers: number; following: number };
};

export type FeedPost = {
  id: string;
  userId: string;
  image: string;
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
};

const FEED_POST_COUNT = 3;

export const FEED_USERS: readonly FeedUser[] = [
  { id: "chloe", username: "chloe.jung", displayName: "가마쟁이", avatarTone: 1, stats: { records: FEED_POST_COUNT, followers: 545, following: 256 } },
  { id: "mira", username: "mira.ceramic", displayName: "미라의 흙방", avatarTone: 2, stats: { records: FEED_POST_COUNT, followers: 812, following: 193 } },
  { id: "dohoon", username: "dohoon.kiln", displayName: "도훈 소성실", avatarTone: 3, stats: { records: FEED_POST_COUNT, followers: 397, following: 128 } },
  { id: "sena", username: "sena.glaze", displayName: "세나유약", avatarTone: 4, stats: { records: FEED_POST_COUNT, followers: 621, following: 344 } },
  { id: "jun", username: "jun.claylab", displayName: "준 클레이랩", avatarTone: 5, stats: { records: FEED_POST_COUNT, followers: 1094, following: 287 } },
  { id: "haeun", username: "haeun.pottery", displayName: "해은도예", avatarTone: 6, stats: { records: FEED_POST_COUNT, followers: 284, following: 96 } },
  { id: "noa", username: "noa.studio", displayName: "노아 스튜디오", avatarTone: 7, stats: { records: FEED_POST_COUNT, followers: 733, following: 215 } },
  { id: "yeon", username: "yeon.fire", displayName: "연의 불기록", avatarTone: 8, stats: { records: FEED_POST_COUNT, followers: 468, following: 178 } },
  { id: "sori", username: "sori.celadon", displayName: "소리청자", avatarTone: 9, stats: { records: FEED_POST_COUNT, followers: 925, following: 301 } },
  { id: "tae", username: "tae.works", displayName: "태 작업실", avatarTone: 10, stats: { records: FEED_POST_COUNT, followers: 352, following: 147 } },
  { id: "yuna", username: "yuna.ceramics", displayName: "유나 세라믹스", avatarTone: 11, stats: { records: FEED_POST_COUNT, followers: 689, following: 234 } },
  { id: "haneul", username: "haneul.glaze", displayName: "하늘빛 유약", avatarTone: 12, stats: { records: FEED_POST_COUNT, followers: 574, following: 206 } },
  { id: "jiho", username: "jiho.kilnlog", displayName: "지호 가마일지", avatarTone: 13, stats: { records: FEED_POST_COUNT, followers: 846, following: 319 } },
  { id: "boram", username: "boram.clay", displayName: "보람의 흙", avatarTone: 14, stats: { records: FEED_POST_COUNT, followers: 239, following: 88 } },
  { id: "ian", username: "ian.stoneware", displayName: "이안 스톤웨어", avatarTone: 15, stats: { records: FEED_POST_COUNT, followers: 1218, following: 402 } },
  { id: "chae", username: "chae.pot", displayName: "채의 그릇", avatarTone: 16, stats: { records: FEED_POST_COUNT, followers: 653, following: 221 } },
  { id: "minu", username: "minu.oxide", displayName: "민우 산화물", avatarTone: 17, stats: { records: FEED_POST_COUNT, followers: 491, following: 164 } },
  { id: "arin", username: "arin.firebox", displayName: "아린 파이어박스", avatarTone: 18, stats: { records: FEED_POST_COUNT, followers: 778, following: 275 } },
  { id: "leo", username: "leo.glazebook", displayName: "레오 유약책", avatarTone: 19, stats: { records: FEED_POST_COUNT, followers: 416, following: 139 } },
  { id: "dami", username: "dami.mud", displayName: "다미의 진흙", avatarTone: 20, stats: { records: FEED_POST_COUNT, followers: 704, following: 248 } },
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

export const FEED_POSTS: readonly FeedPost[] = FEED_USERS.flatMap((user, userIndex) =>
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

export const YEJIN_DEMO_POSTS: readonly FeedPost[] = FEED_POSTS.slice(0, 7).map((post, index) => ({
  ...post,
  id: `yejin-demo-${index + 1}`,
  userId: "self",
  label: `${post.glazeName} 작업 기록`,
  crop: (index % 6) + 1,
}));

export function postsForAccount(email?: string | null) {
  return email?.trim().toLowerCase() === "yejin1046@gmail.com" ? YEJIN_DEMO_POSTS : [];
}

export function findFeedUser(userId: string) {
  return FEED_USERS.find((user) => user.id === userId) ?? FEED_USERS[0];
}

export function findFeedPost(postId: string) {
  return FEED_POSTS.find((post) => post.id === postId)
    ?? YEJIN_DEMO_POSTS.find((post) => post.id === postId)
    ?? FEED_POSTS[0];
}

export function postsForUser(userId: string) {
  return FEED_POSTS.filter((post) => post.userId === userId);
}
