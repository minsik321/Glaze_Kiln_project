import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  initialRecoveryRequested: false,
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  get initialRecoveryRequested() {
    return mocks.initialRecoveryRequested;
  },
  supabase: { auth: mocks, from: mocks.from },
  requireSupabase: () => ({ auth: mocks, from: mocks.from }),
}));
import { AuthProvider, useAuth } from "./AuthProvider";
import { AuthPanel } from "./AuthPanel";
const session = {
  user: { id: "user-1", email: "test@example.com" },
} as Session;
let listener: (event: string, session: Session | null) => void;
let unsubscribe: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.initialRecoveryRequested = false;
  unsubscribe = vi.fn();
  mocks.onAuthStateChange.mockImplementation((callback) => {
    listener = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  for (const method of [
    mocks.signInWithPassword,
    mocks.signUp,
    mocks.resetPasswordForEmail,
    mocks.updateUser,
    mocks.signOut,
  ])
    method.mockResolvedValue({ data: {}, error: null });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  });
});
afterEach(cleanup);
function Probe() {
  const auth = useAuth();
  return (
    <span>
      {auth.loading
        ? "loading"
        : auth.recovery
          ? "recovery"
          : (auth.session?.user.id ?? "anonymous")}
    </span>
  );
}
describe("Auth session lifecycle", () => {
  it("preserves password recovery and the new session when initial session read arrives late", async () => {
    let resolve!: (value: unknown) => void;
    mocks.getSession.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    act(() => listener("PASSWORD_RECOVERY", session));
    expect(screen.getByText("recovery")).toBeTruthy();
    await act(async () => resolve({ data: { session: null }, error: null }));
    expect(screen.getByText("recovery")).toBeTruthy();
    act(() => listener("SIGNED_OUT", null));
    expect(screen.getByText("anonymous")).toBeTruthy();
  });
  it("cleans up both subscriptions during StrictMode mount and unmount", async () => {
    const view = render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    );
    await screen.findByText("anonymous");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
describe("Auth forms", () => {
  it("submits login credentials and shows the server error", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: new Error("Invalid login credentials"),
    });
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText("이메일"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인하기" }));
    await waitFor(() =>
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "test-password",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Invalid login credentials",
    );
  });
  it("shows confirmation guidance when signup requires an email confirmation", async () => {
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "회원가입" }));
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/비밀번호/), {
      target: { value: "test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));
    expect(await screen.findByText(/가입 확인 메일을 확인/)).toBeTruthy();
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      }),
    );
  });
  it("updates the password only after a recovery event", async () => {
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );
    await screen.findByLabelText("이메일");
    act(() => listener("PASSWORD_RECOVERY", session));
    fireEvent.change(screen.getByLabelText(/새 비밀번호/), {
      target: { value: "changed-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "새 비밀번호 저장" }));
    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({
        password: "changed-password",
      }),
    );
    expect(await screen.findByText("비밀번호를 변경했습니다.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "새 비밀번호 저장" }),
    ).toBeNull();
  });
});

describe("Account persistence requests", () => {
  it("requests password recovery with the current app as redirect", async () => {
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "비밀번호 찾기" }),
    );
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "재설정 메일 보내기" }));
    await waitFor(() =>
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
        { redirectTo: window.location.origin + window.location.pathname },
      ),
    );
    expect(await screen.findByText(/등록된 계정이 있다면/)).toBeTruthy();
  });
  it("upserts a profile only for the signed-in user", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { display_name: "Old name" },
            error: null,
          }),
        }),
      }),
      upsert,
    });
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );
    await screen.findByDisplayValue("Old name");
    fireEvent.change(screen.getByLabelText("표시 이름"), {
      target: { value: "  New name  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로필 저장" }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        { id: "user-1", display_name: "New name" },
        { onConflict: "id" },
      ),
    );
    expect(await screen.findByText("프로필을 저장했습니다.")).toBeTruthy();
  });
});

it("opens recovery when the SDK consumed its URL before the provider mounted", async () => {
  mocks.initialRecoveryRequested = true;
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  expect(await screen.findByText("recovery")).toBeTruthy();
});
