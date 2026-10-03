import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatePostScreen } from "./CreatePostScreen";

afterEach(cleanup);

describe("CreatePostScreen", () => {
  it("creates a pottery sale post with a photo, price, and negotiable option", async () => {
    const onSubmit = vi.fn();
    render(<CreatePostScreen kind="sale" onBack={vi.fn()} onSubmit={onSubmit} />);

    const photo = new File(["photo"], "vase.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("게시물 사진 선택"), { target: { files: [photo] } });
    await screen.findByAltText("선택한 사진 1");
    fireEvent.change(screen.getByPlaceholderText("판매할 작품의 제목을 입력해 주세요"), { target: { value: "푸른 달항아리" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "판매 가격" }), { target: { value: "85000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "가격 협의 가능" }));
    fireEvent.change(screen.getByPlaceholderText("크기, 재료, 상태, 거래 방법 등을 자세히 적어주세요."), { target: { value: "직접 만든 백자 달항아리입니다." } });
    fireEvent.click(screen.getByRole("button", { name: "게시하기" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: "sale",
      title: "푸른 달항아리",
      description: "직접 만든 백자 달항아리입니다.",
      price: 85000,
      priceNegotiable: true,
    });
  });

  it("shows a work-specific form without sale pricing", () => {
    render(<CreatePostScreen kind="work" onBack={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("작업 게시하기 화면")).toBeTruthy();
    expect(screen.getByPlaceholderText("작업 제목을 입력해 주세요")).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: "판매 가격" })).toBeNull();
  });
});
