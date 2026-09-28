import { describe, expect, it } from "vitest";
import { FEED_POSTS, FEED_USERS, postsForUser } from "./feedData";

describe("home feed dummy data", () => {
  it("contains 20 distinct users and a scrollable amount of posts", () => {
    expect(FEED_USERS).toHaveLength(20);
    expect(new Set(FEED_USERS.map((user) => user.username)).size).toBe(20);
    expect(new Set(FEED_USERS.map((user) => user.avatarTone)).size).toBe(20);
    expect(FEED_POSTS).toHaveLength(60);
  });

  it("gives every user three glaze-photo posts", () => {
    for (const user of FEED_USERS) {
      const posts = postsForUser(user.id);
      expect(posts).toHaveLength(3);
      expect(posts.every((post) => post.image.startsWith("/glaze-textures/"))).toBe(true);
    }
  });
});
