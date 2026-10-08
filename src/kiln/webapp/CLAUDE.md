# kiln.webapp — UI 경계

기획서 전문: [`../../../docs/kiln-plan-v7.md`](../../../docs/kiln-plan-v7.md)
00절, 03절(두 루프), 6-4 · 7-6 · 8-4 · 9-6절(화면 요구), 부록 C · D.

> **2026-09 현재 상태**: 이 모듈(`KilnApp`)을 브라우저에서 Pyodide로 호출하던
> 정적 웹앱 경로(`app/build_manifest.py`, `app/kiln-manifest.json`,
> `app/react/Simulator.tsx`, `app/react/simulator/`)는 화면이
> `app/react/aice/*`(LLM 프런트도어)로 옮겨가며 제거했다. 지금은 아무 프런트
> 엔드도 이 모듈을 호출하지 않는다 — 아래 "왜 Pyodide인가" 이하는 이 모듈이
> 왜 이렇게 설계됐는지의 근거로, 그리고 향후 재연동 시의 설계 원칙으로
> 남겨 둔다. `src/kiln`의 나머지 물리 판정 모듈은 계속 쓰인다(`backend/app`이
> `kiln.llm`·`kiln.chem`을 가져다 쓴다).

부록 D 고정 4항목. **이 모듈은 계산을 하지 않는다** — 09개 모듈이 낸 결과를
직렬화만 한다. 계산이 여기 들어오면 같은 수식이 두 곳에 있게 되고, 기획서의
구현이 어느 쪽인지 말할 수 없게 된다.

## 왜 Pyodide인가

앱이 정적 웹앱이려면 브라우저가 계산을 해야 하고, 브라우저가 계산하는
보통의 방법은 **JS로 다시 구현하는 것**이다. 그 순간 두 구현이 생긴다.

기획서가 "수식·임계·수치를 바꾸려면 먼저 기획서의 해당 절을 읽어라"라고
요구하고, 테스트가 5-1절 카올린 표·7-2절 96g 예제·9-5절 H 누적 비율·
9-6절 자연냉각률로 회귀를 걸어 두었는데, **그 테스트는 파이썬 쪽만 지킨다.**
JS 사본은 아무도 지키지 않는 채로 화면에 숫자를 띄우게 된다 — 시연에서
보이는 값과 테스트가 검증하는 값이 갈라지고, 갈라진 것을 알아챌 방법이 없다.

Pyodide는 브라우저에서 CPython을 돌리므로 `src/kiln` 을 **그대로** 가져간다.
느리고(첫 부팅 수십 초) 무겁지만(런타임 수 MB), 사본이 생기지 않는다.
순수 stdlib이라 휠 빌드나 네이티브 확장이 필요 없는 것도 여기서 값을 한다.

## ① 입력

- 화면이 넘기는 **원시값**뿐이다 — 숫자·문자열·리스트·dict. 도메인 자료형이
  경계를 넘어오지 않는다(JS가 만들 수 없다).
- 시유 방법·등급·실패 유형은 **한국어 라벨 문자열**로 받아 열거형으로 되돌린다.
  열거형 이름(`DIPPING`)이 아니라 라벨(`"담금"`)인 이유는 화면이 이미 그 라벨을
  쓰고 있기 때문이다 — 두 어휘를 두면 번역표가 하나 더 생긴다.

## ② 처리

- `KilnApp` 이 한 세션의 상태를 들고 있다(레시피·기물·시유 기록·회차·계수
  표·`Prior`·`SearchState`). **저장소가 아니다** — 영속화는 화면이
  `export_state()` 를 받아 처리한다.
- 각 메서드는 해당 절의 모듈을 한 번 호출하고 결과를 dict로 편다.
- **예외를 경계 밖으로 던지지 않는다.** 사용자가 넣은 값이 도메인 불변식을
  깨면(비중 0.9, 건조 후가 시유 전보다 가벼움) `{"ok": False, "reason": ...}`
  을 돌려준다. Pyodide에서 던진 예외는 JS 콘솔에만 남고 화면은 아무 말 없이
  멈춘다 — 6-4절이 "경고가 진행을 막지 않는다"고 한 태도와 정반대가 된다.
- **미정 계수의 `.value` 를 읽지 않는다.** `registry()` 는 `is_determined` 를
  먼저 보고, 미정이면 값 대신 `annotation()` 과 동정 방법을 낸다. E가 필요한
  자리(`simulate`, `issue_prescription`)는 사용자가 고른 가정값을 받아
  `assume_E()` 를 거치고, 그 문구(`E_note`)를 결과에 싣는다.

## ③ 출력

JSON 직렬화 가능한 dict. **모든 반환에 출처가 들어 있다** — `provenance_notes`
/ `annotation` / `notes` / `reason` / `E_note` 중 하나 이상. 선택 필드가 아니다.

| 메서드 | 절 | 출처 필드 |
|---|---|---|
| `registry` | 부록 C | `annotation` · `identification` |
| `color_reference` · `mix_color` | 4-4-a | `note` · `provenance_notes` |
| `check_density` · `suggest_dip_time` | 06 | `annotation` |
| `glaze` | 07 | `provenance_notes` |
| `risk` | 08 | finding별 `annotation`, option별 `cost` |
| `cooling` | 9-6 | `provenance_notes` · `rejections` |
| `simulate` | 12-2 | `E_note` · `provenance_notes` |
| `record_result` | 10-2 | `calibration.notes` · `solid`/`dashed` |
| `issue_prescription` · `transform_prescription` | 10-3 | `provenance_notes` · `reasons` |

## ④ 차이

상용 유약 계산기와 가마 컨트롤러 앱은 값을 보여주고 출처를 보여주지 않는다.
숫자가 문헌 관행값인지 이 가마에서 동정된 값인지가 화면에서 구분되지 않으면
사용자는 모두 같은 신뢰도로 읽는다. 이 경계의 차이는 (a) **출처를 선택
필드로 두지 않아** 화면이 떨어뜨리려면 의도적으로 버려야 하고, (b) 미정
계수는 값 칸 자체가 비어서 "아직 모른다"가 화면에 남으며, (c) 판정 불가와
위험 없음이 다른 등급으로 경계를 넘어간다는 점이다.

**그리고 이 경계에도 모델 호출이 없다**(부록 D: AI를 판단 주체로 쓰지 않는다).
탐색은 `kiln.search` 의 규칙·최적화 알고리즘이 하고, 앱은 그 결과를 옮긴다.

> **v9 각주 (docs/AICE_LLM_FRONTDOOR_PLAN.md §2-1)**: 위 문장은 이 경계(물리 판정
> 코어의 UI 표시)에 한정된다. 신규 "추천·예측·개인화 계층"(LLM 채팅 입구, RAG
> 레시피 추천, Prediction Model, Optimization Model)은 이 경계 밖에서 모델을
> 호출하며, 그 결과는 `source_type`을 달고 이 웹앱 경계로 들어온다. 이 경계
> 자체(두께·위험·소성 시뮬레이션 표시, 04절 "계산하지 않고 직렬화만 한다")는
> 여전히 모델을 호출하지 않는다 — AI 계층의 출력도 여기서는 그대로 옮겨
> 보여줄 뿐이다.
>
> **Phase 2에서 바로잡은 것**: 이 각주는 원래 "신규 모듈"을 `kiln.aice` 확장
> 또는 `kiln.llm`으로만 적었는데, 실제로 만들어보니 그렇게 한 덩어리로 둘 수
> 없었다. `src/kiln` 전체가 `app/kiln-manifest.json`을 통해 브라우저(Pyodide)로
> 그대로 배송되고 그 경계는 순수 stdlib이어야 하기 때문이다
> (`tests/webapp/test_manifest.py::test_manifest_is_pure_stdlib_on_the_browser_side`).
> 그래서 실제로는 둘로 갈라진다 — `kiln.llm`(프롬프트 설계·`kiln.chem` 교차
> 검증, 순수 stdlib, 브라우저에도 실림)과 `backend/app/aimlapi.py`(`httpx`로
> aimlapi.com을 실제로 호출하는 게이트웨이, `backend.app.supabase.SupabaseGateway`
> 와 같은 자리)다. "이 경계 밖에서 모델을 호출한다"는 문장은 결국 물리적으로도
> 맞았다 — 그 호출이 브라우저 밖(백엔드)에서 일어난다는 뜻이었다.

## 배포와 매니페스트 (과거 설계, 현재 비활성)

정적 호스팅에는 디렉터리 목록 API가 없으므로, 이 모듈을 브라우저로 배송할
때는 브라우저가 받아야 할 파일 목록을 빌드 시점에 뽑아야 했다
(`app/build_manifest.py` → `app/kiln-manifest.json`, `tests/webapp/test_manifest.py`
로 대조). 이 배송 경로 자체가 제거되었으므로 위 파일들도 함께 제거했다.
재연동할 때는 이 절의 요구사항(매니페스트가 실제 파일 목록과 어긋나면 안
된다, 서드파티 import가 없어야 한다)을 다시 세워야 한다.

## 결합 효과

이 모듈이 붙어야 03절 두 루프가 **사람 앞에서** 한 바퀴 돈다. 그 전까지
루프는 테스트 안에서만 돌았고, 테스트는 "계산이 맞다"를 보이지 "재현에
필요한 값이 자동으로 남는다"를 보이지 못한다 — 후자는 화면이 무엇을 묻고
무엇을 남기는지의 문제이기 때문이다.

동시에 이 경계는 **00절이 깨지기 가장 쉬운 자리**다. 숫자는 화면에서 크고
출처는 작으며, 접어두고 싶은 유혹이 계속 생긴다. `tests/webapp/test_bridge.py`
가 그 유혹을 막는다 — 미정 계수가 값을 흘리는지, 「판정 불가」가 「없음」으로
접히는지, 선택지에서 비용이 빠지는지를 경계에서 다시 확인한다. 모듈들이
각자 지킨 것을 UI 직전에 한 번 더 지키는 셈이고, 그 중복은 의도적이다.
