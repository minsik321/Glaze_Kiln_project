import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { op: string; args: unknown[] }[] = [];
const rows: Record<string, unknown[]> = {
  follows: [{ followee_id: "mira" }, { followee_id: "00000000-aaaa-4bbb-8ccc-000000000009" }],
  public_profiles: [{ id: "00000000-aaaa-4bbb-8ccc-000000000009", display_name: "실제 작가" }],
};

vi.mock("../lib/supabase", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "upsert"]) {
        chain[op] = (...args: unknown[]) => { calls.push({ op: `${table}.${op}`, args }); return chain; };
      }
      chain.delete = (...args: unknown[]) => { calls.push({ op: `${table}.delete`, args }); return chain; };
      chain.then = (resolve: (value: unknown) => void) => resolve({ data: rows[table], error: null });
      return chain;
    },
  }),
}));

import { findFeedUser } from "./feedData";
import { loadFollowing, setFollowing } from "./followStore";

describe("followStore", () => {
  beforeEach(() => { calls.length = 0; });

  it("loads followees and registers names of real accounts only", async () => {
    const ids = await loadFollowing("me");
    expect(ids).toEqual(["mira", "00000000-aaaa-4bbb-8ccc-000000000009"]);
    expect(findFeedUser("00000000-aaaa-4bbb-8ccc-000000000009").displayName).toBe("실제 작가");
    // 더미 id("mira")는 프로필 조회 대상이 아니다.
    expect(calls.find((c) => c.op === "public_profiles.in")?.args[1]).toEqual(["00000000-aaaa-4bbb-8ccc-000000000009"]);
  });

  it("follows with upsert and unfollows with delete", async () => {
    await setFollowing("me", "mira", true);
    await setFollowing("me", "mira", false);
    expect(calls.some((c) => c.op === "follows.upsert")).toBe(true);
    expect(calls.some((c) => c.op === "follows.delete")).toBe(true);
  });
});
