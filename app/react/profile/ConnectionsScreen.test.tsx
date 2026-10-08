import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_USERS } from "../home/feedData";
import { ConnectionsScreen } from "./ConnectionsScreen";

afterEach(cleanup);

describe("ConnectionsScreen", () => {
  it("opens on the requested tab and switches between followers and following", () => {
    const onToggleFollow = vi.fn();
    render(<ConnectionsScreen ownerName="가마쟁이" initialTab="following" followers={[FEED_USERS[0]]} following={[FEED_USERS[1], FEED_USERS[2]]} viewerFollowingIds={new Set([FEED_USERS[1].id])} onBack={vi.fn()} onOpenProfile={vi.fn()} onToggleFollow={onToggleFollow} />);
    expect(screen.getByRole("tab", { name: /팔로잉/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("미라의 흙방")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /팔로워/ }));
    expect(screen.getAllByText("가마쟁이")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "팔로우" }));
    expect(onToggleFollow).toHaveBeenCalledWith("chloe");
  });
});
