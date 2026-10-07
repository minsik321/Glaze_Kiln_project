import { useEffect, useState } from "react";
import type { AiceRun } from "../aice/contract";
import { aiceRunsApi, type AiceRunRecord, type NextTrialSuggestion } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import { WorkRecordDetail } from "./WorkRecordDetail";
import type { WorkRecordOrigin } from "./workRecords";
import "./records.css";

type Props = {
  onStart?: (run: AiceRun, origin: WorkRecordOrigin, recipeRefId: string | null) => void;
  onDetailOpenChange?: (open: boolean) => void;
};

export function RecordsPanel({ onStart, onDetailOpenChange }: Props) {
  const { session } = useAuth();
  const [selected, setSelected] = useState<{ record: AiceRunRecord; origin: WorkRecordOrigin } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [nextTrial, setNextTrial] = useState<NextTrialSuggestion | null>(null);

  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange]);

  //: 내 기록 상세를 열면 그 기록의 "다음 시도 제안"을 불러온다. 실패해도 상세 화면은 그대로 둔다.
  useEffect(() => {
    setNextTrial(null);
    if (!session || !selected || selected.origin !== "mine") return;
    let cancelled = false;
    aiceRunsApi.nextTrial(session.access_token, selected.record.id)
      .then((value) => { if (!cancelled) setNextTrial(value); })
      .catch(() => { if (!cancelled) setNextTrial(null); });
    return () => { cancelled = true; };
  }, [session, selected]);

  const openDetail = (record: AiceRunRecord, origin: WorkRecordOrigin) => {
    setSelected({ record, origin });
    onDetailOpenChange?.(true);
  };

  const closeDetail = () => {
    setSelected(null);
    setConfirmDelete(false);
    setDeleteError("");
    onDetailOpenChange?.(false);
  };

  const deleteSelected = async () => {
    if (!session || !selected || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await aiceRunsApi.remove(session.access_token, selected.record.id);
      closeDetail();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "작업 기록을 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  if (!session) {
    return (
      <section className="records-panel records-signed-out" aria-label="작업 기록">
        <p>로그인하면 완료한 작업과 가져온 레시피를 확인할 수 있습니다.</p>
      </section>
    );
  }

  if (selected) {
    return (
      <section className="records-panel record-detail-panel" aria-label="작업 기록 상세">
        <header className="record-detail-header">
          <button type="button" className="record-detail-back" onClick={closeDetail} aria-label="작업 기록 목록으로 돌아가기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <button type="button" className="record-detail-delete" onClick={() => { setDeleteError(""); setConfirmDelete(true); }}>작업기록 삭제</button>
        </header>
        <WorkRecordDetail run={selected.record.run} origin={selected.origin} nextTrial={nextTrial} />
        <button type="button" className="record-detail-start" onClick={() => {
          onDetailOpenChange?.(false);
          onStart?.(selected.record.run, selected.origin, selected.record.recipe_ref_id ?? null);
        }}>이 기록으로 작업 시작</button>
        {confirmDelete && <div className="record-delete-backdrop">
          <div className="record-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="record-delete-title" aria-describedby="record-delete-description">
            <h3 id="record-delete-title">작업기록을 삭제할까요?</h3>
            <p id="record-delete-description">“{selected.record.title}” 기록이 삭제됩니다. 삭제한 기록은 복구할 수 없습니다.</p>
            {deleteError && <p className="record-delete-error" role="alert">{deleteError}</p>}
            <div className="record-delete-actions">
              <button type="button" autoFocus disabled={deleting} onClick={() => setConfirmDelete(false)}>취소</button>
              <button type="button" disabled={deleting} onClick={() => void deleteSelected()}>{deleting ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        </div>}
      </section>
    );
  }

  return (
    <section className="records-panel" aria-label="작업 기록">
      <AiceRecordsPanel token={session.access_token} onOpen={openDetail} />
    </section>
  );
}
