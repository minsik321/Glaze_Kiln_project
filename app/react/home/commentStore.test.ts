import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { op: string; args: unknown[] }[] = [];
const AUTHOR = "00000000-aaaa-4bbb-8ccc-000000000009";
const row = { id: "c1", user_id: AUTHOR, body: "멋져요", created_at: new Date().toISOString() };
const tables: Record<string, { data: unknown; error: null }> = {
  post_comments: { data: [row], error: null },
  public_profiles: { data: [{ id: AUTHOR, display_name: "실제 작가", avatar_url: null }], error: null },
};

vi.mock("../lib/supabase", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order", "insert"]) {
        chain[op] = (...args: unknown[]) => { calls.push({ op: `${table}.${op}`, args }); return chain; };
      }
      chain.single = () => Promise.resolve({ data: row, error: null });
      chain.then = (resolve: (value: unknown) => void) => resolve(tables[table]);
      return chain;
    },
  }),
}));

import { addComment, loadComments } from "./commentStore";

describe("commentStore", () => {
  beforeEach(() => { calls.length = 0; });

  it("loads a post's comments with the author's current profile name", async () => {
    const comments = await loadComments("chloe-1");
    expect(calls.find((c) => c.op === "post_comments.eq")?.args).toEqual(["post_id", "chloe-1"]);
    expect(comments).toEqual([expect.objectContaining({ id: "c1", body: "멋져요", displayName: "실제 작가", createdAt: "방금 전" })]);
  });

  it("inserts a comment for the signed-in user and returns it", async () => {
    const saved = await addComment("chloe-1", AUTHOR, "멋져요");
    expect(calls.find((c) => c.op === "post_comments.insert")?.args[0]).toEqual({ post_id: "chloe-1", user_id: AUTHOR, body: "멋져요" });
    expect(saved.displayName).toBe("실제 작가");
  });
});
