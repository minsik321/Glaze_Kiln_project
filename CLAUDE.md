# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소가 무엇인가

유약 실험·소성 관리 시스템. 전기가마 1대·개인 1인 범위, **시뮬레이터 기반**이고
실측은 수행하지 않는다. 기획서 v7의 구현이다.

주장하는 것은 하나다 — **계측 → 판단 → 제어 → 기록이 하나의 사이클로 동작하고,
그 사이클이 재현에 필요한 값을 자동으로 남긴다.**

주장하지 **않는** 것 (기획서 00절, 코드가 이 선을 지킨다):
실제 품질 개선 · 조성으로부터의 결과 예측 · 탐색의 목표 수렴 ·
계수(k₁, k₂, ρ_dry, E, α, β)의 **값**. 계수는 **동정 절차만** 주장한다.

> **v9 각주 (docs/AICE_LLM_FRONTDOOR_PLAN.md §2-1)**: 위 목록 중 "조성으로부터의
> 결과 예측 금지"는 **물리 판정 코어**(두께 총량제약·위험판정·열일적분·냉각상한,
> 아래 "구조" 표의 안쪽·바깥쪽 루프)에 한정된 원칙으로 스코프를 좁힌다.
> 신규 추가되는 "추천·예측·개인화 계층"(LLM 채팅 입구·RAG·Prediction
> Model·Optimization Model, `docs/AICE_LLM_FRONTDOOR_PLAN.md`)은 이 계층
> 밖에 있으며 AI/LLM 호출이 허용된다. 단 모든 출력에 source_type을 붙이고
> 물리 판정 코어의 최종 판단을 대체하지 않는다. 사용자가 2026-09-17 이
> 우선순위를 명시적으로 확인했다.

## 명령

```powershell
# 전체 테스트
.\.venv\Scripts\python.exe -m pytest

# 모듈 하나
.\.venv\Scripts\python.exe -m pytest tests/thickness -q

# 테스트 하나
.\.venv\Scripts\python.exe -m pytest tests/thickness/test_profile.py::test_mean_matches_total_mass_constraint -q

# 실패만 다시, 첫 실패에서 멈춤
.\.venv\Scripts\python.exe -m pytest --lf -x

# 환경 재구성
python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

`pyproject.toml` 이 `pythonpath = ["src"]` 를 설정하므로 설치 없이도 테스트가 돈다.

## 구조

두 개의 루프가 이 시스템의 논거다 (기획서 03절). **안쪽 루프가 통제되지 않으면
바깥 루프의 신호가 잡음이 된다** — 두께가 회차마다 ±0.3mm 흔들리면 조성 ±2%p
차이는 그 안에 묻힌다.

```
[바깥 루프 · 회차 사이]  목표 지정 → 탐색 범위 → 후보 생성 → 선택
                              search ← chem
                                   ↓
[안쪽 루프 · 회차 내]     배치 → 시유 → 위험 판정 → 적재 → 소성 → 자동 기록
                        batch → thickness → risk → firing
                                   ↓
[되먹임]                 결과 3축 → 계수 보정 → 탐색 갱신
                              calibration → search
```

의존은 한 방향이며 순환하지 않는다:

```
constants ─┐
domain ────┼─→ chem ────→ search
           ├─→ batch ───→ thickness ─→ risk
           │                  └───────→ calibration
           └─→ firing ──→ exchange

webapp ─── 위 전부에 의존한다 (UI 경계. 계산하지 않고 직렬화만 한다)
```

## 모듈 — 상세는 각 모듈의 CLAUDE.md에 있다

| 모듈 | 기획서 | 문서 |
|---|---|---|
| `src/kiln/constants.py` | 부록 C 미정값 대장 | [src/kiln/CLAUDE.md](src/kiln/CLAUDE.md) |
| `src/kiln/domain/` | 11 · 4-1 · 10-1절 데이터 모델과 좌표계 | [domain/CLAUDE.md](src/kiln/domain/CLAUDE.md) |
| `src/kiln/chem/` | 04 · 5-1절 UMF · Stull 참조 | [chem/CLAUDE.md](src/kiln/chem/CLAUDE.md) |
| `src/kiln/batch/` | 06절 비중 · 담금시간 역산 | [batch/CLAUDE.md](src/kiln/batch/CLAUDE.md) |
| `src/kiln/thickness/` | 07절 두께 산출 · 총량 제약 | [thickness/CLAUDE.md](src/kiln/thickness/CLAUDE.md) |
| `src/kiln/risk/` | 08절 위험 판정 · 되돌림 비용 | [risk/CLAUDE.md](src/kiln/risk/CLAUDE.md) |
| `src/kiln/firing/` | 09절 열일 · 시뮬레이터 · 구간별 제어 | [firing/CLAUDE.md](src/kiln/firing/CLAUDE.md) |
| `src/kiln/search/` | 05절 조성 탐색 · 사전분포 | [search/CLAUDE.md](src/kiln/search/CLAUDE.md) |
| `src/kiln/calibration/` | 7-3 · 10-2절 계수 보정 | [calibration/CLAUDE.md](src/kiln/calibration/CLAUDE.md) |
| `src/kiln/exchange/` | 10-3절 처방 발행 · 변환 | [exchange/CLAUDE.md](src/kiln/exchange/CLAUDE.md) |
| `src/kiln/webapp/` | 00 · 03절 UI 경계 (앱) | [webapp/CLAUDE.md](src/kiln/webapp/CLAUDE.md) |

## 앱

브라우저에서 **이 패키지를 그대로** 돌리는 정적 웹앱이 `app/` 에 있다
(Pyodide). 계산을 JS로 재구현하지 않으므로 화면에 뜨는 값과 테스트가
검증하는 값이 갈라지지 않는다. 자세한 것은
[src/kiln/webapp/CLAUDE.md](src/kiln/webapp/CLAUDE.md) 와
[app/README.md](app/README.md).

```powershell
.\.venv\Scripts\python.exe app\build_manifest.py   # 소스에 모듈을 추가했으면
.\.venv\Scripts\python.exe -m http.server 8000      # 저장소 루트에서
#  → http://localhost:8000/app/
```

`file://` 로 열면 fetch가 CORS로 막힌다. 반드시 HTTP로 연다.

## 참조 문서

| 문서 | 언제 읽는가 |
|---|---|
| [docs/kiln-plan-v7.md](docs/kiln-plan-v7.md) | **기획서 원본.** 모든 설계 판단의 출처. 절 번호로 인용한다 |
| [docs/INTERFACES.md](docs/INTERFACES.md) | 모듈 간 계약. 경계 자료형과 시그니처는 여기서 고정 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 되살리면 안 되는 폐기된 설계와 그 이유 (부록 E 요약) |

## 이 저장소에서 일할 때

**기획서가 코드보다 위에 있다.** 수식·임계·수치를 바꾸려면 먼저 기획서의 해당
절을 읽어라. 절 번호가 docstring에 인용되어 있다.

**계수 값을 코드에 직접 쓰지 않는다.** `kiln.constants.get("k1")` 을 통한다.
`E · alpha · beta · Kh · sensor_offset` 은 **미정**이라 `.value` 가 예외를 던진다.
값이 필요하면 `.assume(값, 사유)` 로 가정을 명시하고, 그 사실이 결과의
`provenance_notes` / `annotation` 에 실려 나가야 한다. 이것이 부록 C가 명세서
실시가능성의 근거인 이유이고, 조용한 기본값은 그 근거를 무너뜨린다.

**모를 때 '없음'으로 내리지 않는다.** 판정할 수 없으면 `RiskLevel.UNAVAILABLE`
(「판정 불가」)이지 `NONE` 이 아니다. 8-2절이 이 구분을 요구한다.

**기획서에 수치가 적힌 것은 그 수치로 회귀 테스트를 건다.** 5-1절 카올린 표,
7-2절 96g/0.060m² 예제, 9-5절 H 누적 비율, 9-6절 자연냉각률, 10-3절 E 민감도 표.
계산이 표와 어긋나면 **테스트가 아니라 코드를 고친다.**

**순수 stdlib.** 서드파티 의존은 pytest뿐이다. 수식이 코드에 그대로 드러나야
부록 D의 모듈별 독립 기재(① 입력 ② 처리 ③ 출력 ④ 차이)에 그대로 옮겨진다.

**AI를 판단 주체로 쓰지 않는다** (부록 D). 탐색 엔진은 규칙/최적화 알고리즘으로
명시한다. LLM을 쓴다면 자연어 입출력 껍데기로 한정한다.
