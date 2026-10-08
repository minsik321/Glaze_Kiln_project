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
import { FEED_POSTS, FEED_USERS, dummyFollowerIds, dummyFollowingIds, findFeedPost, findFeedUser, postsForAccount, postsForUser, type FeedPost, type FeedUser } from "./home/feedData";
import { PostDetailScreen, type PostComment } from "./home/PostDetailScreen";
import { OnboardingGuide } from "./onboarding/OnboardingGuide";
import { MyScreen } from "./profile/MyScreen";
import { requireSupabase } from "./lib/supabase";
import { aiceRunsApi, feedPostsApi } from "./lib/api";
import { feedPostToWorkRecord, workRecordToPostSeed, type RecordPostSeed, type WorkRecordOrigin } from "./records/workRecords";
import { clearWorkProgress, loadWorkProgress, type SavedWorkProgress } from "./aice/workProgress";
import { ChatListScreen, ConversationScreen } from "./chat/ChatScreen";
import { loadChatThreads, saveChatMessage, saveChatThread, type ChatMessage, type ChatThread } from "./chat/chatStore";
import { ConnectionsScreen, type ConnectionTab } from "./profile/ConnectionsScreen";
import { SearchScreen } from "./home/SearchScreen";
import { FeedCollectionScreen } from "./home/FeedCollectionScreen";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;
type AppView = "work" | "followingFeed" | "bookmarks" | "records" | "chat" | "conversation" | "my" | "profile" | "connections" | "post" | "notifications";
type SettingsDetail = "account" | "kiln";
type EntryPhase = "splash" | "onboarding" | "login" | "signup" | "app";
const RecordPickerScreen = lazy(() => import("./records/RecordPickerScreen").then((module) => ({ default: module.RecordPickerScreen })));
const RecordsPanel = lazy(() => import("./records/RecordsPanel").then((module) => ({ default: module.RecordsPanel })));

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const DEMO_POST_COMMENTS: Record<string, PostComment[]> = {
  "chloe-1": [
    { id: "comment-chloe-1-a", body: "청록 결정이 정말 선명하네요. 냉각 구간을 어떻게 잡으셨는지 궁금해요!", displayName: "미라의 흙방", username: "mira.ceramic", avatarUrl: "", createdAt: "2일 전" },
    { id: "comment-chloe-1-b", body: "가장자리의 흐름이 멋져요. 다음 테스트도 기대할게요.", displayName: "도훈 소성실", username: "dohoon.kiln", avatarUrl: "", createdAt: "1일 전" },
  ],
  "sale-moon-jar": [
    { id: "comment-sale-moon-a", body: "실물 색감도 사진처럼 푸른 기가 도나요?", displayName: "세나유약", username: "sena.glaze", avatarUrl: "", createdAt: "18분 전" },
  ],
  "sori-2": [
    { id: "comment-sori-2-a", body: "빙렬이 고르게 나와서 정말 예뻐요.", displayName: "해은도예", username: "haeun.pottery", avatarUrl: "", createdAt: "3일 전" },
    { id: "comment-sori-2-b", body: "청자토와 유약 조합 참고하고 싶어요!", displayName: "채의 그릇", username: "chae.pot", avatarUrl: "", createdAt: "2일 전" },
    { id: "comment-sori-2-c", body: "차분한 색감이 기물 형태와 잘 어울립니다.", displayName: "준 클레이랩", username: "jun.claylab", avatarUrl: "", createdAt: "1일 전" },
  ],
};

function draftToFeedPost(draft: CreatePostDraft): FeedPost {
  const record = draft.record?.details;
  return {
    id: crypto.randomUUID(),
    userId: "self",
    image: draft.images[0],
    label: `${draft.title} ${draft.kind === "sale" ? "판매 게시물" : "작업 게시물"}`,
    size: "medium",
    crop: 1,
    glazeName: draft.title,
    firing: record?.firing ?? (draft.kind === "sale" ? "기물 판매" : "작업 기록"),
    cone: "",
    finish: record?.finish || (draft.kind === "sale" ? "판매 중" : "새 작업"),
    clayBody: record?.clayBody ?? "",
    application: record?.application ?? "",
    recipe: record?.recipe ?? [],
    colorants: record?.colorants ?? [],
    curve: record?.curve.length ? record.curve : [{ minute: 0, temperatureC: 20 }, { minute: 1, temperatureC: 20 }],
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
  //: 작업기록으로 채운 게시 폼 — 기록 선택 화면(picker)이나 기록 상세(detail)에서 들어온다.
  const [createPostRecord, setCreatePostRecord] = useState<{ seed: RecordPostSeed; from: "picker" | "detail" } | null>(null);
  const [pickingRecord, setPickingRecord] = useState(false);
  const [createdPosts, setCreatedPosts] = useState<FeedPost[]>([]);
  const [postError, setPostError] = useState("");
  const [postOverrides, setPostOverrides] = useState<Record<string, FeedPost>>({});
  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(() => new Set());
  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(() => new Set());
  const [followToast, setFollowToast] = useState<{ id: number; message: string } | null>(null);
  const followToastId = useRef(0);
  const [bookmarkedPostIds, setBookmarkedPostIds] = useState<Set<string>>(() => new Set());
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
  const [profileIdentity, setProfileIdentity] = useState<{ displayName: string; avatarUrl: string; bio: string }>();
  const [selectedProfileId, setSelectedProfileId] = useState("chloe");
  const [connectionsOwnerId, setConnectionsOwnerId] = useState("self");
  const [connectionsInitialTab, setConnectionsInitialTab] = useState<ConnectionTab>("followers");
  const [selectedPostId, setSelectedPostId] = useState("chloe-1");
  const [postReturnView, setPostReturnView] = useState<"work" | "followingFeed" | "bookmarks" | "my" | "profile">("work");
  const [postComments, setPostComments] = useState<Record<string, PostComment[]>>(DEMO_POST_COMMENTS);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [activeChatUserId, setActiveChatUserId] = useState<string>();
  const [restoredRun, setRestoredRun] = useState<AiceRun>();
  const [recordEntryOrigin, setRecordEntryOrigin] = useState<WorkRecordOrigin>();
  //: recipes.id of the record a new run starts from — the backend links to it
  //: unchanged, or records it as forked_from when the composition is edited.
  const [restoredRecipeRefId, setRestoredRecipeRefId] = useState<string | null>(null);
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
      .select("display_name, avatar_url, bio")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setProfileIdentity({
          displayName: data.display_name || session.user.user_metadata.display_name || "가마쟁이",
          avatarUrl: data.avatar_url || "",
          bio: data.bio || "",
        });
      });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => () => window.clearTimeout(settingsDetailCloseTimer.current), []);

  //: 올린 게시글은 DB(feed_posts)에 있다 — 로그인하면 다시 불러온다.
  useEffect(() => {
    const token = session?.access_token;
    setCreatedPosts([]);
    if (!token) return;
    let active = true;
    void feedPostsApi.listMine(token).then((posts) => {
      if (active) setCreatedPosts(posts);
    }).catch((error: unknown) => {
      if (active) setPostError(error instanceof Error ? error.message : "게시글을 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [session?.user.id]);

  const reportPostError = (error: unknown, fallback: string) => setPostError(error instanceof Error ? error.message : fallback);

  useEffect(() => {
    const ownerId = session?.user.id;
    setChatThreads([]);
    setActiveChatUserId(undefined);
    setChatError("");
    if (!ownerId) return;
    let active = true;
    setChatLoading(true);
    void loadChatThreads(ownerId).then((threads) => {
      if (active) setChatThreads(threads);
    }).catch((error: unknown) => {
      if (active) setChatError(error instanceof Error ? error.message : "채팅 기록을 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setChatLoading(false);
    });
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!followToast) return;
    const timer = window.setTimeout(() => setFollowToast(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [followToast]);

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
  const displayName = profileIdentity?.displayName || session?.user.user_metadata.display_name
    || session?.user.user_metadata.nickname
    || "가마쟁이";
  const avatarUrl = profileIdentity?.avatarUrl ?? "";
  const bio = profileIdentity?.bio ?? "";
  const applyPostState = (posts: readonly FeedPost[]) => posts.filter((post) => !deletedPostIds.has(post.id)).map((post) => postOverrides[post.id] ?? post);
  const feedPosts = applyPostState([...createdPosts, ...FEED_POSTS]);
  const followingFeedPosts = feedPosts.filter((post) => followedUserIds.has(post.userId));
  const bookmarkedPosts = feedPosts.filter((post) => bookmarkedPostIds.has(post.id));
  const myPosts = applyPostState([...createdPosts, ...postsForAccount(session?.user.email)]);
  const selectedProfileBase = findFeedUser(selectedProfileId);
  const selectedProfile = { ...selectedProfileBase, stats: { ...selectedProfileBase.stats, followers: dummyFollowerIds(selectedProfileId).length + (followedUserIds.has(selectedProfileId) ? 1 : 0), following: dummyFollowingIds(selectedProfileId).length } };
  const selectedPostBase = createdPosts.find((post) => post.id === selectedPostId) ?? findFeedPost(selectedPostId);
  const selectedPost = postOverrides[selectedPostId] ?? selectedPostBase;
  const selfUser: FeedUser = { id: "self", username, displayName, bio, avatarTone: 1, stats: { records: myPosts.length, followers: 0, following: followedUserIds.size } };
  const selectedPostUser = selectedPost.userId === "self"
    ? selfUser
    : findFeedUser(selectedPost.userId);
  const activeChat = chatThreads.find((thread) => thread.userId === activeChatUserId);

  async function openConversation(user: { id: string; username: string; displayName: string; avatarTone: number }) {
    if (!session?.user.id) return;
    const openedAt = new Date().toISOString();
    const thread: ChatThread = { userId: user.id, username: user.username, displayName: user.displayName, avatarTone: user.avatarTone, updatedAt: openedAt, messages: [] };
    try {
      await saveChatThread(session.user.id, thread);
      setChatError("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "대화를 시작하지 못했습니다.");
      setView("chat");
      return;
    }
    setChatThreads((current) => current.some((thread) => thread.userId === user.id)
      ? current
      : [thread, ...current]);
    setActiveChatUserId(user.id);
    setView("conversation");
  }

  async function sharePostInChat(user: { id: string; username: string; displayName: string; avatarTone: number }, body: string) {
    if (!session?.user.id) return;
    const sentAt = new Date().toISOString();
    const message: ChatMessage = { id: crypto.randomUUID(), body, sentAt, sender: "me" };
    const thread: ChatThread = { userId: user.id, username: user.username, displayName: user.displayName, avatarTone: user.avatarTone, updatedAt: sentAt, messages: [] };
    try {
      await saveChatThread(session.user.id, thread);
      await saveChatMessage(session.user.id, user.id, message);
      setChatError("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "게시물을 채팅으로 보내지 못했습니다.");
      setView("chat");
      return;
    }
    setChatThreads((current) => {
      const existing = current.find((thread) => thread.userId === user.id);
      if (!existing) return [{ userId: user.id, username: user.username, displayName: user.displayName, avatarTone: user.avatarTone, updatedAt: sentAt, messages: [message] }, ...current];
      return current.map((thread) => thread.userId === user.id
        ? { ...thread, updatedAt: sentAt, messages: [...thread.messages, message] }
        : thread);
    });
    setActiveChatUserId(user.id);
    setView("conversation");
  }

  async function sendChatMessage(message: ChatMessage) {
    if (!session?.user.id || !activeChatUserId) throw new Error("로그인한 채팅을 찾을 수 없습니다.");
    await saveChatMessage(session.user.id, activeChatUserId, message);
    setChatThreads((current) => current.map((thread) => thread.userId === activeChatUserId
      ? { ...thread, updatedAt: message.sentAt, messages: [...thread.messages, message] }
      : thread));
  }

  function toggleFollow(userId: string) {
    if (userId === "self") return;
    const wasFollowing = followedUserIds.has(userId);
    setFollowedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setFollowToast({
      id: ++followToastId.current,
      message: `${findFeedUser(userId).displayName}님을 ${wasFollowing ? "언팔로우했습니다." : "팔로우했습니다."}`,
    });
  }

  function toggleBookmark(postId: string) {
    setBookmarkedPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function openConnections(ownerId: string, tab: ConnectionTab) {
    setConnectionsOwnerId(ownerId);
    setConnectionsInitialTab(tab);
    setView("connections");
  }

  const connectionsOwner = connectionsOwnerId === "self" ? selfUser : findFeedUser(connectionsOwnerId);
  const connectionFollowers = connectionsOwnerId === "self"
    ? []
    : [...dummyFollowerIds(connectionsOwnerId).map(findFeedUser), ...(followedUserIds.has(connectionsOwnerId) ? [selfUser] : [])];
  const connectionFollowing = connectionsOwnerId === "self"
    ? [...followedUserIds].map(findFeedUser)
    : dummyFollowingIds(connectionsOwnerId).map(findFeedUser);

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
    setRestoredRecipeRefId(null);
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
    <AppShell navigation={createPostKind || pickingRecord || showSearch || showWorkflow || recordDetailOpen || view === "followingFeed" || view === "bookmarks" || view === "profile" || view === "connections" || view === "conversation" || view === "post" || view === "notifications" || mySettingsOpen ? null : <BottomNavigation current={navigationView} items={navigation} onChange={changeNavigation} />}>
        <section className="app-view" hidden={view !== "work"}>
          <HomeScreen
            posts={feedPosts}
            selfUser={selfUser}
            onStartWork={openWorkflow}
            onCreatePost={(kind) => { if (kind === "work" && session) setPickingRecord(true); else setCreatePostKind(kind); }}
            onOpenProfile={(userId) => { if (userId === "self") setView("my"); else { setSelectedProfileId(userId); setView("profile"); } }}
            onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("work"); setView("post"); }}
            onOpenSearch={() => { setSearchClosing(false); setShowSearch(true); }}
            onOpenFollowingFeed={() => setView("followingFeed")}
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
                <AicePrototype onSnapshotReady={connectSnapshot} restoredRun={restoredRun} recordEntryOrigin={recordEntryOrigin} recipeRefId={restoredRecipeRefId} resumeStep={resumeStep} token={session?.access_token} userId={session?.user.id} userName={displayName} onStartNew={() => {
                  clearWorkProgress();
                  setRestoredRun(undefined);
                  setRecordEntryOrigin(undefined);
                  setRestoredRecipeRefId(null);
                  setResumeStep(undefined);
                }} onFinish={() => {
                  clearWorkProgress();
                  setShowWorkflow(false);
                  setRestoredRun(undefined);
                  setRecordEntryOrigin(undefined);
                  setResumeStep(undefined);
                  setRecordDetailOpen(false);
                  setView("records");
                }} onBackHome={closeWorkflow} />
              </div>
            </div>
          )}
        </section>
        <section className="app-view" hidden={view !== "followingFeed"}>
          {view === "followingFeed" && <FeedCollectionScreen selfUser={selfUser} title="팔로우 피드" posts={followingFeedPosts} emptyTitle="팔로우한 작가의 게시물이 없어요" emptyDescription="관심 있는 작가를 팔로우하면 새 게시물이 여기에 모여요." onBack={() => setView("work")} onOpenProfile={(userId) => { if (userId === "self") setView("my"); else { setSelectedProfileId(userId); setView("profile"); } }} onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("followingFeed"); setView("post"); }} />}
        </section>
        <section className="app-view" hidden={view !== "bookmarks"}>
          {view === "bookmarks" && <FeedCollectionScreen selfUser={selfUser} title="북마크" posts={bookmarkedPosts} emptyTitle="저장한 게시물이 없어요" emptyDescription="게시물 상세에서 북마크를 누르면 이곳에 모아볼 수 있어요." onBack={() => setView("work")} onOpenProfile={(userId) => { if (userId === "self") setView("my"); else { setSelectedProfileId(userId); setView("profile"); } }} onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("bookmarks"); setView("post"); }} />}
        </section>
        {createPostKind && (
          <CreatePostScreen
            kind={createPostKind}
            record={createPostRecord?.seed}
            onBack={() => {
              if (createPostRecord?.from === "picker") setPickingRecord(true);
              setCreatePostKind(null);
              setCreatePostRecord(null);
            }}
            onSubmit={(draft) => {
              const finish = (post: FeedPost) => {
                setCreatedPosts((current) => [post, ...current]);
                setCreatePostKind(null);
                setCreatePostRecord(null);
                setView("work");
              };
              const post = draftToFeedPost(draft);
              if (!session) { finish(post); return; }
              setPostError("");
              void feedPostsApi.create(session.access_token, post).then(finish).catch((error: unknown) => reportPostError(error, "게시글을 저장하지 못했습니다."));
            }}
          />
        )}
        {postError && <p className="post-save-error" role="alert" onClick={() => setPostError("")}>{postError}</p>}
        {pickingRecord && session && (
          <Suspense fallback={<p role="status">기록 화면을 불러오는 중…</p>}>
            <RecordPickerScreen
              token={session.access_token}
              onBack={() => setPickingRecord(false)}
              onSelect={(record) => {
                setPickingRecord(false);
                setCreatePostRecord({ seed: workRecordToPostSeed(record.id, record.run), from: "picker" });
                setCreatePostKind("work");
              }}
            />
          </Suspense>
        )}
        {showSearch && (
          <SearchScreen
            posts={feedPosts}
            closing={searchClosing}
            onBack={closeSearch}
            onOpenPost={(postId) => { setShowSearch(false); setSearchClosing(false); setSelectedPostId(postId); setPostReturnView("work"); setView("post"); }}
            onAnimationEnd={(event) => {
              if (event.currentTarget !== event.target || !searchClosing) return;
              setShowSearch(false);
              setSearchClosing(false);
            }}
          />
        )}
        <section className="app-view app-utility-view" hidden={view !== "records"}>
          {view === "records" && <Suspense fallback={<p role="status">기록 화면을 불러오는 중…</p>}><RecordsPanel onDetailOpenChange={setRecordDetailOpen} onPublish={(record) => { setCreatePostRecord({ seed: workRecordToPostSeed(record.id, record.run), from: "detail" }); setCreatePostKind("work"); }} onStart={(run, origin, recipeRefId) => {
            setRecordDetailOpen(false);
            setRestoredRun(run);
            setRecordEntryOrigin(origin);
            setRestoredRecipeRefId(recipeRefId);
            setResumeStep(1);
            setView("work");
            setWorkflowClosing(false);
            setWorkflowDragX(0);
            setShowWorkflow(true);
          }} /></Suspense>}
        </section>
        <section className="app-view app-utility-view" hidden={view !== "chat"}>
          {chatError && <p role="alert">{chatError}</p>}
          {chatLoading ? <p role="status">채팅 기록을 불러오는 중…</p> : <ChatListScreen threads={chatThreads} onOpen={(userId) => { setActiveChatUserId(userId); setView("conversation"); }} />}
        </section>
        <section className="app-view" hidden={view !== "conversation"}>
          {activeChat && <ConversationScreen thread={activeChat} onBack={() => setView("chat")} onSend={sendChatMessage} />}
        </section>
        <section className="app-view" hidden={view !== "my"}>
          <MyScreen
            username={username}
            displayName={displayName}
            bio={bio}
            avatarUrl={avatarUrl}
            posts={myPosts}
            onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("my"); setView("post"); }}
            onOpenBookmarks={() => setView("bookmarks")}
            stats={{ records: myPosts.length, followers: 0, following: followedUserIds.size }}
            onOpenConnections={(tab) => openConnections("self", tab)}
            onOpenAccountSettings={() => openSettingsDetail("account")}
            onOpenKilnSettings={() => openSettingsDetail("kiln")}
            onSaveProfile={async ({ nickname, avatarUrl: nextAvatarUrl, bio: nextBio }) => {
              if (!session) throw new Error("로그인 정보를 확인할 수 없습니다.");
              const client = requireSupabase();
              const saved = await client.from("profiles").upsert(
                { id: session.user.id, display_name: nickname, avatar_url: nextAvatarUrl || null, bio: nextBio },
                { onConflict: "id" },
              );
              if (saved.error) {
                if (saved.error.code === "23505") throw new Error("이미 사용중인 닉네임입니다.");
                throw new Error(saved.error.message || "프로필을 저장하지 못했습니다.");
              }
              setProfileIdentity({ displayName: nickname, avatarUrl: nextAvatarUrl, bio: nextBio });
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
          <MyScreen variant="other" username={selectedProfile.username} displayName={selectedProfile.displayName} bio={selectedProfile.bio} avatarTone={selectedProfile.avatarTone} stats={selectedProfile.stats} posts={applyPostState(postsForUser(selectedProfile.id))} onBack={() => setView("work")} onMessage={() => openConversation(selectedProfile)} isFollowing={followedUserIds.has(selectedProfile.id)} onToggleFollow={() => toggleFollow(selectedProfile.id)} onOpenConnections={(tab) => openConnections(selectedProfile.id, tab)} onOpenPost={(postId) => { setSelectedPostId(postId); setPostReturnView("profile"); setView("post"); }} />
        </section>
        <section className="app-view" hidden={view !== "connections"}>
          {view === "connections" && <ConnectionsScreen
            key={`${connectionsOwnerId}-${connectionsInitialTab}`}
            ownerName={connectionsOwner.displayName}
            initialTab={connectionsInitialTab}
            followers={connectionFollowers}
            following={connectionFollowing}
            viewerFollowingIds={followedUserIds}
            onBack={() => setView(connectionsOwnerId === "self" ? "my" : "profile")}
            onOpenProfile={(userId) => { if (userId === "self") setView("my"); else { setSelectedProfileId(userId); setView("profile"); } }}
            onToggleFollow={toggleFollow}
          />}
        </section>
        <section className="app-view" hidden={view !== "post"}>
          <PostDetailScreen
            //: 화면을 벗어나면 다시 만들어 수정 모드·입력 중이던 내용이 남지 않게 한다.
            key={`${selectedPost.id}-${view === "post" ? "open" : "closed"}`}
            post={selectedPost}
            user={selectedPostUser}
            viewer={{ displayName, username, avatarUrl }}
            comments={postComments[selectedPost.id] ?? []}
            isOwnPost={selectedPost.userId === "self"}
            isFollowing={followedUserIds.has(selectedPostUser.id)}
            isSaved={bookmarkedPostIds.has(selectedPost.id)}
            shareRecipients={[...followedUserIds].map(findFeedUser)}
            onToggleFollow={() => toggleFollow(selectedPostUser.id)}
            onToggleSaved={() => toggleBookmark(selectedPost.id)}
            onEdit={(changes) => {
              const next = { ...selectedPost, ...changes };
              setPostOverrides((current) => ({ ...current, [selectedPost.id]: next }));
              if (session && createdPosts.some((post) => post.id === next.id)) {
                setPostError("");
                void feedPostsApi.update(session.access_token, next).then((saved) => {
                  setCreatedPosts((current) => current.map((post) => post.id === saved.id ? saved : post));
                  setPostOverrides((current) => { const { [saved.id]: _removed, ...rest } = current; return rest; });
                }).catch((error: unknown) => reportPostError(error, "수정 내용을 저장하지 못했습니다."));
              }
            }}
            onDelete={() => {
              const id = selectedPost.id;
              setDeletedPostIds((current) => new Set(current).add(id));
              setView(postReturnView);
              if (session && createdPosts.some((post) => post.id === id)) {
                void feedPostsApi.remove(session.access_token, id).catch((error: unknown) => {
                  setDeletedPostIds((current) => { const next = new Set(current); next.delete(id); return next; });
                  reportPostError(error, "게시글을 삭제하지 못했습니다.");
                });
              }
            }}
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
            onStartChat={() => openConversation(selectedPostUser)}
            onShareToChat={(recipientId, message) => sharePostInChat(findFeedUser(recipientId), message)}
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
        {followToast && <div className={`follow-toast${view === "post" && selectedPost.kind === "sale" ? " on-sale-detail" : ""}`} key={followToast.id} role="status" aria-live="polite">{followToast.message}</div>}
    </AppShell>
  );
}
