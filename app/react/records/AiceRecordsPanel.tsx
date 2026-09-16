import { useCallback, useEffect, useState, type FormEvent } from "react";
import { assertAiceRun, type AiceRun } from "../aice/contract";
import { canPublish, transformSharedCurve, type ShareConsent } from "../aice/feedback";
import { aiceRunsApi, type AiceRunRecord } from "../lib/api";

const EMPTY_CONSENT: ShareConsent = { photoRights: false, piiReviewed: false, locationRemoved: false, withdrawalUnderstood: false };

export function AiceRecordsPanel({ token, getSnapshot, onRestore }: { token: string; getSnapshot?: () => Promise<Record<string, unknown>>; onRestore?: (run: AiceRun) => void }) {
  const [view, setView] = useState<"mine" | "public">("mine");
  const [items, setItems] = useState<AiceRunRecord[]>([]);
  const [selected, setSelected] = useState<AiceRunRecord | null>(null);
  const [offset, setOffset] = useState(0);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState<ShareConsent>(EMPTY_CONSENT);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [transformed, setTransformed] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const page = view === "mine" ? await aiceRunsApi.listMine(token, offset) : await aiceRunsApi.listPublic(token, offset);
      setItems(page.items); setSelected((current) => page.items.find((item) => item.id === current?.id) ?? null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "AICE 기록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [offset, token, view]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault(); if (!getSnapshot || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const snapshot = await getSnapshot(); assertAiceRun(snapshot);
      const record = await aiceRunsApi.create(token, { title: title.trim(), run: snapshot, is_public: false });
      setItems((current) => [record, ...current.filter((item) => item.id !== record.id)]); setSelected(record); setTitle(""); setMessage("AiceRun을 비공개로 저장했습니다.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "AiceRun 저장에 실패했습니다."); }
    finally { setBusy(false); }
  }

  async function publish(record: AiceRunRecord) {
    if (!canPublish(consent) || busy) return; setBusy(true); setError("");
    try {
      const updated = await aiceRunsApi.publish(token, record.id, { photo_rights_confirmed: consent.photoRights, pii_reviewed: consent.piiReviewed, location_removed: consent.locationRemoved, withdrawal_understood: consent.withdrawalUnderstood });
      replace(updated); setConsent(EMPTY_CONSENT); setMessage("동의가 확인된 AiceRun을 공개했습니다.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "공개하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function withdraw(record: AiceRunRecord) {
    if (busy) return; setBusy(true); setError("");
    try { const updated = await aiceRunsApi.withdraw(token, record.id); replace(updated); setMessage("공유를 철회했습니다. 공개 조회 조건이 즉시 해제됩니다."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "공유 철회에 실패했습니다."); }
    finally { setBusy(false); }
  }

  async function remove(record: AiceRunRecord) {
    if (busy || !window.confirm(`“${record.title}” AiceRun을 삭제할까요?`)) return; setBusy(true); setError("");
    try { await aiceRunsApi.remove(token, record.id); setItems((current) => current.filter((item) => item.id !== record.id)); setSelected(null); setMessage("AiceRun을 삭제했습니다."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  }

  function replace(updated: AiceRunRecord) { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); }
  function switchView(next: "mine" | "public") { setView(next); setOffset(0); setSelected(null); setTransformed(""); }
  function transform(record: AiceRunRecord) {
    const candidate = transformSharedCurve(record.run.curves.baseline, { sourceKilnProfile: record.run.loading.kiln_profile_id, targetKilnProfile: "my-virtual-kiln", targetLoad: "medium" });
    setTransformed(`${candidate.id} · ${candidate.reason}`);
  }

  return <section className="aice-records" aria-labelledby="aice-records-title">
    <h3 id="aice-records-title">AiceRun v2 기록</h3>
    <form className="record-save" onSubmit={save}><label>기록 제목<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><button type="submit" disabled={!getSnapshot || busy}>{busy ? "처리 중…" : "현재 AiceRun 비공개 저장"}</button></form>
    <div className="record-tabs" role="tablist" aria-label="AiceRun 범위"><button type="button" role="tab" aria-selected={view === "mine"} onClick={() => switchView("mine")}>내 AiceRun</button><button type="button" role="tab" aria-selected={view === "public"} onClick={() => switchView("public")}>동의된 공개 AiceRun</button></div>
    {error && <p role="alert" className="record-error">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">AiceRun을 불러오는 중…</p> : <ul className="record-list">{items.map((record) => <li key={record.id}><button type="button" className="record-title" onClick={() => setSelected(record)}>{record.title}</button><span>v{record.schema_version} · {record.run.versions.rule_model}</span><span className="badge">{record.is_public ? "동의 공개" : "비공개"}</span></li>)}</ul>}
    <div className="record-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 20))}>이전 20개</button><span>{offset + 1}–{offset + items.length}</span><button type="button" disabled={items.length < 20 || loading} onClick={() => setOffset(offset + 20)}>다음 20개</button></div>
    {selected && <article className="aice-record-detail"><h4>{selected.title}</h4><dl><div><dt>목표</dt><dd>{selected.goal_gloss} · {selected.goal_transparency}</dd></div><div><dt>레시피/기물</dt><dd>{selected.recipe_id} · {selected.ware_preset}</dd></div><div><dt>출처</dt><dd>{selected.run.sources.map((source) => source.source_type).join(", ")}</dd></div><div><dt>버전</dt><dd>{selected.run.versions.data} / {selected.run.versions.rule_model} / {selected.run.versions.simulator}</dd></div></dl>{view === "mine" ? <><div className="record-actions"><button type="button" onClick={() => onRestore?.(selected.run)}>이 실행 복원</button>{selected.is_public ? <button type="button" onClick={() => void withdraw(selected)} disabled={busy}>공유 철회</button> : <button type="button" onClick={() => void publish(selected)} disabled={!canPublish(consent) || busy}>동의 확인 후 공개</button>}<button type="button" onClick={() => void remove(selected)} disabled={busy}>삭제</button></div>{!selected.is_public && <fieldset className="publication-consent"><legend>공개 전 필수 확인</legend>{[["photoRights", "사진 권리를 보유하거나 사진이 없음"], ["piiReviewed", "개인정보를 확인함"], ["locationRemoved", "위치정보를 제거함"], ["withdrawalUnderstood", "철회 시 공개 조회가 차단됨을 이해함"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={consent[key as keyof ShareConsent]} onChange={(event) => setConsent((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</fieldset>}</> : <><button type="button" onClick={() => transform(selected)}>내 가마 조건으로 변환 후 재시뮬레이션</button>{transformed && <p role="status" className="transform-result">{transformed}</p>}</>}</article>}
  </section>;
}
