import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatListScreen, ConversationScreen } from "./ChatScreen";
import type { ChatThread } from "./chatStore";

afterEach(cleanup);

const thread: ChatThread = {
  userId: "mira",
  username: "mira.ceramic",
  displayName: "미라의 흙방",
  avatarTone: 2,
  updatedAt: "2026-10-03T12:00:00.000Z",
  messages: [],
};

describe("chat", () => {
  it("shows a started conversation in the chat list", () => {
    const onOpen = vi.fn();
    render(<ChatListScreen threads={[thread]} onOpen={onOpen} />);
    expect(screen.getByText("미라의 흙방")).toBeTruthy();
    expect(screen.getByText("대화를 시작해 보세요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /미라의 흙방/ }));
    expect(onOpen).toHaveBeenCalledWith("mira");
  });

  it("sends a typed message and clears the composer after it is saved", async () => {
    const onSend = vi.fn();
    render(<ConversationScreen thread={thread} onBack={vi.fn()} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "메시지 입력" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "안녕하세요!" } });
    fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: "안녕하세요!", sender: "me" }));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("keeps a message available to retry when saving fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("저장 실패"));
    render(<ConversationScreen thread={thread} onBack={vi.fn()} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "메시지 입력" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "다시 보내기" } });
    fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
    await screen.findByRole("alert");
    expect(input.value).toBe("다시 보내기");
  });
});
