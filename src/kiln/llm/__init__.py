"""LLM 프런트도어 — 프롬프트·검증 (LLM 프런트도어 TODO Phase 2).

**이 패키지는 순수 stdlib다** — `app/kiln-manifest.json`을 통해 브라우저로
그대로 배송되기 때문이다(`tests/webapp/test_manifest.py::test_manifest_is_pure_stdlib_on_the_browser_side`).
aimlapi.com을 실제로 호출하는 httpx 기반 클라이언트(`AimlapiClient`)는 이
경계 밖(백엔드 전용, `backend/app/aimlapi.py`)에 산다 — `src/kiln/webapp/CLAUDE.md`
의 "v9 각주"가 말하는 "이 경계 밖에서 별도 모듈로 모델을 호출"이 실제로는
브라우저/백엔드 경계와도 일치해야 했다.

``kiln.domain``·``kiln.chem`` 과 달리 이 패키지의 출력은 결정론적이지
않다(LLM 원문에서 나온다). 호출부는 이 패키지가 내놓는 값을 절대
``source_type="observed"`` 로 격상하지 않는다(00절).
"""

from kiln.llm.recipe_candidates import RecipeCandidateValidationError, build_recipe_candidates
from kiln.llm.recipe_prompt import build_messages

__all__ = [
    "RecipeCandidateValidationError",
    "build_recipe_candidates",
    "build_messages",
]
