import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNavigation } from "./ui";

afterEach(cleanup);

describe("BottomNavigation", () => {
  it("moves a single indicator to the selected menu item", () => {
    const onChange = vi.fn();
    const items = [
      { id: "home", label: "홈", icon: <span /> },
      { id: "history", label: "생성기록", icon: <span /> },
      { id: "chat", label: "채팅", icon: <span /> },
      { id: "my", label: "마이", icon: <span /> },
    ] as const;
    const { rerender } = render(<BottomNavigation current="home" items={items} onChange={onChange} />);

    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(navigation.style.getPropertyValue("--nav-index")).toBe("0");
    expect(navigation.style.getPropertyValue("--nav-count")).toBe("4");
    expect(navigation.querySelectorAll(".bottom-nav-indicator")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "채팅" }));
    expect(onChange).toHaveBeenCalledWith("chat");

    rerender(<BottomNavigation current="chat" items={items} onChange={onChange} />);
    expect(navigation.style.getPropertyValue("--nav-index")).toBe("2");
  });
});
