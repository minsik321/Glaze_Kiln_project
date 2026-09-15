import { useEffect, useState, type FormEvent } from "react";
import { requireSupabase, isSupabaseConfigured } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import "./auth.css";

type Mode = "login" | "signup" | "reset";
export function AuthPanel() {
  const {
    session,
    loading,
    recovery,
    finishRecovery,
    error: sessionError,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setPassword("");
    setMessage("");
    setError("");
  }, [session?.user.id]);
  const redirectTo = () => window.location.origin + window.location.pathname;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const client = requireSupabase();
      if (recovery) {
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword("");
        finishRecovery();
        setMessage("비밀번호를 변경했습니다.");
      } else if (mode === "login") {
        const result = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        setPassword("");
      } else if (mode === "signup") {
        const result = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo() },
        });
        if (result.error) throw result.error;
        setPassword("");
        setMessage(
          result.data.session
            ? "회원가입이 완료되었습니다."
            : "가입 확인 메일을 확인해 주세요. 확인 링크를 누른 뒤 로그인할 수 있습니다.",
        );
      } else {
        const result = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirectTo(),
        });
        if (result.error) throw result.error;
        setMessage(
          "해당 이메일로 등록된 계정이 있다면 비밀번호 재설정 메일이 발송됩니다.",
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "요청에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requireSupabase().auth.signOut();
      if (result.error) throw result.error;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "로그아웃하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!isSupabaseConfigured)
    return (
      <section className="account-panel">
        클라우드 연결 설정이 필요합니다. 계산기는 로그인 없이 사용할 수
        있습니다.
      </section>
    );
  return (
    <section className="account-panel" aria-label="계정">
      <h2>내 계정</h2>
      {loading ? (
        <p role="status">로그인 상태 확인 중…</p>
      ) : session && !recovery ? (
        <>
          <div className="account-row">
            <span>{session.user.email}</span>
            <button type="button" disabled={busy} onClick={() => void logout()}>
              로그아웃
            </button>
          </div>
          <ProfileEditor key={session.user.id} userId={session.user.id} />
        </>
      ) : (
        <>
          <p>
            계산기는 로그인 없이 사용할 수 있습니다. 기록을 저장하거나 다른
            사용자의 공개 기록을 보려면 로그인하세요.
          </p>
          {!recovery && (
            <div className="account-row" aria-label="계정 메뉴">
              {(
                [
                  ["login", "로그인"],
                  ["signup", "회원가입"],
                  ["reset", "비밀번호 찾기"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  disabled={busy}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setError("");
                    setMessage("");
                    setPassword("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="account-form">
            {!recovery && (
              <label>
                이메일
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            )}
            {(recovery || mode !== "reset") && (
              <label>
                {recovery ? "새 비밀번호" : "비밀번호"}
                <input
                  type="password"
                  required
                  minLength={mode === "login" && !recovery ? 1 : 8}
                  autoComplete={
                    recovery || mode === "signup"
                      ? "new-password"
                      : "current-password"
                  }
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {(recovery || mode === "signup") && (
                  <small>8자 이상 입력해 주세요.</small>
                )}
              </label>
            )}
            <button type="submit" disabled={busy}>
              {busy
                ? "처리 중…"
                : recovery
                  ? "새 비밀번호 저장"
                  : mode === "login"
                    ? "로그인하기"
                    : mode === "signup"
                      ? "가입하기"
                      : "재설정 메일 보내기"}
            </button>
          </form>
        </>
      )}
      {(error || sessionError) && <p role="alert">{error || sessionError}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function ProfileEditor({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await requireSupabase()
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .maybeSingle();
        if (result.error) throw result.error;
        if (active) setName(result.data?.display_name ?? "");
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "프로필을 불러오지 못했습니다.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requireSupabase()
        .from("profiles")
        .upsert(
          { id: userId, display_name: name.trim() },
          { onConflict: "id" },
        );
      if (result.error) throw result.error;
      setMessage("프로필을 저장했습니다.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "프로필 저장에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="account-form">
      <label>
        표시 이름
        <input
          maxLength={80}
          value={name}
          disabled={loading || busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button disabled={loading || busy} type="submit">
        {busy ? "저장 중…" : "프로필 저장"}
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
