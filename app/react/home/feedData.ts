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
};

export const FEED_USERS: readonly FeedUser[] = [
  { id: "chloe", username: "chloe.jung", displayName: "가마쟁이", avatarTone: 1, stats: { records: 18, followers: 545, following: 256 } },
  { id: "mira", username: "mira.ceramic", displayName: "미라의 흙방", avatarTone: 2, stats: { records: 42, followers: 812, following: 193 } },
  { id: "dohoon", username: "dohoon.kiln", displayName: "도훈 소성실", avatarTone: 3, stats: { records: 31, followers: 397, following: 128 } },
  { id: "sena", username: "sena.glaze", displayName: "세나유약", avatarTone: 4, stats: { records: 27, followers: 621, following: 344 } },
  { id: "jun", username: "jun.claylab", displayName: "준 클레이랩", avatarTone: 5, stats: { records: 53, followers: 1094, following: 287 } },
  { id: "haeun", username: "haeun.pottery", displayName: "해은도예", avatarTone: 6, stats: { records: 16, followers: 284, following: 96 } },
  { id: "noa", username: "noa.studio", displayName: "노아 스튜디오", avatarTone: 7, stats: { records: 38, followers: 733, following: 215 } },
  { id: "yeon", username: "yeon.fire", displayName: "연의 불기록", avatarTone: 8, stats: { records: 24, followers: 468, following: 178 } },
  { id: "sori", username: "sori.celadon", displayName: "소리청자", avatarTone: 9, stats: { records: 47, followers: 925, following: 301 } },
  { id: "tae", username: "tae.works", displayName: "태 작업실", avatarTone: 10, stats: { records: 21, followers: 352, following: 147 } },
  { id: "yuna", username: "yuna.ceramics", displayName: "유나 세라믹스", avatarTone: 11, stats: { records: 35, followers: 689, following: 234 } },
  { id: "haneul", username: "haneul.glaze", displayName: "하늘빛 유약", avatarTone: 12, stats: { records: 29, followers: 574, following: 206 } },
  { id: "jiho", username: "jiho.kilnlog", displayName: "지호 가마일지", avatarTone: 13, stats: { records: 44, followers: 846, following: 319 } },
  { id: "boram", username: "boram.clay", displayName: "보람의 흙", avatarTone: 14, stats: { records: 14, followers: 239, following: 88 } },
  { id: "ian", username: "ian.stoneware", displayName: "이안 스톤웨어", avatarTone: 15, stats: { records: 56, followers: 1218, following: 402 } },
  { id: "chae", username: "chae.pot", displayName: "채의 그릇", avatarTone: 16, stats: { records: 33, followers: 653, following: 221 } },
  { id: "minu", username: "minu.oxide", displayName: "민우 산화물", avatarTone: 17, stats: { records: 26, followers: 491, following: 164 } },
  { id: "arin", username: "arin.firebox", displayName: "아린 파이어박스", avatarTone: 18, stats: { records: 40, followers: 778, following: 275 } },
  { id: "leo", username: "leo.glazebook", displayName: "레오 유약책", avatarTone: 19, stats: { records: 22, followers: 416, following: 139 } },
  { id: "dami", username: "dami.mud", displayName: "다미의 진흙", avatarTone: 20, stats: { records: 37, followers: 704, following: 248 } },
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

const sizes = ["medium", "tall", "short"] as const;

export const FEED_POSTS: readonly FeedPost[] = FEED_USERS.flatMap((user, userIndex) =>
  Array.from({ length: 3 }, (_, postIndex) => {
    const textureIndex = (userIndex * 3 + postIndex) % textures.length;
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
    };
  }),
);

export function findFeedUser(userId: string) {
  return FEED_USERS.find((user) => user.id === userId) ?? FEED_USERS[0];
}

export function postsForUser(userId: string) {
  return FEED_POSTS.filter((post) => post.userId === userId);
}
