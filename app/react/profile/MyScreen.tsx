import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type MyScreenProps = {
  username?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  variant?: "mine" | "other";
  avatarTone?: number;
  stats?: { records: number; followers: number; following: number };
  posts?: readonly { id: string; image: string; label: string; crop?: number; kind?: "work" | "sale"; price?: number | null; glazeName?: string }[];
  onBack?: () => void;
  onMessage?: () => void;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  onOpenConnections?: (tab: "followers" | "following") => void;
  onOpenPost?: (postId: string) => void;
  onOpenBookmarks?: () => void;
  onOpenAccountSettings?: () => void;
  onOpenKilnSettings?: () => void;
  onSaveProfile?: (profile: { nickname: string; avatarUrl: string; bio: string }) => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onDeleteAccount?: (password: string) => void | Promise<void>;
  onReturnToLogin?: () => void;
  onSettingsOpenChange?: (open: boolean) => void;
  settingsOpenRequest?: number;
};

type SettingsPage = "menu" | "withdraw" | "privacy" | "notifications";
type SettingsDialog = "logout-confirm" | "logout-success" | "withdraw-confirm" | "withdraw-success" | null;

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

async function profileImageDataUrl(file: File) {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 불러오지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("사진 형식을 확인해 주세요."));
    element.src = source;
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진을 처리하지 못했습니다.");
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    320,
    320,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>;
}

function BookmarkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}

function SaleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h8l10 10-7 7L3 10V4Z" /><circle cx="7.5" cy="7.5" r="1" /></svg>;
}

function WorkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8M9 3v3c0 1.5-.7 2.5-2 3.7A6.8 6.8 0 0 0 5 14a7 7 0 0 0 14 0 6.8 6.8 0 0 0-2-4.3C15.7 8.5 15 7.5 15 6V3M8 12h8" /></svg>;
}

function ChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c4.4 0 8 3.3 8 7.5S16.4 19 12 19c-1.1 0-2.2-.2-3.2-.6L4 20l1.4-4.1A7.1 7.1 0 0 1 4 11.5C4 7.3 7.6 4 12 4Z" /><circle cx="8.5" cy="11.5" r="1" /><circle cx="12" cy="11.5" r="1" /><circle cx="15.5" cy="11.5" r="1" /></svg>;
}

const settingsItems = [
  { id: "account", label: "계정 설정", icon: "person" },
  { id: "privacy", label: "계정 공개 범위", icon: "lock" },
  { id: "notifications", label: "알림 설정", icon: "bell" },
  { id: "kiln", label: "가마 설정", icon: "kiln" },
  { id: "help", label: "도움말", icon: "help" },
  { id: "about", label: "앱 정보", icon: "info" },
  { id: "logout", label: "로그아웃", icon: "logout" },
  { id: "withdraw", label: "회원탈퇴", icon: "leave", danger: true },
] as const;

function SettingsItemIcon({ name }: { name: (typeof settingsItems)[number]["icon"] }) {
  const path = {
    person: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    kiln: <><path d="M7 4h10l2 16H5z" /><path d="M8 10h8M9 14h6M12 6v2" /></>,
    bell: <><path d="M6.5 16.5h11l-1.5-2V10a4 4 0 0 0-8 0v4.5z" /><path d="M10 19h4" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    leave: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01" /></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg>;
}

export function MyScreen({ username = "Chloe.jung", displayName = "가마쟁이", bio = "", avatarUrl = "", variant = "mine", avatarTone = 1, stats = { records: 0, followers: 0, following: 0 }, posts: suppliedPosts = [], onBack, onMessage, isFollowing = false, onToggleFollow, onOpenConnections, onOpenPost, onOpenBookmarks, onOpenAccountSettings, onOpenKilnSettings, onSaveProfile, onLogout, onDeleteAccount, onReturnToLogin, onSettingsOpenChange, settingsOpenRequest = 0 }: MyScreenProps) {
  const [layout, setLayout] = useState<"sale" | "work">("work");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("menu");
  const [settingsPageClosing, setSettingsPageClosing] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialog>(null);
  const [password, setPassword] = useState("");
  const [accountPublic, setAccountPublic] = useState(true);
  const [appNotifications, setAppNotifications] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileNickname, setProfileNickname] = useState(displayName);
  const [profileBio, setProfileBio] = useState(bio);
  const [profileAvatar, setProfileAvatar] = useState(avatarUrl);
  const [profileError, setProfileError] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioTruncated, setBioTruncated] = useState(false);
  const bioRef = useRef<HTMLParagraphElement>(null);
  const settingsCloseTimer = useRef<number | undefined>(undefined);
  const settingsPageCloseTimer = useRef<number | undefined>(undefined);
  const handledSettingsRequest = useRef(settingsOpenRequest);
  const layoutSwipe = useRef({ active: false, startX: 0, startY: 0, latestX: 0, latestY: 0 });
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [postsHeight, setPostsHeight] = useState<number>();
  const postsViewport = useRef<HTMLDivElement>(null);
  const salePanel = useRef<HTMLDivElement>(null);
  const workPanel = useRef<HTMLDivElement>(null);
  const suppressPostClick = useRef(false);
  const isMine = variant === "mine";
  const salePosts = suppliedPosts.filter((post) => post.kind === "sale");
  const workPosts = suppliedPosts.filter((post) => post.kind !== "sale");
  const postsLayoutKey = suppliedPosts.map((post) => `${post.id}:${post.kind ?? "work"}`).join("|");

  useLayoutEffect(() => {
    setBioExpanded(false);
  }, [bio]);

  useLayoutEffect(() => {
    const paragraph = bioRef.current;
    if (!paragraph || bioExpanded) return;
    const checkOverflow = () => setBioTruncated(paragraph.clientHeight === 0 ? bio.length > 80 : paragraph.scrollHeight > paragraph.clientHeight + 1);
    checkOverflow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(paragraph);
    return () => observer.disconnect();
  }, [bio, bioExpanded]);

  useLayoutEffect(() => {
    const panel = layout === "sale" ? salePanel.current : workPanel.current;
    if (!panel) return;
    const updateHeight = () => {
      const height = panel.offsetHeight;
      setPostsHeight((current) => current === height ? current : height);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [layout, postsLayoutKey]);

  function startLayoutSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    layoutSwipe.current = { active: true, startX: event.clientX, startY: event.clientY, latestX: event.clientX, latestY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveLayoutSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (!layoutSwipe.current.active) return;
    layoutSwipe.current.latestX = event.clientX;
    layoutSwipe.current.latestY = event.clientY;
    const deltaX = event.clientX - layoutSwipe.current.startX;
    const deltaY = event.clientY - layoutSwipe.current.startY;
    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const width = postsViewport.current?.clientWidth || 1;
      setDragging(true);
      setDragX(Math.max(layout === "sale" ? -width : 0, Math.min(layout === "sale" ? 0 : width, deltaX)));
    }
  }

  function finishLayoutSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const swipe = layoutSwipe.current;
    if (!swipe.active) return;
    swipe.active = false;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = Math.abs(swipe.latestY - swipe.startY);
    setDragging(false);
    setDragX(0);
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= deltaY) return;
    suppressPostClick.current = true;
    window.setTimeout(() => { suppressPostClick.current = false; }, 0);
    setLayout(deltaX < 0 ? "work" : "sale");
  }

  function openSettings() {
    setSettingsClosing(false);
    setSettingsPageClosing(false);
    setSettingsPage("menu");
    setSettingsDialog(null);
    setSettingsError("");
    setSettingsOpen(true);
    onSettingsOpenChange?.(true);
  }

  function closeSettings() {
    if (settingsClosing) return;
    setSettingsClosing(true);
    window.clearTimeout(settingsCloseTimer.current);
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    settingsCloseTimer.current = window.setTimeout(finishClosingSettings, reduceMotion ? 0 : 280);
  }

  function finishClosingSettings() {
    window.clearTimeout(settingsCloseTimer.current);
    setSettingsOpen(false);
    setSettingsClosing(false);
    onSettingsOpenChange?.(false);
  }

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => () => {
    window.clearTimeout(settingsCloseTimer.current);
    window.clearTimeout(settingsPageCloseTimer.current);
  }, []);

  useEffect(() => {
    if (!isMine || settingsOpenRequest === handledSettingsRequest.current) return;
    handledSettingsRequest.current = settingsOpenRequest;
    setSettingsClosing(false);
    setSettingsPageClosing(false);
    setSettingsPage("menu");
    setSettingsDialog(null);
    setSettingsError("");
    setSettingsOpen(true);
    onSettingsOpenChange?.(true);
  }, [isMine, onSettingsOpenChange, settingsOpenRequest]);

  function selectSetting(id: (typeof settingsItems)[number]["id"]) {
    if (id === "account") {
      onOpenAccountSettings?.();
    }
    if (id === "kiln") {
      onOpenKilnSettings?.();
    }
    if (id === "notifications") {
      setSettingsPageClosing(false);
      setSettingsPage("notifications");
    }
    if (id === "privacy") {
      setSettingsPageClosing(false);
      setSettingsPage("privacy");
    }
    if (id === "withdraw") {
      setPassword("");
      setSettingsError("");
      setSettingsPageClosing(false);
      setSettingsPage("withdraw");
    }
    if (id === "logout") {
      setSettingsDialog("logout-confirm");
    }
  }

  function openProfileEditor() {
    setProfileNickname(displayName);
    setProfileBio(bio);
    setProfileAvatar(avatarUrl);
    setProfileError("");
    setProfileEditorOpen(true);
  }

  async function chooseProfileImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("이미지 파일만 선택할 수 있습니다.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileError("프로필 사진은 8MB 이하로 선택해 주세요.");
      return;
    }
    try {
      setProfileAvatar(await profileImageDataUrl(file));
      setProfileError("");
    } catch (error) {
      setProfileError(errorMessage(error, "사진을 불러오지 못했습니다."));
    }
  }

  async function saveProfile() {
    const nickname = profileNickname.trim();
    if (!nickname) {
      setProfileError("닉네임을 입력해 주세요.");
      return;
    }
    if (nickname.length > 20) {
      setProfileError("닉네임은 20자 이하로 입력해 주세요.");
      return;
    }
    if (!/^[A-Za-z0-9가-힣]+$/.test(nickname)) {
      setProfileError("닉네임은 영문자, 한글, 숫자만 사용할 수 있습니다.");
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    try {
      await onSaveProfile?.({ nickname, avatarUrl: profileAvatar, bio: profileBio.trim() });
      setProfileEditorOpen(false);
    } catch (error) {
      setProfileError(errorMessage(error, "프로필을 저장하지 못했습니다."));
    } finally {
      setProfileBusy(false);
    }
  }

  function settingsBack() {
    if (settingsPage === "menu") closeSettings();
    else {
      if (settingsPageClosing) return;
      setSettingsPageClosing(true);
      window.clearTimeout(settingsPageCloseTimer.current);
      const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      settingsPageCloseTimer.current = window.setTimeout(finishClosingSettingsPage, reduceMotion ? 0 : 280);
    }
  }

  function finishClosingSettingsPage() {
    window.clearTimeout(settingsPageCloseTimer.current);
    setSettingsPage("menu");
    setSettingsPageClosing(false);
    setSettingsError("");
  }

  async function confirmLogout() {
    setSettingsBusy(true);
    setSettingsError("");
    try {
      await onLogout?.();
      setSettingsDialog("logout-success");
    } catch (error) {
      setSettingsDialog(null);
      setSettingsError(errorMessage(error, "로그아웃하지 못했습니다."));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function confirmWithdrawal() {
    setSettingsBusy(true);
    setSettingsError("");
    try {
      await onDeleteAccount?.(password);
      setSettingsDialog("withdraw-success");
    } catch (error) {
      setSettingsDialog(null);
      setSettingsError(errorMessage(error, "회원탈퇴를 완료하지 못했습니다."));
    } finally {
      setSettingsBusy(false);
    }
  }

  return (
    <section className={`my-screen ${isMine ? "mine" : "other"}${settingsOpen ? " settings-open" : ""}`} aria-label={isMine ? "마이 프로필" : `${username} 프로필`}>
      <header className="my-header">
        {isMine
          ? <span aria-hidden="true" />
          : <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>}
        <strong>{username}</strong>
        <div className="my-header-actions">
          {isMine && <button type="button" aria-label="북마크 피드" onClick={onOpenBookmarks}><BookmarkIcon /></button>}
          <button type="button" aria-label={isMine ? "마이 메뉴" : "프로필 더보기"} aria-expanded={isMine ? settingsOpen : undefined} onClick={isMine ? openSettings : undefined}>{isMine ? <MenuIcon /> : <MoreIcon />}</button>
        </div>
      </header>

      {isMine && settingsOpen && (
        <div className="my-settings-layer">
          <aside
            className={`my-settings-panel${settingsClosing ? " is-closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-settings-title"
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target && event.currentTarget.classList.contains("is-closing")) finishClosingSettings();
            }}
          >
            <header className="my-settings-header">
              <button type="button" aria-label="마이 화면으로 돌아가기" onClick={settingsBack}><BackIcon /></button>
              <h2 id="my-settings-title">설정</h2>
              <span aria-hidden="true" />
            </header>
            {settingsError && settingsPage === "menu" && <p className="my-settings-error" role="alert">{settingsError}</p>}
            <nav className="my-settings-menu" aria-label="마이 설정">
              {settingsItems.map((item) => (
                <div className={item.id === "help" ? "my-settings-group-start" : undefined} key={item.id}>
                  <button className={"danger" in item && item.danger ? "danger" : undefined} type="button" onClick={() => selectSetting(item.id)}>
                    <span className="my-settings-icon"><SettingsItemIcon name={item.icon} /></span>
                    <strong className="my-settings-label">{item.label}</strong>
                    <ChevronIcon />
                  </button>
                </div>
              ))}
            </nav>
            <p className="my-settings-version">AICE Kiln · v0.8.0</p>

            {settingsPage !== "menu" && (
              <div
                className={`my-settings-subpage${settingsPageClosing ? " is-closing" : ""}`}
                onAnimationEnd={(event) => {
                  if (event.currentTarget === event.target && settingsPageClosing) finishClosingSettingsPage();
                }}
              >
                <header className="my-settings-header">
                  <button type="button" aria-label="설정으로 돌아가기" onClick={settingsBack}><BackIcon /></button>
                  <h2>{settingsPage === "withdraw" ? "회원탈퇴" : settingsPage === "privacy" ? "계정 공개 범위" : "알림 설정"}</h2>
                  <span aria-hidden="true" />
                </header>

            {settingsPage === "withdraw" && (
              <form className="my-settings-detail" onSubmit={(event) => { event.preventDefault(); if (password) setSettingsDialog("withdraw-confirm"); }}>
                <div className="my-settings-detail-heading"><span className="danger"><SettingsItemIcon name="leave" /></span><h3>계정을 탈퇴할까요?</h3><p>본인 확인을 위해 현재 비밀번호를 입력해 주세요.</p></div>
                <label className="my-settings-password"><span>비밀번호</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="현재 비밀번호 입력" /></label>
                {settingsError && <p className="my-settings-error" role="alert">{settingsError}</p>}
                <button className="my-settings-danger-action" type="submit" disabled={!password || settingsBusy}>탈퇴하기</button>
              </form>
            )}

            {settingsPage === "privacy" && (
              <section className="my-settings-detail" aria-label="계정 공개 범위 설정">
                <div className="my-settings-detail-heading"><span><SettingsItemIcon name="lock" /></span><h3>계정 공개 범위</h3><p>프로필과 게시물을 다른 사용자에게 공개할지 선택해 주세요.</p></div>
                <div className="my-settings-toggle-row"><div><strong>{accountPublic ? "공개 계정" : "비공개 계정"}</strong><small>{accountPublic ? "누구나 내 프로필과 게시물을 볼 수 있어요." : "승인된 사용자만 내 콘텐츠를 볼 수 있어요."}</small></div><button className="my-settings-switch" type="button" role="switch" aria-label="계정 공개" aria-checked={accountPublic} onClick={() => setAccountPublic((value) => !value)}><span /></button></div>
              </section>
            )}

            {settingsPage === "notifications" && (
              <section className="my-settings-detail" aria-label="알림 설정 화면">
                <div className="my-settings-detail-heading"><span><SettingsItemIcon name="bell" /></span><h3>알림 설정</h3><p>AICE Kiln에서 보내는 앱 알림을 관리해요.</p></div>
                <div className="my-settings-toggle-row"><div><strong>앱 알림</strong><small>{appNotifications ? "새 소식과 활동 알림을 받아요." : "앱 알림을 받지 않아요."}</small></div><button className="my-settings-switch" type="button" role="switch" aria-label="앱 알림" aria-checked={appNotifications} onClick={() => setAppNotifications((value) => !value)}><span /></button></div>
              </section>
            )}
              </div>
            )}

            {settingsDialog && (
              <div className="my-confirm-layer">
                <section className="my-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="my-confirm-title">
                  <h3 id="my-confirm-title">{settingsDialog === "logout-confirm" ? "로그아웃하시겠습니까?" : settingsDialog === "withdraw-confirm" ? "탈퇴하시겠습니까?" : settingsDialog === "logout-success" ? "로그아웃 했습니다" : "탈퇴되었습니다."}</h3>
                  {(settingsDialog === "logout-confirm" || settingsDialog === "withdraw-confirm") ? (
                    <div className="my-confirm-actions">
                      <button type="button" disabled={settingsBusy} onClick={() => setSettingsDialog(null)}>아니오</button>
                      <button className={settingsDialog === "withdraw-confirm" ? "danger" : "primary"} type="button" disabled={settingsBusy} onClick={() => void (settingsDialog === "logout-confirm" ? confirmLogout() : confirmWithdrawal())}>{settingsBusy ? "처리 중…" : "예"}</button>
                    </div>
                  ) : <button className="my-confirm-done" type="button" onClick={onReturnToLogin}>확인</button>}
                </section>
              </div>
            )}
          </aside>
        </div>
      )}

      <div className="my-profile-summary">
        <div className={`my-avatar avatar-tone-${avatarTone}`} aria-label={`${displayName} 프로필 이미지`} style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined} />
        <div className="my-identity">
          <strong className="my-display-name">{displayName}</strong>
          {isMine && <button className="my-edit-button" type="button" onClick={openProfileEditor}>프로필 편집</button>}
          {!isMine && <div className="my-profile-actions">
            <button className="my-follow-button" type="button" aria-pressed={isFollowing} onClick={onToggleFollow}>{isFollowing ? "팔로잉" : "팔로우"}</button>
            <button className="my-message-button" type="button" aria-label="메시지" onClick={onMessage}><ChatIcon /></button>
          </div>}
          <dl className="my-stats" aria-label="프로필 통계">
            <div><dt>게시물</dt><dd>{suppliedPosts.length}</dd></div>
            <div><dt><button type="button" onClick={() => onOpenConnections?.("followers")}>팔로워</button></dt><dd>{stats.followers}</dd></div>
            <div><dt><button type="button" onClick={() => onOpenConnections?.("following")}>팔로잉</button></dt><dd>{stats.following}</dd></div>
          </dl>
        </div>
        {bio && <div className="my-bio-block">
          <p className={`my-bio${bioExpanded ? " is-expanded" : ""}`} ref={bioRef}>{bio}</p>
          {(bioTruncated || bioExpanded) && <button className="my-bio-more" type="button" aria-expanded={bioExpanded} onClick={() => setBioExpanded((value) => !value)}>{bioExpanded ? "접기" : "더 보기"}</button>}
        </div>}
      </div>

      <div className="my-layout-tabs" role="tablist" aria-label="게시물 보기 방식">
        <button type="button" role="tab" aria-selected={layout === "sale"} onClick={() => setLayout("sale")}><SaleIcon />판매글</button>
        <button type="button" role="tab" aria-selected={layout === "work"} onClick={() => setLayout("work")}><WorkIcon />작업물</button>
      </div>

      <div className="my-posts-viewport" ref={postsViewport} style={postsHeight === undefined ? undefined : { height: postsHeight }} aria-label="내 게시물" onPointerDown={startLayoutSwipe} onPointerMove={moveLayoutSwipe} onPointerUp={finishLayoutSwipe} onPointerCancel={() => { layoutSwipe.current.active = false; setDragging(false); setDragX(0); }} onClickCapture={(event) => { if (suppressPostClick.current) { event.stopPropagation(); event.preventDefault(); suppressPostClick.current = false; } }}>
        <div className={`my-posts-track${dragging ? " is-dragging" : ""}`} style={{ transform: `translate3d(calc(${layout === "work" ? "-50%" : "0%"} + ${dragX}px), 0, 0)` }}>
        {(["sale", "work"] as const).map((panelLayout) => <div className={`my-posts ${panelLayout}`} key={panelLayout} ref={panelLayout === "sale" ? salePanel : workPanel} aria-hidden={layout !== panelLayout} inert={layout !== panelLayout}>
        {(panelLayout === "sale" ? salePosts : workPosts).map((post, index) => (
          <article className="my-post" key={post.id}>
            <button className="my-post-open" type="button" aria-label={`${post.label} 게시물 보기`} onClick={() => onOpenPost?.(post.id)}>
              {post.image
                ? <img className={`my-post-placeholder crop-${post.crop ?? index + 1}`} src={post.image} alt={post.label} />
                : <div className={`my-post-placeholder tone-${index + 1}`} role="img" aria-label={post.label} />}
              {panelLayout === "sale"
                ? <span className="my-sale-copy"><strong>{post.glazeName || post.label}</strong><small>{post.price == null ? "가격 문의" : `${post.price.toLocaleString("ko-KR")}원`}</small></span>
                : <span className="my-post-copy"><strong>{post.label}</strong><small>{username}</small></span>}
            </button>
          </article>
        ))}
        {(panelLayout === "sale" ? salePosts : workPosts).length === 0 && (
          <div className="my-posts-empty" role="status">
            <strong>{panelLayout === "sale" ? "아직 판매글이 없습니다." : "아직 작업 기록이 없습니다."}</strong>
            <p>{panelLayout === "sale" ? "판매글을 등록하면 이곳에 표시됩니다." : "첫 유약 작업을 기록하면 이곳에 표시됩니다."}</p>
          </div>
        )}
        </div>)}
        </div>
      </div>

      {isMine && profileEditorOpen && (
        <div className="profile-editor-layer">
          <section className="profile-editor-modal" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <header><h2 id="profile-editor-title">프로필 편집</h2><button type="button" aria-label="프로필 편집 닫기" onClick={() => setProfileEditorOpen(false)}>×</button></header>
            <div className={`profile-editor-avatar avatar-tone-${avatarTone}`} style={profileAvatar ? { backgroundImage: `url(${profileAvatar})` } : undefined} aria-label="프로필 사진 미리보기" />
            <label className="profile-photo-picker">프로필 사진 변경<input type="file" accept="image/*" onChange={(event) => void chooseProfileImage(event.target.files?.[0])} /></label>
            <label className="profile-nickname-field"><span>닉네임</span><input value={profileNickname} maxLength={20} autoComplete="nickname" onChange={(event) => setProfileNickname(event.target.value)} /></label>
            <small className="profile-nickname-help">영문자, 한글, 숫자만 사용할 수 있습니다.</small>
            <label className="profile-bio-field"><span>자기소개</span><textarea value={profileBio} maxLength={150} rows={3} onChange={(event) => setProfileBio(event.target.value)} placeholder="나의 작업과 관심사를 소개해 주세요" /></label>
            {profileError && <p className="profile-editor-error" role="alert">{profileError}</p>}
            <button className="profile-editor-save" type="button" disabled={profileBusy} onClick={() => void saveProfile()}>{profileBusy ? "저장 중…" : "저장"}</button>
          </section>
        </div>
      )}
    </section>
  );
}
