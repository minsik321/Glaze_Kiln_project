import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignupScreen } from "./SignupScreen";

const signUp = vi.fn();
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({ auth: { signUp } }),
}));

afterEach(() => {
  cleanup();
  signUp.mockReset();
});

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("사용할 닉네임 입력"), { target: { value: "가마장이" } });
  fireEvent.change(screen.getByLabelText("이메일 주소 입력"), { target: { value: "user@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호 입력"), { target: { value: "Password!" } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Password!" } });
}

describe("SignupScreen", () => {
  it("enables signup only after every value passes validation", () => {
    render(<SignupScreen onBack={vi.fn()} onSuccess={vi.fn()} onLogin={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "가입하기" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fillValidForm();
    expect(submit.disabled).toBe(false);
    expect(screen.getByText("사용 가능한 이메일 형식입니다.")).toBeTruthy();
    expect(screen.getByText("사용 가능한 비밀번호입니다.")).toBeTruthy();
    expect(screen.getByText("비밀번호가 일치합니다.")).toBeTruthy();
  });

  it("creates the account with display name metadata", async () => {
    const onSuccess = vi.fn();
    signUp.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    render(<SignupScreen onBack={vi.fn()} onSuccess={onSuccess} onLogin={vi.fn()} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => expect(signUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password!",
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}?onboarding=1`,
        data: { display_name: "가마장이" },
      },
    }));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("shows invalid email and password mismatch messages", () => {
    render(<SignupScreen onBack={vi.fn()} onSuccess={vi.fn()} onLogin={vi.fn()} />);
    const email = screen.getByLabelText("이메일 주소 입력");
    const confirm = screen.getByLabelText("비밀번호 확인");
    fireEvent.change(email, { target: { value: "wrong-email" } });
    fireEvent.blur(email);
    fireEvent.change(screen.getByLabelText("비밀번호 입력"), { target: { value: "Password!" } });
    fireEvent.change(confirm, { target: { value: "Different!" } });
    fireEvent.blur(confirm);

    expect(screen.getByText("올바르지 않은 이메일 형식입니다.")).toBeTruthy();
    expect(screen.getByText("비밀번호가 일치하지 않습니다.")).toBeTruthy();
  });
});
