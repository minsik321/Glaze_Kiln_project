import { useState, type FormEvent } from "react";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";

export function LoginScreen({ onSuccess, onSignup }: { onSuccess: () => void; onSignup: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const result = await requireSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error) throw result.error;
      setPassword("");
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "로그인에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-screen login-screen" aria-label="로그인 화면">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand" aria-label="AICE Kiln">
          <img src="/aice-splash.png" alt="AICE" width="150" height="150" />
          <strong>Kiln</strong>
        </div>
        <label className="sr-only" htmlFor="login-email">이메일</label>
        <input
          id="login-email"
          type="email"
          placeholder="이메일"
          autoComplete="email"
          required
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label className="sr-only" htmlFor="login-password">비밀번호</label>
        <input
          id="login-password"
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          required
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="login-submit" disabled={busy || !email.trim() || !password || !isSupabaseConfigured}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
        <button type="button" className="login-signup" onClick={onSignup}>회원가입</button>
        {!isSupabaseConfigured && <p className="login-error" role="alert">로그인 연결 설정이 필요합니다.</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
