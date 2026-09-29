import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AuthPanel } from "./auth/AuthPanel";
import { LoginScreen } from "./auth/LoginScreen";
import { SignupScreen } from "./auth/SignupScreen";
import type { SimulatorSnapshot } from "./aice/snapshot";
import { AicePrototype } from "./aice/AicePrototype";
import { AppShell, BottomNavigation } from "./aice/ui";
import type { AiceRun } from "./aice/contract";
import { useAuth } from "./auth/AuthProvider";
import { HomeScreen } from "./home/HomeScreen";
import { findFeedUser, postsForAccount, postsForUser } from "./home/feedData";
import { OnboardingGuide } from "./onboarding/OnboardingGuide";
import { MyScreen } from "./profile/MyScreen";
import { requireSupabase } from "./lib/supabase";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;
type AppView = "work" | "search" | "records" | "account" | "kiln" | "my" | "profile";
type EntryPhase = "splash" | "onboarding" | "login" | "signup" | "app";
const RecordsPanel = lazy(() => import("./records/RecordsPanel").then((module) => ({ default: module.RecordsPanel })));

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function App() {
  const { session } = useAuth();
  const [entryPhase, setEntryPhase] = useState<EntryPhase>("splash");
  const [signupReturn, setSignupReturn] = useState<"onboarding" | "login">("onboarding");
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowClosing, setWorkflowClosing] = useState(false);
  const [workflowDragX, setWorkflowDragX] = useState(0);
  const workflowGesture = useRef({ active: false, startX: 0, startY: 0, latestX: 0, latestY: 0 });
  const [getSnapshot, setGetSnapshot] = useState<SnapshotGetter>();
  const [view, setView] = useState<AppView>("work");
  const [mySettingsOpen, setMySettingsOpen] = useState(false);
  const [settingsOpenRequest, setSettingsOpenRequest] = useState(0);
  const [profileIdentity, setProfileIdentity] = useState<{ displayName: string; avatarUrl: string }>();
  const [selectedProfileId, setSelectedProfileId] = useState("chloe");
  const [restoredRun, setRestoredRun] = useState<AiceRun>();
  const onboardingAfterSplash = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("onboarding") === "1";
  const connectSnapshot = useCallback((getter: SnapshotGetter) => {
    setGetSnapshot(() => getter);
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setProfileIdentity(undefined);
      return;
    }
    let active = true;
    void requireSupabase()
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setProfileIdentity({
          displayName: data.display_name || session.user.user_metadata.display_name || "가마쟁이",
          avatarUrl: data.avatar_url || session.user.user_metadata.avatar_url || "",
        });
      });
    return () => { active = false; };
  }, [session?.user.id]);

  if (entryPhase === "splash") {
    return (
      <main className="entry-screen splash-screen" aria-label="AICE 스플래시 화면">
        <div className="splash-brand" onAnimationEnd={() => setEntryPhase(onboardingAfterSplash ? "onboarding" : "login")}>
          <img className="splash-logo" src="/aice-splash.png" alt="AICE" width="320" height="320" />
          <strong className="splash-title">Kiln</strong>
        </div>
        <small className="splash-copyright">AICE_Kiln@All rights reserved.</small>
      </main>
    );
  }

  if (entryPhase === "onboarding") {
    const finishOnboarding = () => {
      window.history.replaceState({}, "", window.location.pathname);
      setView("work");
      setEntryPhase("app");
    };
    return (
      <OnboardingGuide
        onSkip={finishOnboarding}
        onStart={finishOnboarding}
      />
    );
  }

  if (entryPhase === "login") {
    return <LoginScreen onSuccess={() => { setView("work"); setEntryPhase("app"); }} onSignup={() => { setSignupReturn("login"); setEntryPhase("signup"); }} />;
  }

  if (entryPhase === "signup") {
    return (
      <SignupScreen
        onBack={() => setEntryPhase(signupReturn)}
        onLogin={() => setEntryPhase("login")}
        onSuccess={() => setEntryPhase("onboarding")}
      />
    );
  }

  const navigation = [
    { id: "home", label: "홈", icon: <NavIcon><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-7h6v7" /></NavIcon> },
    { id: "search", label: "검색", icon: <NavIcon><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></NavIcon> },
    { id: "history", label: "생성기록", icon: <NavIcon><path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16" /><path d="M8 14h3M8 17h6" /></NavIcon> },
    { id: "my", label: "마이", icon: <NavIcon><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></NavIcon> },
  ] as const;

  const navigationView = view === "search" ? "search" : view === "records" ? "history" : view === "my" || view === "account" || view === "kiln" ? "my" : "home";
  const username = session?.user.user_metadata.username
    ?? session?.user.user_metadata.full_name
    ?? session?.user.email?.split("@")[0]
    ?? "Chloe.jung";
  const displayName = profileIdentity?.displayName ?? session?.user.user_metadata.display_name
    ?? session?.user.user_metadata.nickname
    ?? "가마쟁이";
  const avatarUrl = profileIdentity?.avatarUrl ?? session?.user.user_metadata.avatar_url ?? "";
  const myPosts = postsForAccount(session?.user.email);
  const selectedProfile = findFeedUser(selectedProfileId);

  function changeNavigation(next: typeof navigation[number]["id"]) {
    setShowWorkflow(false);
    setWorkflowClosing(false);
    setWorkflowDragX(0);
    if (next === "history") setView("records");
    else if (next === "my") setView("my");
    else if (next === "search") setView("search");
    else setView("work");
  }

  function returnToMySettings() {
    setView("my");
    setSettingsOpenRequest((request) => request + 1);
  }

  function openWorkflow() {
    setView("work");
    setWorkflowClosing(false);
    setWorkflowDragX(0);
    setShowWorkflow(true);
  }

  function closeWorkflow() {
    if (workflowClosing) return;
    setWorkflowDragX(0);
    setWorkflowClosing(true);
  }

  function handleWorkflowPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.clientX > 28 || workflowClosing) return;
    workflowGesture.current = { active: true, startX: event.clientX, startY: event.clientY, latestX: event.clientX, latestY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWorkflowPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = workflowGesture.current;
    if (!gesture.active) return;
    gesture.latestX = event.clientX;
    gesture.latestY = event.clientY;
    const deltaX = Math.max(0, event.clientX - gesture.startX);
    const deltaY = Math.abs(event.clientY - gesture.startY);
    if (deltaX > deltaY) setWorkflowDragX(Math.min(deltaX, 180));
  }

  function finishWorkflowGesture() {
    const gesture = workflowGesture.current;
    if (!gesture.active) return;
    const deltaX = gesture.latestX - gesture.startX;
    const deltaY = Math.abs(gesture.latestY - gesture.startY);
    gesture.active = false;
    if (deltaX >= 64 && deltaX > deltaY) closeWorkflow();
    else setWorkflowDragX(0);
  }

  return (
    <AppShell navigation={showWorkflow || view === "profile" || view === "account" || view === "kiln" || mySettingsOpen ? null : <BottomNavigation current={navigationView} items={navigation} onChange={changeNavigation} />}>
        <section className="app-view" hidden={view !== "work"}>
          <HomeScreen onStartWork={openWorkflow} onOpenProfile={(userId) => { setSelectedProfileId(userId); setView("profile"); }} />
          {showWorkflow && (
            <div
              className="workflow-slide-panel"
              style={{ "--workflow-drag-x": `${workflowDragX}px` } as CSSProperties}
              onPointerDown={handleWorkflowPointerDown}
              onPointerMove={handleWorkflowPointerMove}
              onPointerUp={finishWorkflowGesture}
              onPointerCancel={finishWorkflowGesture}
            >
              <div
                className={`workflow-slide-panel-content${workflowClosing ? " is-closing" : ""}`}
                onAnimationEnd={() => {
                  if (!workflowClosing) return;
                  setShowWorkflow(false);
                  setWorkflowClosing(false);
                }}
              >
                <AicePrototype onSnapshotReady={connectSnapshot} restoredRun={restoredRun} token={session?.access_token} userId={session?.user.id} onSaved={() => setView("records")} onBackHome={closeWorkflow} />
              </div>
            </div>
          )}
        </section>
        <section className="app-view app-utility-view" hidden={view !== "search"}>
          <div className="utility-header">
            <span className="eyebrow">AICE KILN</span>
            <h1>검색</h1>
            <p>유약과 사용자, 게시물을 찾아보세요.</p>
          </div>
        </section>
        <section className="app-view app-utility-view" hidden={view !== "records"}>
          <div className="utility-header">
            <span className="eyebrow">AICE KILN</span>
            <h1>작업 기록</h1>
            <p>지난 실험과 소성 결과를 모아봅니다.</p>
          </div>
          {view === "records" && <Suspense fallback={<p role="status">기록 화면을 불러오는 중…</p>}><RecordsPanel getSnapshot={getSnapshot} onRestore={(run) => { setRestoredRun(run); setView("work"); }} /></Suspense>}
        </section>
        <section className="app-view account-settings-view" hidden={view !== "account"}>
          <header className="account-settings-header">
            <button type="button" aria-label="설정으로 돌아가기" onClick={returnToMySettings}>
              <NavIcon><path d="m15 5-7 7 7 7" /></NavIcon>
            </button>
            <h1>계정 설정</h1>
            <span aria-hidden="true" />
          </header>
          <div className="account-settings-content">
            <AuthPanel mode="account" />
          </div>
        </section>
        <section className="app-view account-settings-view" hidden={view !== "kiln"}>
          <header className="account-settings-header">
            <button type="button" aria-label="설정으로 돌아가기" onClick={returnToMySettings}>
              <NavIcon><path d="m15 5-7 7 7 7" /></NavIcon>
            </button>
            <h1>가마 설정</h1>
            <span aria-hidden="true" />
          </header>
          <div className="account-settings-content">
            <AuthPanel mode="kiln" />
          </div>
        </section>
        <section className="app-view" hidden={view !== "my"}>
          <MyScreen
            username={username}
            displayName={displayName}
            avatarUrl={avatarUrl}
            posts={myPosts}
            stats={{ records: myPosts.length, followers: 545, following: 256 }}
            onOpenAccountSettings={() => setView("account")}
            onOpenKilnSettings={() => setView("kiln")}
            settingsOpenRequest={settingsOpenRequest}
            onSaveProfile={async ({ nickname, avatarUrl: nextAvatarUrl }) => {
              if (!session) throw new Error("로그인 정보를 확인할 수 없습니다.");
              const client = requireSupabase();
              const saved = await client.from("profiles").upsert(
                { id: session.user.id, display_name: nickname, avatar_url: nextAvatarUrl || null },
                { onConflict: "id" },
              );
              if (saved.error) {
                if (saved.error.code === "23505") throw new Error("이미 사용중인 닉네임입니다.");
                throw new Error(saved.error.message || "프로필을 저장하지 못했습니다.");
              }
              const metadata = await client.auth.updateUser({ data: { display_name: nickname, avatar_url: nextAvatarUrl || null } });
              if (metadata.error) throw metadata.error;
              setProfileIdentity({ displayName: nickname, avatarUrl: nextAvatarUrl });
            }}
            onSettingsOpenChange={setMySettingsOpen}
            onLogout={async () => {
              if (!session) return;
              const { error } = await requireSupabase().auth.signOut();
              if (error) throw error;
            }}
            onDeleteAccount={async (password) => {
              if (!session?.user.email) throw new Error("로그인 정보를 확인할 수 없습니다.");
              const client = requireSupabase();
              const verified = await client.auth.signInWithPassword({ email: session.user.email, password });
              if (verified.error) throw new Error("비밀번호가 올바르지 않습니다.");
              const removed = await client.rpc("delete_current_user");
              if (removed.error) {
                const functionMissing = removed.error.code === "PGRST202" || removed.error.code === "42883";
                throw new Error(
                  functionMissing
                    ? "회원탈퇴 기능이 서버에 적용되지 않았습니다. 데이터베이스 마이그레이션을 확인해 주세요."
                    : removed.error.message || "회원탈퇴 처리 중 서버 오류가 발생했습니다.",
                );
              }
              await client.auth.signOut({ scope: "local" });
            }}
            onReturnToLogin={() => {
              setMySettingsOpen(false);
              setView("work");
              setEntryPhase("login");
            }}
          />
        </section>
        <section className="app-view" hidden={view !== "profile"}>
          <MyScreen variant="other" username={selectedProfile.username} displayName={selectedProfile.displayName} avatarTone={selectedProfile.avatarTone} stats={selectedProfile.stats} posts={postsForUser(selectedProfile.id)} onBack={() => setView("work")} />
        </section>
    </AppShell>
  );
}
