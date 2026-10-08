import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null }));
vi.mock("../lib/supabase", () => ({ requireSupabase: () => ({ rpc }) }));

import { saveChatMessage } from "./chatStore";

describe("saveChatMessage", () => {
  it("delivers through the server function so the recipient gets a copy too", async () => {
    await saveChatMessage("me", "peer-uuid", { id: "m1", body: "안녕하세요", sentAt: "2026-10-08T00:00:00.000Z", sender: "me" });
    expect(rpc).toHaveBeenCalledWith("send_chat_message", {
      p_id: "m1", p_peer: "peer-uuid", p_body: "안녕하세요", p_sent_at: "2026-10-08T00:00:00.000Z",
    });
  });

  it("surfaces a server error", async () => {
    rpc.mockResolvedValueOnce({ error: new Error("denied") });
    await expect(saveChatMessage("me", "p", { id: "m2", body: "x", sentAt: "", sender: "me" })).rejects.toThrow("denied");
  });
});
