import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { workRecordToPostSeed } from "../records/workRecords";
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

  it("fills the form from a work record and lets only name, memo and photos change", async () => {
    const run = sampleAiceRun();
    const seed = workRecordToPostSeed("run-1", { ...run, recipe: { ...run.recipe, name: "해안 사틴 01", photo: { ...run.recipe.photo, data_url: "data:image/png;base64,Zm9v" } } });
    const onSubmit = vi.fn();
    render(<CreatePostScreen kind="work" record={seed} onBack={vi.fn()} onSubmit={onSubmit} />);

    expect((screen.getByLabelText(/유약 이름/) as HTMLInputElement).value).toBe("해안 사틴 01");
    expect(screen.getByLabelText("작업기록에서 불러온 내용").textContent).toContain("장석 40%");
    await screen.findByAltText("선택한 사진 1");
    fireEvent.change(screen.getByLabelText(/남길 메모/), { target: { value: "다음엔 더 얇게" } });
    fireEvent.change(screen.getByLabelText(/유약 이름/), { target: { value: "내 해안 사틴" } });
    fireEvent.click(screen.getByRole("button", { name: "게시하기" }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: "내 해안 사틴", description: "다음엔 더 얇게", record: { recordId: "run-1", details: { clayBody: "백색 석기 소지" } } });
  });

  it("blocks a second submit while the first one is still saving", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<CreatePostScreen kind="work" onBack={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("게시물 사진 선택"), { target: { files: [new File(["photo"], "a.png", { type: "image/png" })] } });
    await screen.findByAltText("선택한 사진 1");
    fireEvent.change(screen.getByPlaceholderText("작업 제목을 입력해 주세요"), { target: { value: "청자 사발" } });
    const submit = screen.getByRole("button", { name: "게시하기" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form")!);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "게시 중…" }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "게시하기" }).hasAttribute("disabled")).toBe(false));
  });
});
