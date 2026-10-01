import { useCallback, useEffect, useState } from "react";
import type { AiceRun } from "../aice/contract";
import { aiceRunsApi, type AiceRunRecord } from "../lib/api";
import { isVisibleWorkRecord, workRecordOrigin, type WorkRecordOrigin } from "./workRecords";

const PAGE_SIZE = 20;
const MAX_PAGES = 50;

type Props = {
  token: string;
  onRestore?: (run: AiceRun, origin: WorkRecordOrigin) => void;
};

export function AiceRecordsPanel({ token, onRestore }: Props) {
  const [items, setItems] = useState<AiceRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const records: AiceRunRecord[] = [];

      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const page = await aiceRunsApi.listMine(token, pageNumber * PAGE_SIZE);
        records.push(...page.items);

        if (page.items.length < PAGE_SIZE) break;
      }

      setItems(records.filter((record) => isVisibleWorkRecord(record.run)));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "작업 기록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="generation-records">
      <h2 className="records-visually-hidden">작업 기록 목록</h2>

      {error && (
        <div className="record-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}

      {loading ? (
        <div
          className="record-loading"
          role="status"
          aria-label="작업 기록을 불러오는 중"
        >
          <span />
          <span />
          <span />
        </div>
      ) : !error && items.length === 0 ? (
        <div className="record-empty">
          <span aria-hidden="true">＋</span>
          <p>아직 완료하거나 가져온 작업이 없습니다.</p>
        </div>
      ) : !error ? (
        <ul className="generation-record-list" aria-label="작업 기록">
          {items.map((record) => {
            const origin = workRecordOrigin(record.run);
            const peak = Math.max(...record.run.curves.baseline.points.map((point) => point.temperature_c));
            return <li key={record.id}>
              <button
                type="button"
                className="generation-record-link"
                aria-label={`${record.title} 작업기록 열기`}
                onClick={() => onRestore?.(record.run, origin)}
              >
                <span className="work-record-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2M7 12h10M7 16h7" /></svg></span>
                <span className="work-record-copy">
                  <span className={`work-record-origin ${origin}`}>{origin === "imported" ? "다른 사람의 작업" : "내 완료 기록"}</span>
                  <strong>{record.title}</strong>
                  <small>{record.run.recipe.name} · 최고 {peak}℃</small>
                </span>
                <svg
                  className="generation-record-chevron"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          })}
        </ul>
      ) : null}
    </div>
  );
}
