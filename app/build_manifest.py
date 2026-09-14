"""`app/kiln-manifest.json` 을 다시 만든다.

브라우저의 Pyodide는 `src/kiln` 의 `.py` 파일을 하나씩 받아 가상 파일
시스템에 쓴 뒤 `import kiln` 한다. 그러려면 **어떤 파일이 있는지**를 미리
알아야 하는데, 정적 호스팅에는 디렉터리 목록 API가 없다. 그래서 파일 목록을
빌드 시점에 뽑아 둔다.

패키지를 zip으로 묶어 `unpackArchive` 하는 방법도 있지만 쓰지 않는다 —
저장소에 바이너리가 들어가고, 소스를 고친 뒤 다시 묶는 것을 잊으면 앱이
**조용히 옛 코드를 돌린다.** 매니페스트는 텍스트라 diff에 드러나고,
`tests/webapp/test_manifest.py` 가 실제 파일 목록과 어긋나면 실패한다.

사용법::

    python app/build_manifest.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "src" / "kiln"
MANIFEST = Path(__file__).resolve().parent / "kiln-manifest.json"


def module_files() -> list[str]:
    """`src/` 기준 상대 경로로 된 `kiln` 패키지의 `.py` 파일 목록 (정렬)."""
    src = ROOT / "src"
    return sorted(
        p.relative_to(src).as_posix()
        for p in PACKAGE.rglob("*.py")
        if "__pycache__" not in p.parts
    )


def build() -> dict:
    return {
        "note": (
            "app/build_manifest.py 가 생성한다. 직접 고치지 말 것 — "
            "tests/webapp/test_manifest.py 가 실제 파일 목록과 대조한다."
        ),
        "root": "../src",
        "files": module_files(),
    }


def main() -> None:
    manifest = build()
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    # 출력은 ASCII로만 낸다 — 한국어 Windows 콘솔 기본 코드페이지(cp949)에서
    # 대시·한글이 UnicodeEncodeError를 내면 빌드가 실패한 것처럼 보인다.
    path = MANIFEST.relative_to(ROOT).as_posix()
    print(f"wrote {path}: {len(manifest['files'])} modules")


if __name__ == "__main__":
    main()
