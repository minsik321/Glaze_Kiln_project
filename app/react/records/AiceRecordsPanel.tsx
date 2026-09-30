import { useCallback, useEffect, useState } from "react";
import type { AiceRun } from "../aice/contract";
import { aiceRunsApi, type AiceRunRecord } from "../lib/api";

const PAGE_SIZE = 20;
const MAX_PAGES = 50;

type Props = {
  token: string;
  onRestore?: (run: AiceRun) => void;
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

      setItems(records.filter((record) => Boolean(record.run.intake)));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "생성 기록을 불러오지 못했습니다.",
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
      <h2 className="records-visually-hidden">후보 생성 기록 목록</h2>

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
          aria-label="생성 기록을 불러오는 중"
        >
          <span />
          <span />
          <span />
        </div>
      ) : !error && items.length === 0 ? (
        <div className="record-empty">
          <span aria-hidden="true">＋</span>
          <p>아직 생성한 유약 후보가 없습니다.</p>
        </div>
      ) : !error ? (
        <ul className="generation-record-list" aria-label="후보 생성 기록">
          {items.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className="generation-record-link"
                onClick={() => onRestore?.(record.run)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6.75 4.75h10.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H11l-4.25 3v-3a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2Z" />
                </svg>
                <span>{record.title}</span>
                <svg
                  className="generation-record-chevron"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
