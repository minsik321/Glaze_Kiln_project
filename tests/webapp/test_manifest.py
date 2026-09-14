"""`app/kiln-manifest.json` 이 실제 패키지와 어긋나지 않는지.

앱은 이 목록에 적힌 파일만 브라우저로 가져간다. 목록이 낡으면 **앱이
조용히 옛 코드를 돌리거나 ImportError로 죽는다.** 둘 다 실행해 보기
전에는 드러나지 않으므로 여기서 잡는다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app"
MANIFEST = APP / "kiln-manifest.json"

sys.path.insert(0, str(APP))
from build_manifest import module_files  # noqa: E402


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_manifest_exists():
    assert MANIFEST.exists(), "app/build_manifest.py 를 실행해 생성하라"


def test_manifest_matches_the_package(manifest):
    """소스에 모듈을 추가하고 매니페스트를 다시 만들지 않으면 여기서 실패한다."""
    assert manifest["files"] == module_files(), (
        "app/kiln-manifest.json 이 src/kiln 과 어긋난다 — "
        "`python app/build_manifest.py` 를 실행하라"
    )


def test_every_listed_file_exists(manifest):
    base = (APP / manifest["root"]).resolve()
    missing = [f for f in manifest["files"] if not (base / f).is_file()]
    assert not missing, f"매니페스트에 있는데 실제로 없는 파일: {missing}"


def test_manifest_covers_every_module(manifest):
    """앱 경계(`kiln.webapp`)를 포함해 패키지 전체가 실려야 한다."""
    files = set(manifest["files"])
    assert "kiln/__init__.py" in files
    assert "kiln/webapp/__init__.py" in files
    assert "kiln/webapp/bridge.py" in files
    for package in (
        "constants.py", "domain", "chem", "batch", "thickness", "risk",
        "firing", "search", "calibration", "exchange",
    ):
        assert any(f.startswith(f"kiln/{package}") for f in files), package


def test_no_bytecode_or_caches_are_shipped(manifest):
    assert all(f.endswith(".py") for f in manifest["files"])
    assert not any("__pycache__" in f for f in manifest["files"])


def test_manifest_is_pure_stdlib_on_the_browser_side(manifest):
    """Pyodide에는 pytest가 없다 — 앱이 가져가는 코드에 서드파티 import가 없어야 한다.

    저장소 규칙(순수 stdlib)이 실제로 지켜지는지를 배포 경로에서 다시 확인한다.
    여기서 걸리면 브라우저에서만 터지는 ImportError가 된다.
    """
    base = (APP / manifest["root"]).resolve()
    third_party = []
    allowed_roots = {"kiln", "__future__"}
    stdlib = set(sys.stdlib_module_names)

    for rel in manifest["files"]:
        for lineno, line in enumerate(
            (base / rel).read_text(encoding="utf-8").splitlines(), start=1
        ):
            stripped = line.strip()
            if stripped.startswith("import "):
                root = stripped[len("import "):].split()[0].split(".")[0]
            elif stripped.startswith("from "):
                root = stripped[len("from "):].split()[0].split(".")[0]
            else:
                continue
            if root in allowed_roots or root in stdlib:
                continue
            third_party.append(f"{rel}:{lineno} {stripped}")

    assert not third_party, f"서드파티 import: {third_party}"
