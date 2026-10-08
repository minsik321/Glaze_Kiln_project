import { AiceRecordsPanel } from "./AiceRecordsPanel";
import type { AiceRunRecord } from "../lib/api";
import "./records.css";

type Props = {
  token: string;
  onBack: () => void;
  onSelect: (record: AiceRunRecord) => void;
};

//: "작업 게시하기"의 첫 화면 — 게시할 내 작업기록을 하나 고르면 그 기록으로 채운
//: 게시 폼(CreatePostScreen)으로 넘어간다.
export function RecordPickerScreen({ token, onBack, onSelect }: Props) {
  return (
    <section className="record-picker" aria-label="게시할 작업기록 선택 화면">
      <header className="create-post-header">
        <button type="button" aria-label="홈으로 돌아가기" onClick={onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>
        <h1>게시할 작업기록 선택</h1>
        <span aria-hidden="true" />
      </header>
      <div className="record-picker-body">
        <p className="record-picker-hint">게시할 내 완료 기록을 선택하면 레시피와 소성 정보가 자동으로 채워져요.</p>
        <AiceRecordsPanel token={token} onlyOrigin="mine" onOpen={onSelect} />
      </div>
    </section>
  );
}
