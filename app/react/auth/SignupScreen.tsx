import { useState, type FormEvent } from "react";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,}$/;

export function SignupScreen({ onBack, onSuccess, onLogin }: { onBack: () => void; onSuccess: () => void; onLogin: () => void }) {
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const nicknameValid = nickname.trim().length >= 2 && nickname.trim().length <= 20;
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const passwordValid = PASSWORD_PATTERN.test(password);
  const confirmValid = passwordConfirm.length > 0 && passwordConfirm === password;
  const formValid = nicknameValid && emailValid && passwordValid && confirmValid && isSupabaseConfigured;

  function markTouched(name: string) {
    setTouched((current) => ({ ...current, [name]: true }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ nickname: true, email: true, password: true, confirm: true });
    if (!formValid || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requireSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${window.location.pathname}?onboarding=1`,
          data: { display_name: nickname.trim() },
        },
      });
      if (result.error) throw result.error;
      setPassword("");
      setPasswordConfirm("");
      if (result.data.session) onSuccess();
      else setMessage("가입 확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "회원가입에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-screen signup-screen" aria-label="회원가입 화면">
      <form className="signup-card" onSubmit={submit} noValidate>
        <button type="button" className="signup-back" onClick={onBack} aria-label="이전 화면으로 돌아가기">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <h1>회원가입 절차를<br />진행할게요</h1>

        <div className="signup-field">
          <label htmlFor="signup-nickname">사용할 닉네임 입력</label>
          <input id="signup-nickname" value={nickname} maxLength={20} autoComplete="nickname" disabled={busy} aria-invalid={touched.nickname && !nicknameValid} onBlur={() => markTouched("nickname")} onChange={(event) => setNickname(event.target.value)} />
          <small className={touched.nickname && !nicknameValid ? "invalid" : ""}>{touched.nickname && !nicknameValid ? "닉네임은 2자 이상 입력해 주세요." : "\u00a0"}</small>
        </div>

        <div className="signup-field">
          <label htmlFor="signup-email">이메일 주소 입력</label>
          <input id="signup-email" type="email" value={email} autoComplete="email" disabled={busy} aria-invalid={touched.email && !emailValid} onBlur={() => markTouched("email")} onChange={(event) => setEmail(event.target.value)} />
          <small className={email && emailValid ? "valid" : touched.email && !emailValid ? "invalid" : ""}>{email && emailValid ? "사용 가능한 이메일 형식입니다." : touched.email && !emailValid ? "올바르지 않은 이메일 형식입니다." : "\u00a0"}</small>
        </div>

        <div className="signup-field">
          <label htmlFor="signup-password">비밀번호 입력</label>
          <input id="signup-password" type="password" value={password} autoComplete="new-password" disabled={busy} aria-invalid={touched.password && !passwordValid} onBlur={() => markTouched("password")} onChange={(event) => setPassword(event.target.value)} />
          <small className={password && passwordValid ? "valid" : touched.password && !passwordValid ? "invalid" : ""}>{password && passwordValid ? "사용 가능한 비밀번호입니다." : touched.password && !passwordValid ? "영문 대·소문자와 특수문자를 포함해 8자 이상 입력해 주세요." : "영문 대·소문자, 특수문자 조합 8자 이상"}</small>
        </div>

        <div className="signup-field">
          <label htmlFor="signup-password-confirm">비밀번호 확인</label>
          <input id="signup-password-confirm" type="password" value={passwordConfirm} autoComplete="new-password" disabled={busy} aria-invalid={touched.confirm && !confirmValid} onBlur={() => markTouched("confirm")} onChange={(event) => setPasswordConfirm(event.target.value)} />
          <small className={passwordConfirm && confirmValid ? "valid" : touched.confirm && !confirmValid ? "invalid" : ""}>{passwordConfirm && confirmValid ? "비밀번호가 일치합니다." : touched.confirm && !confirmValid ? "비밀번호가 일치하지 않습니다." : "\u00a0"}</small>
        </div>

        <div className="signup-form-footer">
          <button type="submit" className="signup-submit" disabled={!formValid || busy}>{busy ? "가입 중…" : "가입하기"}</button>
          {!isSupabaseConfigured && <p className="signup-error" role="alert">회원가입 연결 설정이 필요합니다.</p>}
          {error && <p className="signup-error" role="alert">{error}</p>}
          {message && <><p className="signup-message" role="status">{message}</p><button type="button" className="signup-to-login" onClick={onLogin}>로그인 화면으로 이동</button></>}
        </div>
      </form>
    </main>
  );
}
