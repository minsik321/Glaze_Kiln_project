import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";

const signInWithPassword = vi.fn();
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({ auth: { signInWithPassword } }),
}));

afterEach(() => {
  cleanup();
  signInWithPassword.mockReset();
});

describe("LoginScreen", () => {
  it("opens signup from the signup button", () => {
    const onSignup = vi.fn();
    render(<LoginScreen onSuccess={vi.fn()} onSignup={onSignup} />);
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    expect(onSignup).toHaveBeenCalledOnce();
  });

  it("signs in with the entered email and password", async () => {
    const onSuccess = vi.fn();
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
    render(<LoginScreen onSuccess={onSuccess} onSignup={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: " user@example.com " } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "password123" }));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("shows an authentication error without leaving the screen", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: new Error("이메일 또는 비밀번호를 확인해 주세요.") });
    render(<LoginScreen onSuccess={vi.fn()} onSignup={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect((await screen.findByRole("alert")).textContent).toContain("이메일 또는 비밀번호를 확인해 주세요.");
  });
});
