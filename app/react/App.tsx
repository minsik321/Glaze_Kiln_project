import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AuthPanel } from "./auth/AuthPanel";
import { LoginScreen } from "./auth/LoginScreen";
import { SignupScreen } from "./auth/SignupScreen";
import type { SimulatorSnapshot } from "./aice/snapshot";
import { AicePrototype } from "./aice/AicePrototype";
import { AppShell, BottomNavigation } from "./aice/ui";
import type { AiceRun } from "./aice/contract";
import { useAuth } from "./auth/AuthProvider";
import { HomeScreen } from "./home/HomeScreen";
import { findFeedUser, postsForUser } from "./home/feedData";
import { OnboardingGuide } from "./onboarding/OnboardingGuide";
import { MyScreen } from "./profile/MyScreen";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;
type AppView = "work" | "search" | "records" | "account" | "my" | "profile";
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
  const [selectedProfileId, setSelectedProfileId] = useState("chloe");
  const [restoredRun, setRestoredRun] = useState<AiceRun>();
  const onboardingAfterSplash = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("onboarding") === "1";
  const connectSnapshot = useCallback((getter: SnapshotGetter) => {
    setGetSnapshot(() => getter);
  }, []);

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

  const navigationView = view === "search" ? "search" : view === "records" ? "history" : view === "my" || view === "account" ? "my" : "home";
  const username = session?.user.user_metadata.username
    ?? session?.user.user_metadata.full_name
    ?? session?.user.email?.split("@")[0]
    ?? "Chloe.jung";
  const displayName = session?.user.user_metadata.display_name
    ?? session?.user.user_metadata.nickname
    ?? "가마쟁이";
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
    <AppShell navigation={showWorkflow || view === "profile" ? null : <BottomNavigation current={navigationView} items={navigation} onChange={changeNavigation} />}>
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
        <section className="app-view app-utility-view" hidden={view !== "account"}>
          <div className="utility-header">
            <span className="eyebrow">AICE KILN</span>
            <h1>내 계정</h1>
            <p>로그인과 프로필을 관리합니다.</p>
          </div>
          <AuthPanel />
        </section>
        <section className="app-view" hidden={view !== "my"}>
          <MyScreen username={username} displayName={displayName} onEditProfile={() => setView("account")} />
        </section>
        <section className="app-view" hidden={view !== "profile"}>
          <MyScreen variant="other" username={selectedProfile.username} displayName={selectedProfile.displayName} avatarTone={selectedProfile.avatarTone} stats={selectedProfile.stats} posts={postsForUser(selectedProfile.id)} onBack={() => setView("work")} />
        </section>
    </AppShell>
  );
}
