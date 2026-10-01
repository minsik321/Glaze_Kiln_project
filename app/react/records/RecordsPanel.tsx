import type { AiceRun } from "../aice/contract";
import { useAuth } from "../auth/AuthProvider";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import type { WorkRecordOrigin } from "./workRecords";
import "./records.css";

type Props = { onRestore?: (run: AiceRun, origin: WorkRecordOrigin) => void };

export function RecordsPanel({ onRestore }: Props) {
  const { session } = useAuth();

  if (!session) {
    return (
      <section className="records-panel records-signed-out" aria-label="작업 기록">
        <p>로그인하면 완료한 작업과 가져온 레시피를 확인할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="records-panel" aria-label="작업 기록">
      <AiceRecordsPanel token={session.access_token} onRestore={onRestore} />
    </section>
  );
}
