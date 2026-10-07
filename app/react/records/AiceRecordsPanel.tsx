import { useCallback, useEffect, useMemo, useState } from "react";
import { aiceRunsApi, type AiceRunRecord } from "../lib/api";
import { isVisibleWorkRecord, workRecordOrigin, type WorkRecordOrigin } from "./workRecords";

const PAGE_SIZE = 20;
const MAX_PAGES = 50;
type RecordFilter = "all" | WorkRecordOrigin;
type RecordSort = "newest" | "oldest" | "title-asc" | "title-desc";

type Props = {
  token: string;
  onOpen?: (record: AiceRunRecord, origin: WorkRecordOrigin) => void;
  //: 주어지면 그 출처의 기록만 보여 주고 출처 필터는 숨긴다(작업 게시용 선택 화면).
  onlyOrigin?: WorkRecordOrigin;
};

export function AiceRecordsPanel({ token, onOpen, onlyOrigin }: Props) {
  const [items, setItems] = useState<AiceRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [sort, setSort] = useState<RecordSort>("newest");

  const displayedItems = useMemo(() => {
    const filtered = filter === "all"
      ? items
      : items.filter((record) => workRecordOrigin(record.run) === filter);

    return [...filtered].sort((left, right) => {
      if (sort === "title-asc") return left.title.localeCompare(right.title, "ko");
      if (sort === "title-desc") return right.title.localeCompare(left.title, "ko");
      const leftTime = Date.parse(left.created_at) || 0;
      const rightTime = Date.parse(right.created_at) || 0;
      return sort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [filter, items, sort]);

  //: 첫 페이지가 오면 바로 목록을 보여 주고, 나머지 페이지는 뒤에서 이어 붙인다.
  //: `isActive`가 false가 되면(언마운트·재로딩) 이전 호출의 결과는 버린다.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setItems([]);

    const keep = (records: AiceRunRecord[]) => records.filter((record) => isVisibleWorkRecord(record.run) && (!onlyOrigin || workRecordOrigin(record.run) === onlyOrigin));

    try {
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const page = await aiceRunsApi.listMine(token, pageNumber * PAGE_SIZE);
        if (!isActive()) return;
        setItems((current) => [...current, ...keep(page.items)]);

        if (page.items.length < PAGE_SIZE) break;
        if (pageNumber === 0) {
          setLoading(false);
          setLoadingMore(true);
        }
      }
    } catch (failure) {
      if (!isActive()) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "작업 기록을 불러오지 못했습니다.",
      );
    }
    if (!isActive()) return;
    setLoading(false);
    setLoadingMore(false);
  }, [token, onlyOrigin]);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [load]);

  return (
    <div className="generation-records">
      <h2 className="records-visually-hidden">작업 기록 목록</h2>

      {!loading && !error && items.length > 0 && (
        <div className="record-list-tools">
          {!onlyOrigin && <div className="record-filter" role="group" aria-label="작업 기록 필터">
            {([
              ["all", "전체"],
              ["mine", "내 작업"],
              ["imported", "불러온 작업"],
            ] as const).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >{label}</button>
            ))}
          </div>}
          <label className="record-sort">
            <span>정렬</span>
            <select aria-label="작업 기록 정렬" value={sort} onChange={(event) => setSort(event.target.value as RecordSort)}>
              <option value="newest">최신순</option>
              <option value="oldest">오래된순</option>
              <option value="title-asc">오름차순</option>
              <option value="title-desc">내림차순</option>
            </select>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
          </label>
        </div>
      )}

      {error && (
        <div className="record-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}

      {loading || (loadingMore && displayedItems.length === 0) ? (
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
      ) : !error && displayedItems.length === 0 ? (
        <div className="record-empty record-filter-empty">
          <span aria-hidden="true">⌕</span>
          <p>선택한 조건에 맞는 작업이 없습니다.</p>
        </div>
      ) : !error ? (
        <ul className="generation-record-list" aria-label="작업 기록">
          {displayedItems.map((record) => {
            const origin = workRecordOrigin(record.run);
            const peak = Math.max(...record.run.curves.baseline.points.map((point) => point.temperature_c));
            return <li key={record.id}>
              <button
                type="button"
                className="generation-record-link"
                aria-label={`${record.title} 작업기록 열기`}
                onClick={() => onOpen?.(record, origin)}
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
