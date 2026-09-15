import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, initialRecoveryRequested } from "../lib/supabase";

type AuthState = {
  session: Session | null;
  loading: boolean;
  recovery: boolean;
  finishRecovery: () => void;
  error: string;
};
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let eventReceived = false;
    // Subscribe before reading: a recovery/sign-in event must win over a stale read.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      eventReceived = true;
      setSession(next);
      setLoading(false);
      setError("");
      if (
        event === "PASSWORD_RECOVERY" ||
        (event === "INITIAL_SESSION" && next && initialRecoveryRequested)
      )
        setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    void supabase.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (!active || eventReceived) return;
        setSession(data.session);
        if (data.session && initialRecoveryRequested) setRecovery(true);
        setError(failure?.message ?? "");
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (!active || eventReceived) return;
        setError(
          failure instanceof Error
            ? failure.message
            : "로그인 상태를 확인하지 못했습니다.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        recovery,
        finishRecovery: () => setRecovery(false),
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
