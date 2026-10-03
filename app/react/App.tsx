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
import { CreatePostScreen, type CreatePostDraft, type CreatePostKind } from "./home/CreatePostScreen";
import { NotificationScreen } from "./home/NotificationScreen";
import { FEED_POSTS, findFeedPost, findFeedUser, postsForAccount, postsForUser, type FeedPost } from "./home/feedData";
import { PostDetailScreen, type PostComment } from "./home/PostDetailScreen";
import { OnboardingGuide } from "./onboarding/OnboardingGuide";
import { MyScreen } from "./profile/MyScreen";
import { requireSupabase } from "./lib/supabase";
import { aiceRunsApi } from "./lib/api";
import { feedPostToWorkRecord, type WorkRecordOrigin } from "./records/workRecords";
import { clearWorkProgress, loadWorkProgress, type SavedWorkProgress } from "./aice/workProgress";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;
type AppView = "work" | "records" | "chat" | "my" | "profile" | "post" | "notifications";
type SettingsDetail = "account" | "kiln";
type EntryPhase = "splash" | "onboarding" | "login" | "signup" | "app";
const RecordsPanel = lazy(() => import("./records/RecordsPanel").then((module) => ({ default: module.RecordsPanel })));

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function draftToFeedPost(draft: CreatePostDraft): FeedPost {
  return {
    id: crypto.randomUUID(),
    userId: "self",
    image: draft.images[0],
    label: `${draft.title} ${draft.kind === "sale" ? "판매 게시물" : "작업 게시물"}`,
    size: "medium",
    crop: 1,
    glazeName: draft.title,
    firing: draft.kind === "sale" ? "기물 판매" : "작업 기록",
    cone: "",
    finish: draft.kind === "sale" ? "판매 중" : "새 작업",
    clayBody: "",
    application: "",
    recipe: [],
    colorants: [],
    curve: [{ minute: 0, temperatureC: 20 }, { minute: 1, temperatureC: 20 }],
    memo: draft.description,
    publishedAt: "방금 전",
    kind: draft.kind,
    price: draft.price,
    priceNegotiable: draft.priceNegotiable,
  };
}

export function App() {
  const { session } = useAuth();
  const [entryPhase, setEntryPhase] = useState<EntryPhase>("splash");
  const [signupReturn, setSignupReturn] = useState<"onboarding" | "login">("onboarding");
  const [showSearch, setShowSearch] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [createPostKind, setCreatePostKind] = useState<CreatePostKind | null>(null);
  const [createdPosts, setCreatedPosts] = useState<FeedPost[]>([]);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [workflowClosing, setWorkflowClosing] = useState(false);
  const [workflowDragX, setWorkflowDragX] = useState(0);
  const workflowGesture = useRef({ active: false, startX: 0, startY: 0, latestX: 0, latestY: 0 });
  const [getSnapshot, setGetSnapshot] = useState<SnapshotGetter>();
  const [view, setView] = useState<AppView>("work");
  const [mySettingsOpen, setMySettingsOpen] = useState(false);
  const [settingsDetail, setSettingsDetail] = useState<SettingsDetail | null>(null);
  const [settingsDetailClosing, setSettingsDetailClosing] = useState(false);
  const settingsDetailCloseTimer = useRef<number | undefined>(undefined);
  const [profileIdentity, setProfileIdentity] = useState<{ displayName: string; avatarUrl: string }>();
  const [selectedProfileId, setSelectedProfileId] = useState("chloe");
  const [selectedPostId, setSelectedPostId] = useState("chloe-1");
  const [postReturnView, setPostReturnView] = useState<"work" | "my" | "profile">("work");
  const [postComments, setPostComments] = useState<Record<string, PostComment[]>>({});
  const [restoredRun, setRestoredRun] = useState<AiceRun>();
  const [recordEntryOrigin, setRecordEntryOrigin] = useState<WorkRecordOrigin>();
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [resumeStep, setResumeStep] = useState<number>();
  const [resumePrompt, setResumePrompt] = useState<SavedWorkProgress | null>(null);
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

  useEffect(() => () => window.clearTimeout(settingsDetailCloseTimer.current), []);

  useEffect(() => {
    if (entryPhase !== "splash") return;
    const timer = window.setTimeout(() => setEntryPhase("onboarding"), 1_000);
    return () => window.clearTimeout(timer);
  }, [entryPhase]);

  if (entryPhase === "splash") {
    return (
      <main className="entry-screen splash-screen" aria-label="AICE 스플래시 화면">
        <div className="splash-brand" onAnimationEnd={() => setEntryPhase("onboarding")}>
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
      setEntryPhase("login");
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
    { id: "history", label: "작업기록", icon: <NavIcon><path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16" /><path d="M8 14h3M8 17h6" /></NavIcon> },
    { id: "chat", label: "채팅", icon: <NavIcon><path d="M4 5h16v12H9l-5 4z" /><path d="M8 10h8M8 13h5" /></NavIcon> },
    { id: "my", label: "마이", icon: <NavIcon><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></NavIcon> },
  ] as const;

  const navigationView = view === "records" ? "history" : view === "chat" ? "chat" : view === "my" ? "my" : "home";
  const username = session?.user.user_metadata.username
    ?? session?.user.user_metadata.full_name
    ?? session?.user.email?.split("@")[0]
    ?? "Chloe.jung";
  const displayName = profileIdentity?.displayName ?? session?.user.user_metadata.display_name
    ?? session?.user.user_metadata.nickname
    ?? "가마쟁이";
  const avatarUrl = profileIdentity?.avatarUrl ?? session?.user.user_metadata.avatar_url ?? "";
  const feedPosts = [...createdPosts, ...FEED_POSTS];
  const myPosts = [...createdPosts, ...postsForAccount(session?.user.email)];
  const selectedProfile = findFeedUser(selectedProfileId);
  const selectedPost = createdPosts.find((post) => post.id === selectedPostId) ?? findFeedPost(selectedPostId);
  const selectedPostUser = selectedPost.userId === "self"
    ? { id: "self", username, displayName, avatarTone: 1, stats: { records: myPosts.length, followers: 545, following: 256 } }
    : findFeedUser(selectedPost.userId);

  function changeNavigation(next: typeof navigation[number]["id"]) {
    setShowSearch(false);
    setSearchClosing(false);
    setShowWorkflow(false);
    setRecordDetailOpen(false);
    setWorkflowClosing(false);
    setWorkflowDragX(0);
    if (next === "history") setView("records");
    else if (next === "chat") setView("chat");
    else if (next === "my") setView("my");
    else setView("work");
  }

  function closeSearch() {
    if (searchClosing) return;
    setSearchClosing(true);
  }

  function openSettingsDetail(detail: SettingsDetail) {
    window.clearTimeout(settingsDetailCloseTimer.current);
    setSettingsDetailClosing(false);
    setSettingsDetail(detail);
  }

  function finishClosingSettingsDetail() {
    window.clearTimeout(settingsDetailCloseTimer.current);
    setSettingsDetail(null);
    setSettingsDetailClosing(false);
  }

  function returnToMySettings() {
    if (settingsDetailClosing) return;
    setSettingsDetailClosing(true);
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    settingsDetailCloseTimer.current = window.setTimeout(finishClosingSettingsDetail, reduceMotion ? 0 : 280);
  }

  function startWorkflow(run?: AiceRun, step?: number) {
    setRestoredRun(run);
    setResumeStep(step);
    setRecordEntryOrigin(undefined);
    setView("work");
    setWorkflowClosing(false);
    setWorkflowDragX(0);
    setShowWorkflow(true);
  }

  function openWorkflow() {
    const saved = loadWorkProgress();
    if (saved) {
      setResumePrompt(saved);
      return;
    }
    startWorkflow();
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
    <AppShell navigation={createPostKind || showSearch || showWorkflow || recordDetailOpen || view === "profile" || view === "post" || view === "notifications" || mySettingsOpen ? null : <BottomNavigation current={navigationView} items={navigation} onChange={changeNavigation} />}>
        <section className="app-view" hidden={view !== "work"}>
          <HomeScreen
            posts={feedPosts}
            onStartWork={openWorkflow}
            onCreatePost={setCreatePostKind}
            onOpenProfile={(userId) => { setSelectedProfileId(userId); setView("profile"); }}
            onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("work"); setView("post"); }}
            onOpenSearch={() => { setSearchClosing(false); setShowSearch(true); }}
            onOpenNotifications={() => setView("notifications")}
          />
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
                <AicePrototype onSnapshotReady={connectSnapshot} restoredRun={restoredRun} recordEntryOrigin={recordEntryOrigin} resumeStep={resumeStep} token={session?.access_token} userId={session?.user.id} onStartNew={() => {
                  clearWorkProgress();
                  setRestoredRun(undefined);
                  setRecordEntryOrigin(undefined);
                  setResumeStep(undefined);
                }} onFinish={() => {
                  clearWorkProgress();
                  setShowWorkflow(false);
                  setRestoredRun(undefined);
                  setRecordEntryOrigin(undefined);
                  setResumeStep(undefined);
                  setView("work");
                }} onBackHome={closeWorkflow} />
              </div>
            </div>
          )}
        </section>
        {createPostKind && (
          <CreatePostScreen
            kind={createPostKind}
            onBack={() => setCreatePostKind(null)}
            onSubmit={(draft) => {
              setCreatedPosts((current) => [draftToFeedPost(draft), ...current]);
              setCreatePostKind(null);
              setView("work");
            }}
          />
        )}
        {showSearch && (
          <section
            className={`search-slide-panel${searchClosing ? " is-closing" : ""}`}
            aria-label="검색 화면"
            onAnimationEnd={(event) => {
              if (event.currentTarget !== event.target || !searchClosing) return;
              setShowSearch(false);
              setSearchClosing(false);
            }}
          >
            <div className="search-toolbar">
              <button className="search-back" type="button" aria-label="홈으로 돌아가기" onClick={closeSearch}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
              </button>
              <div className="search-input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
                <input type="search" aria-label="검색" placeholder="검색" />
              </div>
            </div>
          </section>
        )}
        <section className="app-view app-utility-view" hidden={view !== "records"}>
          {view === "records" && <Suspense fallback={<p role="status">기록 화면을 불러오는 중…</p>}><RecordsPanel onDetailOpenChange={setRecordDetailOpen} onStart={(run, origin) => {
            setRecordDetailOpen(false);
            setRestoredRun(run);
            setRecordEntryOrigin(origin);
            setResumeStep(1);
            setView("work");
            setWorkflowClosing(false);
            setWorkflowDragX(0);
            setShowWorkflow(true);
          }} /></Suspense>}
        </section>
        <section className="app-view app-utility-view chat-screen" hidden={view !== "chat"} aria-label="채팅">
          <header className="chat-header"><h1>채팅</h1></header>
          <div className="chat-empty">
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 4z" /><path d="M8 10h8M8 13h5" /></svg></span>
            <strong>아직 대화가 없어요</strong>
            <p>새로운 대화가 시작되면 여기에 표시됩니다.</p>
          </div>
        </section>
        <section className="app-view" hidden={view !== "my"}>
          <MyScreen
            username={username}
            displayName={displayName}
            avatarUrl={avatarUrl}
            posts={myPosts}
            onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("my"); setView("post"); }}
            stats={{ records: myPosts.length, followers: 545, following: 256 }}
            onOpenAccountSettings={() => openSettingsDetail("account")}
            onOpenKilnSettings={() => openSettingsDetail("kiln")}
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
          <MyScreen variant="other" username={selectedProfile.username} displayName={selectedProfile.displayName} avatarTone={selectedProfile.avatarTone} stats={selectedProfile.stats} posts={postsForUser(selectedProfile.id)} onBack={() => setView("work")} onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("profile"); setView("post"); }} />
        </section>
        <section className="app-view" hidden={view !== "post"}>
          <PostDetailScreen
            key={selectedPost.id}
            post={selectedPost}
            user={selectedPostUser}
            viewer={{ displayName, username, avatarUrl }}
            comments={postComments[selectedPost.id] ?? []}
            isOwnPost={selectedPost.userId === "self"}
            onImportRecipe={selectedPost.userId === "self" ? undefined : async () => {
              if (!session) throw new Error("로그인이 필요합니다.");
              const imported = feedPostToWorkRecord(selectedPost, selectedPostUser);
              await aiceRunsApi.create(session.access_token, { title: imported.title, run: imported, request_id: imported.run_id, is_public: false });
            }}
            onAddComment={(body) => setPostComments((current) => ({
              ...current,
              [selectedPost.id]: [
                ...(current[selectedPost.id] ?? []),
                { id: crypto.randomUUID(), body, displayName, username, avatarUrl, createdAt: "방금 전" },
              ],
            }))}
            onBack={() => setView(postReturnView)}
            onStartChat={() => setView("chat")}
            onOpenProfile={(userId) => {
              if (selectedPost.userId === "self") setView("my");
              else { setSelectedProfileId(userId); setView("profile"); }
            }}
          />
        </section>
        <section className="app-view" hidden={view !== "notifications"}>
          <NotificationScreen onBack={() => setView("work")} />
        </section>
        {settingsDetail && (
          <section
            className={`settings-detail-slide account-settings-view${settingsDetailClosing ? " is-closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-detail-title"
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target && settingsDetailClosing) finishClosingSettingsDetail();
            }}
          >
            <header className="account-settings-header">
              <button type="button" aria-label="설정으로 돌아가기" onClick={returnToMySettings}>
                <NavIcon><path d="m15 5-7 7 7 7" /></NavIcon>
              </button>
              <h1 id="settings-detail-title">{settingsDetail === "account" ? "계정 설정" : "가마 설정"}</h1>
              <span aria-hidden="true" />
            </header>
            <div className="account-settings-content">
              <AuthPanel mode={settingsDetail} />
            </div>
          </section>
        )}
        {resumePrompt && (
          <div className="resume-work-dialog-layer">
            <section className="resume-work-dialog" role="alertdialog" aria-modal="true" aria-labelledby="resume-work-dialog-title">
              <h2 id="resume-work-dialog-title">마지막으로 저장된 작업 내용이 있습니다. 이어서 작업하시겠습니까?</h2>
              <div className="resume-work-dialog-actions">
                <button type="button" onClick={() => {
                  clearWorkProgress();
                  setResumePrompt(null);
                  startWorkflow();
                }}>신규 작업</button>
                <button className="primary" type="button" onClick={() => {
                  const saved = resumePrompt;
                  setResumePrompt(null);
                  startWorkflow(saved.run, saved.step);
                }}>예</button>
              </div>
            </section>
          </div>
        )}
    </AppShell>
  );
}
