"""One-time copy of existing personal vectors from local Qdrant to Supabase.

Run after the pgvector migrations. The runtime never calls this script.
Only vectors whose original AICE run still exists are copied.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = uuid.UUID("6f6e3c2e-6b1f-4b0a-9f2e-2a6f7b8c9d10")


def _query_rows(sql: str) -> list[dict]:
    result = subprocess.run(
        ["npx.cmd", "supabase", "db", "query", "--linked", sql],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    output = result.stdout
    data, _ = json.JSONDecoder().raw_decode(output[output.index("{"):])
    return data["rows"]


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qdrant-url", default="http://127.0.0.1:6333")
    parser.add_argument("--collection", default="aice_knowledge")
    args = parser.parse_args()

    runs = _query_rows("select id::text, user_id::text from public.aice_runs")
    by_point_id = {
        str(uuid.uuid5(NAMESPACE, f"run-{run['id']}")): run
        for run in runs
    }
    response = httpx.post(
        f"{args.qdrant_url}/collections/{args.collection}/points/scroll",
        json={"limit": 1000, "with_payload": True, "with_vector": True},
        timeout=20,
    )
    response.raise_for_status()
    result = response.json()["result"]
    if result.get("next_page_offset") is not None:
        raise RuntimeError("Qdrant 문서가 1000건을 넘어 일부만 읽었습니다.")

    values = []
    unmatched = 0
    for point in result["points"]:
        payload = point.get("payload") or {}
        if payload.get("source_type") != "personal_recipe":
            continue
        run = by_point_id.get(str(point["id"]))
        if not run or str(payload.get("user_id")) != run["user_id"]:
            unmatched += 1
            continue
        vector = point.get("vector")
        if not isinstance(vector, list) or len(vector) != 384:
            raise RuntimeError("기존 개인 기록 벡터의 차원이 올바르지 않습니다.")
        metadata = {key: value for key, value in payload.items() if key not in {"text", "source_type", "user_id"}}
        embedding = "[" + ",".join(format(float(value), ".9g") for value in vector) + "]"
        values.append("(" + ", ".join((
            _quote(f"run-{run['id']}"), _quote(run["user_id"]), _quote(run["id"]),
            _quote("personal_recipe"), _quote(str(payload.get("text") or "")),
            _quote(json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))) + "::jsonb",
            _quote(embedding) + "::extensions.vector",
        )) + ")")

    if values:
        sql = (
            "insert into public.aice_vector_documents "
            "(doc_id, user_id, run_id, source_type, content, metadata, embedding) values\n"
            + ",\n".join(values) + "\n"
            "on conflict (doc_id) do update set content = excluded.content, "
            "metadata = excluded.metadata, embedding = excluded.embedding, updated_at = now();\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", encoding="utf-8", delete=False) as file:
            file.write(sql)
            path = Path(file.name)
        try:
            subprocess.run(
                ["npx.cmd", "supabase", "db", "query", "--linked", "--file", str(path)],
                cwd=ROOT, check=True, capture_output=True, text=True,
            )
        finally:
            path.unlink(missing_ok=True)
    print(f"이전한 개인 벡터: {len(values)}건, 원본 기록이 없어 건너뛴 벡터: {unmatched}건")


if __name__ == "__main__":
    main()
