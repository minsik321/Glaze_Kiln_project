import type { AiceRun } from "../aice/contract";
import { useAuth } from "../auth/AuthProvider";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import "./records.css";

type Props = { onRestore?: (run: AiceRun) => void };

export function RecordsPanel({ onRestore }: Props) {
  const { session } = useAuth();

  if (!session) {
    return (
      <section className="records-panel records-signed-out" aria-label="생성 기록">
        <p>로그인하면 이전에 생성한 유약 후보를 확인할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="records-panel" aria-label="생성 기록">
      <AiceRecordsPanel token={session.access_token} onRestore={onRestore} />
    </section>
  );
}
