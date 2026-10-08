import { describe, expect, it } from "vitest";
import { FEED_POSTS, FEED_USERS, SALE_POSTS, postsForAccount, postsForUser } from "./feedData";

describe("home feed dummy data", () => {
  it("contains 20 distinct users and a scrollable amount of posts", () => {
    expect(FEED_USERS).toHaveLength(20);
    expect(new Set(FEED_USERS.map((user) => user.username)).size).toBe(20);
    expect(new Set(FEED_USERS.map((user) => user.avatarTone)).size).toBe(20);
    expect(FEED_POSTS).toHaveLength(64);
  });

  it("gives every user three glaze-photo posts and mixes sales into the feed", () => {
    for (const user of FEED_USERS) {
      const posts = postsForUser(user.id);
      expect(posts.filter((post) => post.kind !== "sale")).toHaveLength(3);
    }
    expect(SALE_POSTS).toHaveLength(4);
    expect(SALE_POSTS.every((post) => post.image.startsWith("/sale-pottery/") && post.price && post.saleDetails)).toBe(true);
  });

  it("gives the demo owner seven photos and keeps new accounts empty", () => {
    const demoPosts = postsForAccount("YEJIN1046@gmail.com");
    expect(demoPosts).toHaveLength(7);
    expect(demoPosts.every((post) => post.image.startsWith("/glaze-textures/"))).toBe(true);
    expect(postsForAccount("new-user@example.com")).toHaveLength(0);
  });
});

describe("registerFeedUser", () => {
  it("resolves a signed-up author instead of falling back to the first dummy user", async () => {
    const { registerFeedUser, findFeedUser, FEED_USERS } = await import("./feedData");
    registerFeedUser("00000000-aaaa-4bbb-8ccc-000000000001", "새 작가");
    const user = findFeedUser("00000000-aaaa-4bbb-8ccc-000000000001");
    expect(user.displayName).toBe("새 작가");
    expect(user.id).not.toBe(FEED_USERS[0].id);
  });
});
