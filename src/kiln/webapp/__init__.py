"""kiln.webapp — 브라우저 UI와 계산 엔진 사이의 경계.

앱은 Pyodide로 이 패키지를 **그대로** 브라우저에서 돌린다. 계산 로직을
JS로 재구현하지 않는 것이 요점이다 — 두 구현이 갈라지면 "기획서가 코드보다
위에 있다"는 전제가 깨지고, 어느 쪽이 기획서의 구현인지 말할 수 없게 된다.

:mod:`kiln.webapp.bridge` 는 계산을 하지 않고 직렬화만 한다. 지켜야 하는
것 하나: **출처를 끝까지 들고 나간다.** 화면이 숫자만 보여주고
``provenance_notes`` 를 떨어뜨리면 00절 약속이 UI에서 깨진다.
"""

from kiln.webapp.bridge import PRESET_KILNS, PRESET_RECIPES, PRESET_SHAPES, KilnApp

__all__ = ["KilnApp", "PRESET_SHAPES", "PRESET_KILNS", "PRESET_RECIPES"]
