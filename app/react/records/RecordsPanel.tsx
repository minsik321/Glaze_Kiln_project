import { useEffect, useState } from "react";
import type { AiceRun } from "../aice/contract";
import type { AiceRunRecord } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import { WorkRecordDetail } from "./WorkRecordDetail";
import type { WorkRecordOrigin } from "./workRecords";
import "./records.css";

type Props = {
  onStart?: (run: AiceRun, origin: WorkRecordOrigin) => void;
  onDetailOpenChange?: (open: boolean) => void;
};

export function RecordsPanel({ onStart, onDetailOpenChange }: Props) {
  const { session } = useAuth();
  const [selected, setSelected] = useState<{ record: AiceRunRecord; origin: WorkRecordOrigin } | null>(null);

  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange]);

  const openDetail = (record: AiceRunRecord, origin: WorkRecordOrigin) => {
    setSelected({ record, origin });
    onDetailOpenChange?.(true);
  };

  const closeDetail = () => {
    setSelected(null);
    onDetailOpenChange?.(false);
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
          <button type="button" onClick={closeDetail} aria-label="작업 기록 목록으로 돌아가기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
        </header>
        <WorkRecordDetail run={selected.record.run} origin={selected.origin} />
        <button type="button" className="record-detail-start" onClick={() => {
          onDetailOpenChange?.(false);
          onStart?.(selected.record.run, selected.origin);
        }}>이 기록으로 작업 시작</button>
      </section>
    );
  }

  return (
    <section className="records-panel" aria-label="작업 기록">
      <AiceRecordsPanel token={session.access_token} onOpen={openDetail} />
    </section>
  );
}
