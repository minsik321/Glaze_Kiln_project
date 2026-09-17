"""LLM 프런트도어 — 프롬프트·검증 (LLM 프런트도어 TODO Phase 2).

**이 패키지는 순수 stdlib다** — `src/kiln` 나머지 모듈과 같은 경계 규칙을
따른다(과거 Pyodide로 브라우저에 그대로 배송하던 경계였다; 그 브라우저
배송 경로는 2026-09 제거되었고 현재는 backend/app이 이 패키지를 그대로
가져다 쓴다). aimlapi.com을 실제로 호출하는 httpx 기반 클라이언트
(`AimlapiClient`)는 이 경계 밖(백엔드 전용, `backend/app/aimlapi.py`)에
산다 — `src/kiln/webapp/CLAUDE.md`의 "v9 각주"가 말하는 "이 경계 밖에서
별도 모듈로 모델을 호출"이 실제로는 브라우저/백엔드 경계와도 일치해야
했다.

``kiln.domain``·``kiln.chem`` 과 달리 이 패키지의 출력은 결정론적이지
않다(LLM 원문에서 나온다). 호출부는 이 패키지가 내놓는 값을 절대
``source_type="observed"`` 로 격상하지 않는다(00절).
"""

from kiln.llm.recipe_candidates import RecipeCandidateValidationError, build_recipe_candidates, parse_target
from kiln.llm.recipe_prompt import build_messages, build_target_messages

__all__ = [
    "RecipeCandidateValidationError",
    "build_recipe_candidates",
    "parse_target",
    "build_messages",
    "build_target_messages",
]
