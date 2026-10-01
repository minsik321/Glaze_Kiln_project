import { describe, expect, it, vi } from "vitest";
import { validateAiceRun } from "../aice/contract";
import { FEED_POSTS, findFeedUser } from "../home/feedData";
import { feedPostToWorkRecord, isVisibleWorkRecord, workRecordOrigin } from "./workRecords";

describe("work record imports", () => {
  it("keeps the source recipe, firing curve, application, and memo", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
    const post = FEED_POSTS[0];
    const run = feedPostToWorkRecord(post, findFeedUser(post.userId), "2026-10-01T00:00:00.000Z");

    expect(run.recipe.name).toBe(post.glazeName);
    expect(run.recipe.materials).toEqual(Object.fromEntries(post.recipe.map((item) => [item.name, item.amount])));
    expect(run.curves.baseline.points).toHaveLength(post.curve.length);
    expect(run.sources.some((source) => source.interpretation === post.memo)).toBe(true);
    expect(run.recipe.photo.data_url).toBeNull();
    expect(run.sources.some((source) => source.conversion === post.image)).toBe(true);
    expect(workRecordOrigin(run)).toBe("imported");
    expect(isVisibleWorkRecord(run)).toBe(true);
    expect(validateAiceRun(run)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
