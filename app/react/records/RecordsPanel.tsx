import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { recordsApi, type WorkRecord } from "../lib/api";
import type { AiceRun } from "../aice/contract";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import "./records.css";

type Props = { getSnapshot?: () => Promise<Record<string, unknown>>; onRestore?: (run: AiceRun) => void };

export function RecordsPanel({ getSnapshot, onRestore }: Props) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [view, setView] = useState<"mine" | "public">("mine");
  const [items, setItems] = useState<WorkRecord[]>([]);
  const [selected, setSelected] = useState<WorkRecord | null>(null);
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const page =
        view === "mine"
          ? await recordsApi.listMine(token)
          : await recordsApi.listPublic(token);
      setItems(page.items);
      setSelected(
        (current) => page.items.find((item) => item.id === current?.id) ?? null,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "기록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [token, view]);

  useEffect(() => {
    setItems([]);
    setSelected(null);
    if (token) void load();
  }, [token, view, load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token || !getSnapshot || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const record = await recordsApi.create(token, {
        title: title.trim(),
        payload: await getSnapshot(),
        is_public: isPublic,
      });
      setTitle("");
      setIsPublic(false);
      setView("mine");
      setItems((current) => [
        record,
        ...current.filter((item) => item.id !== record.id),
      ]);
      setSelected(record);
      setMessage("현재 작업을 저장했습니다.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "기록 저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePublic(record: WorkRecord) {
    if (!token || saving) return;
    setSaving(true);
    setError("");
    try {
      const updated = await recordsApi.update(token, record.id, {
        is_public: !record.is_public,
      });
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelected((current) =>
        current?.id === updated.id ? updated : current,
      );
      setMessage(
        updated.is_public
          ? "다른 로그인 사용자에게 공개했습니다."
          : "기록을 비공개로 전환했습니다.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "공개 설정을 바꾸지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function rename(record: WorkRecord) {
    if (!token || saving) return;
    const title = window.prompt("새 기록 제목", record.title)?.trim();
    if (!title || title === record.title) return;
    setSaving(true);
    setError("");
    try {
      const updated = await recordsApi.update(token, record.id, { title });
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelected((current) =>
        current?.id === updated.id ? updated : current,
      );
      setMessage("기록 제목을 수정했습니다.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "제목을 수정하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(record: WorkRecord) {
    if (
      !token ||
      saving ||
      !window.confirm(`“${record.title}” 기록을 삭제할까요?`)
    )
      return;
    setSaving(true);
    setError("");
    try {
      await recordsApi.remove(token, record.id);
      setItems((current) => current.filter((item) => item.id !== record.id));
      setSelected((current) => (current?.id === record.id ? null : current));
      setMessage("기록을 삭제했습니다.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "기록을 삭제하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!session)
    return (
      <section className="records-panel">
        <h2>작업 기록</h2>
        <p>로그인하면 현재 작업을 저장하고 공개 기록을 볼 수 있습니다.</p>
      </section>
    );

  return (
    <section className="records-panel" aria-label="작업 기록">
      <AiceRecordsPanel token={token!} getSnapshot={getSnapshot} onRestore={onRestore} />
      <div className="records-heading">
        <h2>이전 형식 기록</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          새로고침
        </button>
      </div>
      <form className="record-save" onSubmit={save}>
        <label>
          기록 제목
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="record-check">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
          다른 로그인 사용자에게 공개
        </label>
        <button type="submit" disabled={saving || !getSnapshot}>
          {saving ? "저장 중…" : "현재 작업 저장"}
        </button>
      </form>
      {!getSnapshot && (
        <p className="subtle">계산 화면을 준비한 뒤 저장할 수 있습니다.</p>
      )}
      <div className="record-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "mine"}
          onClick={() => setView("mine")}
        >
          내 기록
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "public"}
          onClick={() => setView("public")}
        >
          공개 기록
        </button>
      </div>
      {error && (
        <p role="alert" className="record-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p role="status">기록을 불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="subtle">표시할 기록이 없습니다.</p>
      ) : (
        <ul className="record-list">
          {items.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className="record-title"
                onClick={() => setSelected(record)}
              >
                {record.title}
              </button>
              <span>{new Date(record.updated_at).toLocaleString("ko-KR")}</span>
              <span className="badge">
                {record.is_public ? "공개" : "비공개"}
              </span>
              {view === "mine" && (
                <>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void rename(record)}
                  >
                    제목 수정
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void togglePublic(record)}
                  >
                    {record.is_public ? "비공개로" : "공개하기"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void remove(record)}
                  >
                    삭제
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <details open className="record-detail">
          <summary>{selected.title}</summary>
          <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
