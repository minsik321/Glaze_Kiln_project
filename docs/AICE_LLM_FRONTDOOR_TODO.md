# AICE — LLM 프런트도어 TODO (v9)

기준: `AICE_LLM_FRONTDOOR_PLAN.md`. 단계 순서대로 진행하고, 각 단계 완료 시
관련 CLAUDE.md·INTERFACES.md·DECISIONS.md를 함께 갱신한다.

이번 갱신(2026-09-17, 2차)에서 실제 코드(`src/kiln/aice/contract.py`,
`app/react/aice/*`, `src/kiln/domain/models.py`)를 대조해 각 항목의 현재
상태를 검증했다. 이미 있는 것을 "신설"로 잘못 적어 둔 항목은 바로잡았고,
"화면 재설계는 후속 작업"으로 뭉뚱그렸던 항목은 실제 파일·심볼명으로
구체화했다.

**전체 상태(2026-09-17, 3차 갱신)**: Phase 0~6 모두 완료. 유일하게 의도적
으로 손대지 않은 항목은 Phase 2의 "원료 화학 조성·성분 상관관계·기존
레시피 코퍼스 인덱싱"(보류 — 별도 데이터 확보 작업, 아래 해당 항목 참고)
뿐이다. 전체 검증: `/tmp/py311venv/bin/python -m pytest tests backend/tests -q`
전체 통과, `tsc --noEmit` 통과, `app/react/aice`·`records`·`lib` 전체
vitest 통과, `app/kiln-manifest.json` 최신 상태 확인.

## Phase 0 — 문서·경계 정리 (완료)

- [x] `docs/AICE_LLM_FRONTDOOR_PLAN.md` 작성
- [x] `docs/AICE_CITATIONS.md` 작성 (인용 통합)
- [x] `.env.example`에 `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 추가 (2026-09-17 3차 갱신으로 폐기 — 아래 항목이 대체)
- [x] aimlapi.com 단일 키로 전환: 루트 `.env.example`에서 API 키를 제거하고
      `backend/.env.example`에 `AIMLAPI_API_KEY`, `AIMLAPI_BASE_URL`,
      `AIMLAPI_TEXT_MODEL`, `AIMLAPI_IMAGE_MODEL` 추가 (§8 3차 결정)
- [x] 루트 `CLAUDE.md` — "주장하지 않는 것" 스코프 각주 추가
- [x] `src/kiln/webapp/CLAUDE.md` — 모델 호출 경계 각주 추가 (2026-09-17
      2차 갱신에서 실제 반영 확인 — 최초 커밋에는 문구만 있고 파일에는
      빠져 있었다)
- [x] `src/kiln/search/CLAUDE.md` — RAG는 별도 계층임을 각주로 명시 (위와
      동일하게 2차 갱신에서 실제 반영)
- [x] 사용자에게 Anthropic API 키 vs "Claude Pro 계정" 사용 방식 확인받음 (§8) — 데모 버전(비상용) 용도로 확정. 다만 브라우저 자동화로 개인 Pro 구독 세션을 흉내 내는 방식은 이용약관상 데모 여부와 무관하게 허용되지 않는다는 원칙은 유지.
- [x] **최종 확정(3차)**: Anthropic API 키·Gemini API 키를 따로 쓰지 않고,
      사용자가 발급받은 aimlapi.com 키 하나로 텍스트·이미지를 모두 호출 (§8)

## Phase 1 — 데이터 계약

현재 `src/kiln/aice/contract.py`(AiceRun v2)에 이미 있는 것과 없는 것을
구분한다. 없는 척 다시 만들지 않도록, 있는 것은 "확인됨"으로 표시한다.

- [x] **확인됨 — 소지 종류**: `src/kiln/domain/models.py`의 `Ware.clay_body: str`,
      `contract.py`의 `WareSelection.clay_body: str`가 이미 존재한다.
      "`Ware.body_type` 필드 신설" 항목은 삭제한다(중복 신설 금지).
- [x] **완료(2026-09-17)** `RecipeCandidate`/`RecipeCandidateSet` 스키마 —
      배합(`materials`)·예상 소성범위·소성방법 메모·이미지(`PhotoAsset` 재사용)·
      `source_type`을 담는 `RecipeCandidate`와, 그 묶음+선택 상태를 담는
      `RecipeCandidateSet`을 `src/kiln/aice/contract.py`에 추가했다.
      `RecipeSelection`은 그대로 두고 `RecipeCandidateSet.select(id)` 전환
      메서드로만 잇는다. UMF는 `GlazeRecipe`와 같은 이유로 저장하지 않고
      `kiln.chem.unity_formula_from_materials(materials)`로 그때그때 계산한다
      (Phase 2에서 검증에 사용). "5개 고정"은 스키마 불변식으로 강제하지
      않았다 — 개수를 강제할 근거가 없어서다.
- [x] **완료(2026-09-17)** `FiringRun.ramp_rate_c_per_h`, `FiringRun.hold_minutes`
      명시 필드 추가 (`src/kiln/domain/models.py`). 둘 다 `float | None = None` —
      값이 없으면 `schedule`에서 기울기를 되짚어 지어내지 않는다. 기존
      `bridge.record_run()`은 아직 이 필드를 채워 넣지 않는다(호출부 배선은
      Phase 3에서 화면과 함께 간다).
- [x] **완료(2026-09-17)** `ThicknessProfile.areal_density_g_m2` 1급 필드
      노출. 계산 결과, `kiln.calibration.tiles.areal_slope`(g/(m²·√s), 흡수
      속도 상수)는 단위가 달라 그대로 재사용할 수 없었다 — 대신
      `glaze_weight_g / area_m2`(이미 있는 두 필드의 몫)로 직접 정의했다.
      `ThicknessProfile`에 `@property`로, `contract.py`의 `ThicknessEstimate`에
      `areal_density: SourcedValue` 필드로, `webapp/bridge.py`의
      `_profile_payload()` 응답에 각각 노출했다. 화면에 g/m² 우선 표시하는
      UI 작업은 Phase 3 몫으로 남겨뒀다.
- [x] **완료(Phase 3, 2026-09-17)** — 계획대로 Phase 3의 UI 변경과 함께
      실행했다. `PidExecution.preset: Literal["fast","balanced","stable"]`
      제거, `decision: Literal["accepted","regenerate"]`로 교체,
      `AICE_SCHEMA_VERSION` 2→3. 이름 붙은 게인 3벌은 삭제하지 않고
      `app/react/aice/curvePlan.ts`의 내부 구현(`ControlPreset`/
      `CONTROL_PLANS`)으로만 남겼다 — 자세한 내용은 Phase 3 절의 "이름 붙은
      제어 프리셋 제거" 항목 참고.
- [x] **완료(2026-09-17)** `AiceRun.intake: ChatIntake | None` 필드 추가.
      `ChatIntake`가 자연어 원문(`prompt_text`)·첨부 이미지(`prompt_photos`)·
      `RecipeCandidateSet`을 한데 묶는다. 채팅에서 시작하지 않은 실행(레거시
      변환 등)은 `None`.

## Phase 2 — RAG 레시피 탐색 (화면 1)

- [x] **완료(2026-09-17)** aimlapi.com 클라이언트 배선. **계획과 다르게
      배치했다** — `kiln.llm`(신설)은 순수 stdlib 프롬프트·검증 로직만
      담고, `httpx`로 실제 호출하는 `AimlapiClient`는 `backend/app/aimlapi.py`
      에 있다. 이유: `src/kiln` 전체가 `app/kiln-manifest.json`으로 브라우저에
      그대로 배송되고 그 경계는 순수 stdlib이어야 한다
      (`tests/webapp/test_manifest.py::test_manifest_is_pure_stdlib_on_the_browser_side`)
      — 실제로 만들어보기 전에는 이 계획 문서에서 드러나지 않았던 제약이다.
      OpenAI 호환 `chat/completions` + `/images/generations`, `AIMLAPI_TEXT_MODEL`/
      `AIMLAPI_IMAGE_MODEL` 환경변수, provider-agnostic 요청 빌더. 테스트:
      `tests/llm/`(순수 로직), `backend/tests/test_aimlapi.py` +
      `backend/tests/test_recipe_candidates_route.py`(httpx MockTransport).
- [ ] **보류** 원료 화학 조성·성분 상관관계·기존 레시피 코퍼스 인덱싱
      (Glazy 공개 데이터 + 자체 축적). 실제 코퍼스 확보(수집·라이선스·
      정제)가 필요한 별도 데이터 작업이라 이번 갱신에서는 손대지 않았다.
      지금은 LLM 자체 지식 + `kiln.chem.materials`의 5원료 제약(아래 프롬프트
      설계 항목)으로만 동작한다 — RAG라기보다는 "검증된 LLM 제안"에 가깝다.
      코퍼스가 들어오면 `kiln.llm.recipe_prompt.build_messages`의 system
      프롬프트에 검색 결과를 컨텍스트로 주입하는 지점을 추가해야 한다.
- [x] **완료(2026-09-17)** 프롬프트 설계 (`kiln.llm.recipe_prompt.build_messages`).
      고정 JSON 스키마(`response_format=json_object`), 원료명을
      `kiln.chem.materials.MATERIALS`의 5종으로 제한 — **MVP 스코프 결정**:
      원료 DB가 5-1절 최소 세트라서, 그 밖의 원료를 LLM이 제안하면 UMF
      계산이 애초에 불가능하다. 원료 DB가 넓어지면 이 제약도 함께 넓혀야
      한다(코드 주석에 명시).
- [x] **완료(2026-09-17)** `RecipeCandidate` JSON → `kiln.chem.UMF` 검증
      (`kiln.llm.recipe_candidates.build_recipe_candidates`). `GlazeRecipe`
      불변식(비율 합 100%) 재사용 + `unity_formula_from_materials` + Stull
      참조(`kiln.chem.stull.classify`)를 `predicted_firing_note`에 덧붙인다.
      화학적으로 성립하지 않는 후보는 개별적으로 버리고(전체 실패로 만들지
      않음) 사유를 `dropped`로 함께 돌려준다.
- [x] **완료(2026-09-17)** aimlapi.com 이미지 생성 연동
      (`AimlapiClient.generate_image`, `POST /api/v1/aice/recipe-candidates/image`).
      `source_type=synthetic` 라벨은 `RecipeCandidate.photo`(플레이스홀더)에
      이미 붙어 있다 — 실제 생성 이미지를 화면에 받은 뒤 그 `PhotoAsset`을
      채우는 배선은 화면 1 UI(아래 항목) 몫으로 남겨뒀다. **후보 5개를
      한꺼번에 자동 생성하지 않는다** — 장당 비용(§8, 약 $0.05~0.065) 때문에
      카드별 명시 요청(`RecipeImageRequest`)으로 사용자가 비용을 통제하게
      했다. `reference_image_b64`(색상 참고 사진, image-conditioned)는
      클라이언트에 있지만 이 엔드포인트에서는 아직 받지 않는다 — 화면 1
      UI가 사진 업로드를 받게 되면 함께 배선한다.
- [x] **완료(2026-09-17)** 화면 1 UI 신규 컴포넌트 —
      `app/react/aice/RecipeChatScreen.tsx`. 자연어 입력 폼 → `/aice/recipe-candidates`
      호출 → 검증된 후보만 카드로 표시. `RecommendationEvidence.tsx`의
      `.evidence-card-grid`/`.evidence-card` 레이아웃과 `StatusBadge`/`DetailDrawer`/
      `Alert`/`AsyncState`(`ui.tsx`) 컴포넌트를 그대로 재사용했다 — 데이터 경로는
      별개다(`RecommendationEvidence`는 기존 규칙 기반 `aiMvp.ts`를, 이 화면은
      새 LLM 백엔드를 부른다). 카드별 "예상 이미지 생성" 버튼으로 이미지를
      명시 요청(자동 생성 없음, 비용 통제). 인용문은 카드에 노출하지 않는다 —
      배합·예상 소성범위·Stull 참조 메모만 보여준다(§2-2, §6).
      **아직 하지 않은 것**: `AicePrototype.tsx`의 9단계 화면 흐름에 이
      컴포넌트를 배선하지 않았다(예: "레시피" 화면을 대체하거나 그 앞에
      추가) — 그건 기존 화면 흐름의 상태 모델(`PrototypeState`)을 어떻게
      확장할지 결정이 필요한 별도 통합 작업이라 분리해뒀다. 선택된 후보를
      상위로 전달하는 `onSelect` prop은 이미 있다. 사진 첨부(색상 참고
      이미지, image-conditioned 생성)도 아직 받지 않는다.
      테스트: `app/react/aice/contract.test.ts`(타입 확장),
      `app/react/lib/api.test.ts`, `app/react/aice/RecipeChatScreen.test.tsx`.

## Phase 3 — 물리 코어 연결 + 설명형 UI 제거 (화면 2~4)

- [x] **완료(Phase 3, 2026-09-17) — 확인만 필요했음**: 기물 형태 카드
      4종(사발/컵/원통형/병)은 `app/react/aice/catalog.ts`의 `WARE_CATALOG`
      (`bowl`/`mug`/`cylinder_vase`/`bottle`, 접시·타일·기타 포함 총 7종)에
      이미 있고, `AicePrototype.tsx` 3번 화면의 `ChoiceCard` 선택이
      `state.ware`를 거쳐 `ware.preset`(`WareSelection.preset`과 동일 스키마)
      으로 그대로 흘러간다 — 새 배선 불필요, 코드 추적으로 확인만 함.
- [x] **완료(Phase 3, 2026-09-17)**: TODO 원문은 "기존 로직 재사용, 신규
      작업 없음"이라고 적었지만 실제로 확인해보니 AICE 새 화면(`app/react/aice/*`)
      에는 비중 입력 자체가 어디에도 없었다 — 레거시 시뮬레이터
      (`app/react/simulator/WorkflowPanels.tsx`)에만 `check_density` 배선이
      있었다. 그래서 가정과 달리 실제 UI 작업이 필요했다:
      - `app/react/aice/densityAdvice.ts` (신규) — `src/kiln/batch/density.py`의
        `assess_density()`를 TS로 그대로 재현(상수·분기·문구 동일, 로직 새로
        지어내지 않음). AICE 새 화면은 두께·소성곡선·가상제어와 같은 이유로
        Pyodide 브리지를 쓰지 않으므로(순수 로컬 TS 패턴, curvePlan.ts 등과
        동일) 백엔드 왕복이나 Pyodide 로드 없이 즉시 판정한다.
      - `app/react/aice/DensityCheck.tsx` (신규) — 비중·교반 경과시간 입력과
        "비중 확인하기" 버튼, 판정 결과(Alert)를 보여준다. `blocksProgress`는
        항상 false — 경고가 떠도 진행을 막지 않는다(6-4절 원칙 그대로).
      - `AicePrototype.tsx` 4번 화면(도포)에 `<DensityCheck />`를 배선했다.
      - 검증: `app/react/aice/densityAdvice.test.ts`(4개),
        `DensityCheck.test.tsx`(2개) 신규, 기존 `AicePrototype.test.tsx` 포함
        `tsc --noEmit`·vitest 모두 통과.
- [x] **완료(Phase 3, 2026-09-17)**: 시유 전/후 무게 → g/m² 우선 표시.
      실제 `kiln.thickness.compute_profile()`(파푸스·굴딘 면적 적분 +
      전체 형태 프로파일)은 AICE 새 화면이 받지 않는 정밀 치수를 요구해
      그대로 쓸 수 없었다 — 대신 `app/react/aice/arealDensity.ts`(신규)에
      WARE_CATALOG과 자리수가 맞는 "대표 형상 기준 근사 표면적" 상수를 두고
      `g/m² = (시유후 - 시유전) / 대표면적`으로 계산한다(다른 형상 기반
      단순화와 같은 수준 — thicknessView.ts/kilnSimulation.ts와 동일 원칙).
      - `app/react/aice/WeightInputs.tsx`(신규) — 시유 전/후 무게(g) 입력.
      - `ThicknessSection.tsx`에 `arealDensityGm2` prop 추가 — 값이 있으면
        mm 대신 g/m²을 최상단 배지에 우선 표시한다(§5-a "우선 표시" 문구
        그대로). mm 환산은 건조밀도(ρ_dry) 입력이 없어 여전히 판정 불가.
      - `AicePrototype.tsx` 4번 화면에 배선 — 입력된 무게는
        `application.before_weight`/`after_weight`에 `source_type:
        "observed"`(실측)로, 계산된 g/m²은 `thickness.areal_density`에
        `source_type: "inferred"`(면적은 가정값)로 스냅숏에 반영한다.
      - 검증: `arealDensity.test.ts`(2개), `ThicknessSection.test.tsx`(2개)
        신규, `tsc --noEmit`·관련 vitest 모두 통과.
- [x] **완료(Phase 3, 2026-09-17) — 초안**: `app/react/aice/predictionModel.ts`
      (신규) `predictNextRun()`이 레시피 예상 소성범위(`parseFiringRangeC`로
      `RECIPE_CANDIDATES[].firingRange` 표시 문자열에서 파싱)·기물 크기
      분류(`WARE_SIZE_CATEGORY`)·이전 실행 횟수(현재 화면 흐름에는 이력
      카운트가 없어 0 고정 — Phase 5 학습 루프가 실제 카운트를 연결할
      자리)를 입력받아 "다음 실행 제안" 곡선 1장의 유지구간 보정값
      (`holdDeltaC`)을 계산한다. `CurveBundle`(`curves.baseline` /
      `curves.candidates` / `curves.selected_id`) 구조는 그대로 재사용했다 —
      `buildCurveComparison(coating, nextHoldDeltaC?, nextReason?)`가 이
      보정값을 받아 기존 "next" 후보에 반영한다(기본값 -3°C 유지 — 기존
      호출부·테스트 그대로 통과). `versions.predictor`를 `null`에서
      `"aice-predictor-draft-1"`로 바꿨다 — 이 예측이 이제 실제로 후보를
      만들기 때문. **명시적으로 초안이다**: 실제 소성 결과를 예측하는 학습
      모델이 아니라 입력을 반영하는 결정론적 합성 규칙이며, 이유 문구에
      "실제 소성 결과를 예측하지 않습니다"를 항상 포함한다. 학습 루프
      (kiln.calibration 연결)는 Phase 5 몫으로 남긴다.
      - 검증: `predictionModel.test.ts`(5개) 신규, `tsc --noEmit`·관련
        vitest(curvePlan/CurveControlPanel/AicePrototype) 모두 통과.
- [x] **완료(Phase 3, 2026-09-17)**: `KilnSectionSimulator.tsx`는 그대로
      재사용하고, 상시 노출 설명 문구 한 줄만 옮겼다 — 센서 프리셋 추천
      사유(`recommendSensorPlan().reason`)가 담긴
      `<p className="sensor-recommendation">...</p>`를 이미 있는
      `DetailDrawer summary="센서 대표성과 모델 상세 보기"` 안으로 옮기고,
      화면에는 "추천: 상·중·하 3개" 짧은 배지만 남겼다(§2-2 원칙 — 출처
      배지는 남기고 문장형 설명만 접는다). 그 외 캡션(가마 구조 라벨,
      "합성 시각화" 표기 등)은 판정 근거 설명이 아니라 그래픽 캡션이라 손대지
      않았다.
- [x] **완료(Phase 3, 2026-09-17) — 이름 붙은 제어 프리셋 제거**:
      - `CurveControlPanel.tsx`의 `<h3>설명형 제어 프리셋</h3>`과
        `control-preset-grid`(빠른 반응/균형/안정 우선 버튼 3개)를 삭제하고
        "다시 추천" / "이대로 진행" 2액션으로 교체했다.
      - `curvePlan.ts`의 `ControlPreset`/`CONTROL_PLANS`는 남았지만 이제
        `CurveControlPanel.tsx` 내부 구현 전용이다 — label/effect 문구는
        지웠고, "다시 추천"을 누를 때마다 `PRESET_ORDER`를 순환해 내부
        게인 세트만 바꾼다. 사용자에게는 이름도 문구도 노출하지 않는다.
      - `onApprove` 시그니처를 `(decision: ControlDecision, samples,
        parameters) => void`로 바꿨다 — `ControlDecision = "accepted" |
        "regenerate"`이며, 프런트엔드는 현재 "이대로 진행" 클릭에서만
        호출하므로 항상 `"accepted"`를 보낸다.
      - `AicePrototype.tsx`는 더 이상 `controlPreset`을 상태로 들고 있지
        않는다 — 승인 시 자식이 실제로 쓴 `samples`/`parameters`를 그대로
        받아 `approvedControlSamples`/`approvedControlParameters`에 저장하고
        스냅숏의 `pid.decision`/`pid.parameters`/`pid.samples`에 그대로
        반영한다. 저장된 기록을 복원할 때는 어떤 내부 게인이 쓰였는지 이름이
        남아있지 않으므로(애초에 사용자에게 노출하지 않으므로) 기본 게인
        (`balanced`)으로 다시 계산해 채운다.
      - Python 계약(`PidExecution.preset` → `.decision`,
        `AICE_SCHEMA_VERSION` 2→3)과 TypeScript 미러
        (`app/react/aice/contract.ts`)를 함께 갱신했다 — `AiceRun.pid.preset`
        → `.decision`, `AiceRunRecord.schema_version` 2→3
        (`app/react/lib/api.ts`)까지 전부 맞췄다.
      - 검증: `/tmp/py311venv/bin/python -m pytest tests backend/tests -q`
        전체 통과, `tsc --noEmit` 통과, 관련 vitest 6개 파일(20 테스트) 통과.
- [x] **완료(Phase 3, 2026-09-17) — 상시 노출 설명 3줄 패널 제거**:
      - `AicePrototype.tsx`의 `Guidance` 래퍼가 이제 `ExplanationPanel`을
        기본으로 접힌 `DetailDrawer summary="왜 · 무엇을 가정 · 다음 행동
        보기"` 안에 넣어 렌더링한다 — 컴포넌트 자체는 삭제하지 않고(§2-2:
        지우는 건 문장형 설명이지 출처 표시가 아님) 상시 노출만 없앴다.
        `StatusBadge` 등 근거 배지는 그대로 화면에 남아 있다.
      - `CurveControlPanel.tsx`의 `<p className="curve-change-reason">왜
        바뀌었나요?...</p>`도 같은 기준으로 `DetailDrawer summary="왜
        바뀌었는지 · PID 게인·포화·원시 로그 보기"` 안으로 옮겼다.
      - `RecommendationEvidence.tsx`/`ResultFeedback.tsx`/`ThicknessSection.tsx`
        는 이전 갱신에서 grep으로 확인한 대로 같은 이름의 상시 노출 3줄
        패턴이 없었다 — 이번에도 별도 변경 없음.
      - `RecommendationEvidence.tsx`, `ResultFeedback.tsx`, `ThicknessSection.tsx`
        는 같은 이름의 "왜/가정/다음행동" 문구가 없는 것을 확인함(grep
        검증 완료) — 다만 화면별로 상시 노출 설명문이 다른 형태로 있을 수
        있으니 착수 시 개별 재확인은 필요

## Phase 4 — 결과 기록과 공유 (화면 6~7)

- [x] **완료(Phase 3에서 이미 배선됨, 2026-09-17 Phase 4 갱신에서 확인)**:
      결과 입력 폼 — `app/react/aice/ResultFeedback.tsx`가 목표 일치·색·
      광택·질감·투명도·결함(핀홀/기어감/잔금/흘러내림)을 전부 칩 선택으로
      받고, `AicePrototype.tsx` 9번 화면(평가)에 이미 배선돼 있었다. 사진
      첨부 버튼은 "로컬 데모에서는 비활성"으로 의도적으로 막아뒀다 — 실제
      업로드는 스코프 밖.
- [x] **완료(Phase 3 이전부터 배선돼 있었음, 확인)**: `FiringResult` 저장 →
      `AiceRun` 연결. `app/react/records/AiceRecordsPanel.tsx`의
      `save()`가 `AicePrototype`의 `onSnapshotReady`로 받은 현재 스냅숏을
      `aiceRunsApi.create()`로 백엔드에 저장한다(`App.tsx` → `RecordsPanel`
      → `AiceRecordsPanel` 배선 확인됨). `assertAiceRun()`으로 저장 전
      스키마 검증까지 한다.
- [x] **완료(위와 동일 — 이미 배선돼 있었음, 확인)**: 공개/비공개 토글 UI.
      `AiceRecordsPanel.tsx`에 공개 전 필수 동의 체크리스트(사진 권리·
      개인정보·위치정보·철회 이해 4항목, `canPublish()`로 전부 체크돼야
      활성화)와 `publish()`/`withdraw()` 버튼이 이미 있다. 백엔드
      `Consent.share_allowed` 등 필드와 `/aice-runs/{id}/publish`,
      `/aice-runs/{id}/publication`(DELETE) 엔드포인트도 이미 연결돼
      있었다.
- [x] **완료(Phase 4, 2026-09-17)**: 표준 촬영 규격 정의(부록 B 최상단
      미해결 과제 — kiln-plan-v7.md: "광택도·투명도 라벨링의 표준 촬영
      규격, 라벨 오차가 탐색의 작동 조건이므로 우선순위 최상단"). 기존
      `ResultFeedback.tsx`의 4줄짜리 `PHOTO_GUIDE`를 측정 가능한 6항목
      규격으로 구체화했다: 무광 중성 회색(먼셀 N5) 배경 / 색온도 약
      5000K(D50) 확산광 2개 이상 / 기물에서 약 50cm·렌즈 축 수직 / 24색
      컬러체커(또는 동급)를 같은 프레임에 / 화이트밸런스·노출 고정(자동
      보정 끔, 흰색 패치 클리핑 방지) / 최소 1600×1200px·고품질 저장.
      **정직하게 남겨둔 한계**: 이 규격을 지킨다고 라벨 오차가 사라지는
      건 아니다 — 촬영 환경 편차라는 오차 원인 하나를 통제할 뿐이고, 실제
      라벨 정확도는 축적된 사진으로 검증해야 한다(부록 B의 "미해결"은
      완전히 해소되지 않았다, 이번 갱신은 "정의"까지만 완료).
      - 검증: `ResultFeedback.test.tsx` 갱신 통과, `tsc --noEmit`·전체
        pytest(`tests backend/tests`) 통과.

## Phase 5 — Optimization Model (학습 루프, 화면 8~9)

- [x] **완료(Phase 5, 2026-09-17) — 값 하나만 연결, 화면 배선은 안 함**:
      `kiln.calibration` 갱신 루프와 프런트엔드 Prediction Model
      (`predictionModel.ts`)은 서로 다른 층위다 — TS 쪽은 실제 소성 결과를
      예측하지 않는 결정론적 합성 규칙(Phase 3 초안)이고 `CoefficientTable`을
      전혀 읽지 않는다. 이 둘을 "같은 것"으로 주장하지 않는 선에서, 미래에
      `priorRunCount`가 이어질 소스 값 하나를 파이썬 쪽에 냈다:
      `kiln.calibration.registry.CoefficientTableStore.calibration_runs
      (recipe_id)` → 그 레시피 `CoefficientTable.calibration_runs`.
      **결선 범위**: (i) 백엔드에 레시피별 캘리브레이션 상태를 노출하는
      엔드포인트는 이번에 **추가하지 않았다** — `backend/app/`에는 여전히
      캘리브레이션 API가 없다. (ii) 프런트엔드 `AicePrototype.tsx`의
      `priorRunCount: 0`(주석 "Phase 5 몫")도 그대로 남아 있다 —
      `aiceRunsApi.listMine`으로 저장된 실행 이력 개수를 세는 방식도
      검토했지만, 그건 `CoefficientTable.calibration_runs`(실제 k1 갱신에
      **기여한** 회차 수 — 담금이 아니거나 재시유/건조 미완이면 갱신에서
      빠진다, 10-2절)와 다른 숫자라 그대로 이어 붙이면 "학습 루프와
      연결했다"는 과장이 된다. 세션 시간 내에 정직하게 낼 수 있는 것은
      파이썬 쪽 소스 값과 그 근거뿐이라 거기서 멈췄다. 프런트엔드 결선
      (엔드포인트 추가 + `priorRunCount` fetch)은 향후 작업으로 남는다.
      - 신규: `src/kiln/calibration/registry.py`
        (`CoefficientTableStore.calibration_runs`).
      - 검증: `tests/calibration/test_registry.py`
        (`test_calibration_runs_reads_through_to_the_recipes_own_table` 등).
- [x] **완료(Phase 5, 2026-09-17) — UI 없음, 파이썬 시연만**: 체크리스트
      원문의 "기존 v7 '더미 20회차 수렴' 방식 재사용"은 문자 그대로 하지
      않았다 — 그 방식은 `docs/DECISIONS.md` §12-2·`docs/kiln-plan-v7.md`
      부록 E가 "생성기와 추정 모델이 같으면 어떤 수렴도 자명하다"며 이미
      폐기했다. 대신 `kiln.firing.simulator.KilnSimulator`와 같은 원칙으로
      새로 만들었다: `run_update`(√t만 보는 추정 모델)와 **구조적으로
      다른** 생성기(√t + 담금시간에 선형인 크러스트 항 + 저울·비중 잡음,
      seed로 재현 가능)로 같은 레시피의 20회차를 굴리고
      `CoefficientTableStore.apply_run_update`로 누적한다. 결과는 "k1이
      참값에 수렴했다"가 아니라 **"앞 5회차 대비 뒤 5회차 평균 gap이 약
      7.6% 줄고, 뒤쪽 평균 gap은 여전히 합성 참값의 약 4.1%(크러스트 항이
      만드는 편향)로 남는다"**로 낸다(실행 시 seed=20260917 기준 실측치 —
      seed·rounds를 바꾸면 달라진다. 코드는 이 수치를 하드코딩하지 않고
      매번 계산한다). 이 절대·상대 수치를 "단일 참값 복원"으로 읽지 말 것
      — 생성기 자체가 그 참값을 정확히 못 맞히게 오지정돼 있다.
      **화면(8~9절)은 만들지 않았다** — 시간 제약상 이번 MVP 범위는
      `kiln.calibration` 파이썬 시연까지이고, `ConvergenceDemoResult`를
      그대로 화면에 붙이는 일만 남아 있다.
      - 신규: `src/kiln/calibration/demo_convergence.py`
        (`run_convergence_demo`, `ConvergenceDemoResult`, `ConvergenceRound`).
      - 검증: `tests/calibration/test_demo_convergence.py`(8개) — seed 재현,
        생성기 오지정 확인, "수렴했다"/"복원했다" 표현 금지 단언 포함.
- [x] **완료(Phase 5, 2026-09-17)**: `src/kiln/calibration/registry.py`의
      `CoefficientTableStore`(`recipe_id -> CoefficientTable` dict) 신규.
      처음 보는 `recipe_id`는 모든 계수가 `None`(미동정)인 새
      `CoefficientTable`을 받고, 이미 있는 `recipe_id`는 그 레시피의
      기존 테이블을 그대로 돌려준다. 갱신(`apply_run_update`)은 새 물리를
      추가하지 않고 기존 `kiln.calibration.update.run_update`를 그 레시피의
      현재 테이블 위에서 호출할 뿐이며, 결과를 그 레시피 키에만 `put`한다.
      - 검증: `tests/calibration/test_registry.py`(5개) —
        `test_updating_one_recipe_does_not_move_another_recipes_table`이
        핵심 주장(두 레시피가 서로 오염되지 않는다)을 직접 확인한다.

  공통: `src/kiln/calibration/CLAUDE.md`에 "Phase 5" 절 추가,
  `docs/INTERFACES.md` `kiln.calibration` 절에 `CoefficientTableStore` /
  `run_convergence_demo` API 형태 추가. `app/kiln-manifest.json` 재생성
  (`python app/build_manifest.py`) — `tests/webapp/test_manifest.py` 통과
  확인. 전체 스위트 `python -m pytest tests backend/tests -q` 665 passed.

## Phase 6 — 검증

- [x] **완료(Phase 6, 2026-09-17)**: `AICE_USER_FLOW.md` §5 인수조건을
      Phase 3의 설명형 UI 제거에 맞춰 갱신했다 — "`균형` 제어 프리셋 선택"
      문구를 "`이대로 진행` 클릭"으로 바꾸고(이름 붙은 프리셋 UI 자체가
      없어졌으므로), "화면 3·5·6·7·8·9에 왜/가정/다음행동 문구가 **보인다**"
      를 "상세 보기를 열어야 보인다(완주에는 필요 없음)"로 정정했다. 숫자
      입력 없는 완주 시나리오는 `AicePrototype.test.tsx`의
      "finishes a sample simulation without numeric input" 테스트가 9개
      화면 전체를 실제로 클릭해 통과시키며 계속 재확인한다(`spinbutton`
      role이 하나도 없음을 단언).
- [x] **완료(Phase 6, 2026-09-17)**: `app/react/aice/integration.test.ts`가
      이미 두께 도포(coating) 변경 → 두께 분포·위험 문장·소성곡선·가마
      시뮬레이션 4곳 전파를 확인하고 있었다(확인함). 여기에 TODO 예시로
      명시된 "레시피 후보 변경" 경로를 `AicePrototype.test.tsx`에 새로
      추가했다 — 레시피 후보를 바꾸면 `predictNextRun()`의 예측 입력(예상
      소성범위)이 달라져 "다음 실행 제안" 곡선(`curves.candidates`의
      role: "next")의 실제 온도점이 달라지는 것을 컴포넌트 레벨에서
      확인한다(레시피 선택 → Prediction Model → 소성곡선까지의 실제 전파
      경로, Phase 3 Task 7과 연결됨). `CurveBundle` 구조(역할 목록)는
      레시피가 바뀌어도 동일함도 함께 확인한다.
- [x] 슬립캐스팅 논문 서지 확정 — Adcock & McDowall (1957), Tiller & Tsai (1986).
      `docs/AICE_CITATIONS.md` §1 반영
- [x] **확인(Phase 6, 2026-09-17) — 조치 없음이 맞는 조치**: 이 항목은
      "찾아서 채우라"는 뜻이 아니라 "미확인 상태를 계속 미확인으로 정직하게
      유지하라"는 뜻이다. `docs/AICE_CITATIONS.md` §4를 다시 확인했다 —
      단일 1차 논문을 여전히 특정하지 못했고, 2차 출처 표기를 그대로
      유지한다. 이번 작업 중 새로 지어내거나 격상한 인용이 없음을 확인.
- [x] **완료(Phase 6, 2026-09-17)**: `docs/AICE_LLM_FRONTDOOR_PLAN.md` §9를
      갱신했다 — Prediction Model(`holdDeltaC`, UX 표시값)과 Optimization
      Model(`kiln.calibration`의 `k1`/`rho_dry`, 프런트엔드로 아직 나가지
      않음)이 서로 다른 값을 다룬다는 점을 명시해 부록 C·D "값 기재 금지"
      원칙과의 긴장 범위를 좁혔다. 완전히 해소된 것은 아니다 — 최종 판단은
      여전히 변리사 몫으로 명시적으로 남겨뒀다.
- [x] **완료(Phase 3에서 실행됨, Phase 6에서 재확인, 2026-09-17)**: 이
      항목이 가리키는 변경 자체가 Phase 3에서 일어났다 —
      `PidExecution.preset` → `.decision` 전환 때
      `AICE_SCHEMA_VERSION`을 2→3으로 올렸다(Python `src/kiln/aice/contract.py`,
      TypeScript `app/react/aice/contract.ts` 양쪽 모두). 마이그레이션
      경로(`legacy_work_record_to_aice_run` / `legacyWorkRecordToAiceRun`)는
      **의도적으로 갱신하지 않았다** — 레거시 WorkRecord(v1)에서 AiceRun으로
      가는 변환은 애초에 `pid.preset`/`pid.decision` 어느 쪽도 복원하지
      않고 항상 샘플 기본값으로 채우므로(`run_id`만 이어받고 나머지는
      `sample_aice_run()` 골격), 스키마가 바뀐 필드 자체가 마이그레이션
      경로에 등장하지 않는다 — 고칠 대상이 없었다는 뜻이지 빠뜨린 게
      아니다. `tests/aice/test_contract.py`/`contract.test.ts`가 이
      경로를 계속 통과시킨다.

## 보류/후속 결정 필요

- ~~"Claude Pro 계정으로 fetch"의 정확한 의미~~ → 해결됨(§8): 데모/비상용 목적,
  API 키(발급된 정식 키) 사용 원칙 확정
- ~~어느 API 키를 쓸 것인가~~ → 해결됨(§8, 3차): Anthropic·Gemini 개별 키가
  아니라 aimlapi.com 단일 키(사용자가 이미 발급받음)로 텍스트·이미지 모두 처리
- Prediction Model의 최초 학습 데이터 출처(합성 vs 문헌 기반 초기값) — Phase 2 착수 전 확정
- `PidExecution.preset` 제거가 `AICE_SCHEMA_VERSION` 상향을 요구하는지 —
  Phase 1 착수 시 `src/kiln/aice/CLAUDE.md`와 함께 결정
