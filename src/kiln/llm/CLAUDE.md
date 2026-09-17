# kiln.llm — LLM 프런트도어 프롬프트·검증

기준: `docs/AICE_LLM_FRONTDOOR_PLAN.md`, `docs/AICE_LLM_FRONTDOOR_TODO.md` Phase 2.

**이 패키지는 순수 stdlib이다.** `src/kiln` 전체가 `app/kiln-manifest.json`을
통해 브라우저(Pyodide)로 배송되기 때문이다
(`tests/webapp/test_manifest.py::test_manifest_is_pure_stdlib_on_the_browser_side`).
aimlapi.com을 실제로 호출하는 `httpx` 기반 클라이언트는 여기 없다 —
`backend/app/aimlapi.py`에 있다(왜 거기 있는지는 그 파일의 모듈 docstring과
`src/kiln/webapp/CLAUDE.md`의 "v9 각주" 참고).

## ① 입력

화면 1(LLM 채팅)의 자연어 원문(`build_messages`), aimlapi.com이 돌려준 원문
JSON(`build_recipe_candidates`).

## ② 처리

- `recipe_prompt.build_messages`: 원료명을 `kiln.chem.materials.MATERIALS`
  5종(규석·장석·석회석·카올린·벤토나이트, 05-1절 최소 세트)으로 강제하는
  system 프롬프트를 만든다. 이 목록 밖의 원료는 애초에 `kiln.chem`이 UMF를
  계산할 수 없으므로, 프롬프트 단계에서 미리 막는다.
- `recipe_candidates.build_recipe_candidates`: LLM 원문 JSON을 후보별로
  검증한다 — `kiln.domain.models.GlazeRecipe` 불변식(비율 합 100%) 재사용,
  `kiln.chem.unity_formula_from_materials`로 UMF 계산, `kiln.chem.stull.classify`
  로 Stull 참조를 덧붙인다. **후보는 개별적으로 버린다** — 하나가 화학적으로
  성립하지 않는다고 전체 응답을 실패시키지 않는다.

## ③ 출력

`build_messages` → aimlapi chat/completions 메시지 목록.
`build_recipe_candidates` → `(RecipeCandidateSet, dropped 사유 튜플)`.
`RecipeCandidate.source_type`은 항상 `"inferred"` — `kiln.aice.contract`와
같은 원칙으로 `"observed"`로 격상하지 않는다.

## ④ 차이

이 패키지가 하지 않는 것: 착색 산화물로 정확한 목표색이 나온다고 주장하지
않는다(4-4-a절, `kiln.chem.colorants`의 경계 — DECISIONS.md "착색 산화물
참고 색상표를 조성 예측으로 확장" 항목이 막는 것과 같은 이유). 원료 5종 제약은
MVP 스코프 결정이다 — 원료 DB가 넓어지면 프롬프트의 허용 목록도 함께
넓혀야 한다.

## 결합 효과

`build_messages`의 출력은 `backend/app/aimlapi.py`의 `AimlapiClient.chat_json`
이 호출하고, 그 결과를 `build_recipe_candidates`가 검증해
`backend/app/routes.py`의 `POST /api/v1/aice/recipe-candidates`가 돌려준다.
검증을 통과한 후보는 이후 `kiln.aice.contract.ChatIntake`/`AiceRun.intake`에
담긴다(Phase 1).
