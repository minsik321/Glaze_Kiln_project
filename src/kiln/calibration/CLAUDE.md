# kiln.calibration — 7-3 · 10-2절 계수 보정

기획서 전문: [`../../../docs/kiln-plan-v7.md`](../../../docs/kiln-plan-v7.md)
7-3 · 7-4 · 7-5 · 7-7 · 10-2절, 부록 A, 부록 C.
경계 계약: [`../../../docs/INTERFACES.md`](../../../docs/INTERFACES.md) `kiln.calibration` 절.
폐기 설계: [`../../../docs/DECISIONS.md`](../../../docs/DECISIONS.md)
("초벌 온도를 캘리브레이션으로 흡수", "예측과 파단면 단위 불일치",
"편차비 사후 진단이 자기 입력을 되돌려준다").

부록 D 고정 4항목. 다루는 범위는 이 모듈(`tiles.py`, `update.py`,
`diagnosis.py`) 단독이며, 두께 산출 자체는 `kiln.thickness`, 비중 함수
g(ρ)·m(ρ)는 `kiln.batch` 문서를 본다.

## ① 입력

- **타일 캘리브레이션**(`TileSample`) — 평평한 타일 3~4장의
  담금시간 · 면적 · 건조 후 유약 무게 W, 그리고 **선택적으로** 캘리퍼
  실측 두께. 슬립 비중 ρ와 흡수율은 키워드 인자.
- **회차 되먹임**(`update_after_run` / `run_update`) — `CoefficientTable`
  (현재 동정 상태), `GlazingRecord`(저울 2회 · 담금시간 · 비중 · 왁스 면적 ·
  재시유/건조완료), `Ware`(형태 → 표면적, 초벌 온도).
- **사후 진단**(`diagnose_deviation`) — `ThicknessProfile` 과 **파단면 실측
  두께(소성 후 [mm])**. 실측이 없으면 그것이 곧 "진단하지 않는다"는 입력이다.
- 계수 초기값은 `kiln.constants` 대장에서만 꺼낸다. 코드에 숫자를 박지 않는다.

## ② 처리

- **7-3절 타일 회귀 (저울)**: `y=W/A` 를 `x=√(담금시간)·흡수율·g(ρ)` 에
  **원점 통과 최소제곱**(정규방정식 `C·Σx²=Σxy`, 순수 stdlib)으로 회귀해
  기울기 `C = 1000·ρ_dry·k1·흡수율·g(ρ)` 를 얻는다. 절편이 없는 이유는
  담금시간 0이면 부착량도 0이기 때문이다.
- **7-3절 축퇴 — 이 모듈에서 가장 중요한 처리**: 저울이 주는 것은 `C` 하나뿐이고
  거기서 **ρ_dry와 k1은 곱으로 붙어 분리되지 않는다.** 캘리퍼 실측이 하나도
  없으면 `rho_dry=None` 을 반환하고 사유를 `notes` 에 적는다. k1은 대장 초기값
  ρ_dry를 **가정해** 내되 가정 사실과 "C는 ρ_dry 가정과 무관한 불변량이고
  ρ_dry가 X배면 k1은 1/X배"라는 관계까지 함께 싣는다(00절: 조용한 기본값 금지).
- **7-3절 캘리퍼**: `ρ_dry = ΣW/Σ(A·t)` (질량가중 = 총무게/총부피).
  파괴·소성 불필요, 도구는 캘리퍼 1개.
- **10-2절 회차 갱신**: 회차마다 `k1 = W/(A·ρ_dry) / (√담금시간·흡수율·g(ρ))`
  하나가 서고, 기존 값과 **회차 수 가중 평균**으로 합친다. 표면적은
  왁스 면적을 빼고 내부 시유를 반영한다(7-5절 — 왁싱 미처리 시 총량 앵커가 깨진다).
  **담금이 아니거나 재시유·건조 미완이면 갱신하지 않는다** — 흡수율은 k1과
  곱으로만 식별되므로(부록 A) 그런 회차를 먹이면 k1이 흡수율 변화를 대신 삼킨다.
- **7-5절 재캘리브레이션 트리거**: 초벌 온도 변화는 흡수율로 흡수하지 않고
  `check_bisque_change` 가 멈추라고 말한다. v5의 "캘리브레이션으로 흡수"는
  k1을 조용히 틀어놓는 경로였다.
- **7-4절 단위 일치 가드**: 잔차는 `residual_mm()` 한 곳에서만 만들고 반드시
  `kiln.thickness.fired_thickness()` 를 지난다 — `오차 = t_예측·s − t_파단면실측`.
  생/소성후를 그대로 빼면 부호가 뒤집혀 **계수가 반대 방향으로 수렴한다.**
- **7-7절 사후 진단 게이트**: 편차비 진단은 **파단면 실측이 있는 회차에만**
  연다. 예측 편차비 `1 + k2·m(ρ)/t_abs` 의 t_abs는 사용자가 입력한 비중의
  함수이므로, 실측 없이 진단하면 결론은 "당신이 낮은 비중을 입력했습니다"뿐이다.
  분포 모델이 없는 시유 방법에서도 닫는다(편차비가 항상 1인 것은 관측이 아니다).

## ③ 출력

- `CalibrationResult` — `k1` / `rho_dry`(미동정 시 `None`) · 잔차 RMS[mm] ·
  표본 수 · `notes` · **`solid` / `dashed`**. 실선은 이번 결과로 실제 동정된
  것만(k1, ρ_dry), 점선은 언제나 k2 · Stull 경계 · 안전 두께 범위 · 위험 분기
  우선순위 4종이며 각각의 점선 사유가 `notes` 에 따라 나간다(10-2절).
  `areal_slope` 는 ρ_dry 가정과 무관한 불변량 `C` 다.
- `CoefficientTable`(새 객체) — `update_after_run` 은 frozen dataclass를 새로
  만들어 k1과 `calibration_runs` 만 올리고 **동정되지 않은 계수는 `None` 으로
  남긴다.** "아직 동정 안 됨"과 "0"은 다른 진술이다. 갱신 사유·가정을 함께
  보려면 `run_update` → `RunUpdate`.
- `RecalibrationTrigger` — 트리거 여부와 사유 문장.
- `DeviationDiagnosis` — `available` 이 False면 나머지는 전부 `None` 이다
  (8-2절 「판정 불가」와 같은 태도: 모를 때 '이상 없음'으로 내리지 않는다).
  열렸을 때는 예측 편차비 · 실측 편차비 · 단위 일치 잔차를 함께 낸다.

## ④ 차이

부록 D: 이 모듈이 주장하는 것은 **동정 절차 하나**다 — "저울 두 번으로 k1이
좁혀지고, 캘리퍼 1회로 ρ_dry가 닫힌다." 10-2절이 못 박은 대로 *그것만*
주장하면 반박당하지 않는다. 선행 대비 위치는 (a) 저울과 캘리퍼라는 **가정용
계측기 2종만으로** 파괴·소성 없이 계수를 동정하는 절차를 개시한 점,
(b) 무엇이 식별되고 무엇이 곱으로 붙어 식별되지 않는지를 코드가 구분해
**식별 불가를 `None` 으로 출력**하는 점, (c) 신호 획득 비용에 따라 실선/점선을
가르는 표기 규약을 자료형(`solid`/`dashed`)에 실은 점이다. 조성 계산기·상용
컨트롤러는 계수를 상수로 박아두거나 아예 노출하지 않는다.

## Phase 5 — 레시피별 계수 계열 · 합성 narrowing 시연

LLM 프런트도어 TODO Phase 5("Optimization Model — 학습 루프, 화면 8~9")가
이 모듈에 추가한 것은 두 파일뿐이다.

- **`registry.py` — `CoefficientTableStore`**: `recipe_id -> CoefficientTable`
  딕셔너리 하나. 처음 보는 `recipe_id`는 모든 계수가 미동정인 새
  `CoefficientTable`을 받고, 그 갱신은 그 레시피의 항목만 바꾼다. 새 물리는
  없다 — `apply_run_update`는 이 파일이 아니라 `update.run_update`를 그대로
  부른다. 존재 이유는 딱 하나, **레시피 A의 회차가 레시피 B의 k1을 조용히
  움직이지 않는다는 격리 보증**이다.
- **`demo_convergence.py` — `run_convergence_demo`**: LLM 프런트도어 TODO
  체크리스트 문구가 시키는 "v5/v7 더미 20회차 수렴" 방식은 그대로 재사용하지
  않는다 — `docs/DECISIONS.md` §12-2 · `docs/kiln-plan-v7.md` 부록 E가 이미
  "생성기와 추정 모델이 같으면 어떤 수렴도 자명하다"며 폐기했다. 대신
  `kiln.firing.simulator.KilnSimulator`와 같은 원칙으로, `run_update`(√t만
  보는 추정 모델)와 **구조적으로 다른** 생성기(√t + 담금시간에 선형인
  크러스트 항 + 저울·비중 잡음)를 만들어 20회차를 굴린다. 결과는 "k1이
  참값에 수렴했다"가 아니라 **"앞 5회차 대비 뒤 5회차 평균 gap이 X% 줄고,
  크러스트 항이 만드는 편향 Y%가 남는다"**로 낸다(`ConvergenceDemoResult`).
  `synthetic_target_k1`은 생성기 내부 허구값이고 부록 C 문헌값(k1=0.55)과
  일부러 다르게 두었다 — "대장 초기값을 그대로 돌려받았다"는 우연과 섞이지
  않기 위해서다. **UI 화면은 만들지 않았다** — 이 시연은 `kiln.calibration`
  파이썬 단독이고, 화면 8~9절 표시는 이 함수의 출력을 그대로 붙이면 된다는
  확인까지만 한다.
- **Prediction Model(프런트엔드 `app/react/aice/predictionModel.ts`)과의
  연결 — v9 후속으로 실제 결선됨, 이 문단은 그 최종 배선을 기록한다**:
  `predictNextRun`의 `priorRunCount`는 **`CoefficientTableStore.calibration_runs`
  (이 모듈, 두께 계수 k1·k2·ρ_dry 캘리브레이션)를 읽지 않는다.** 그
  캘리브레이션은 파단면 실측 제출 화면을 의도적으로 만들지 않았으므로
  (MVP 스코프, `submit_calibration_run` 엔드포인트는 있으나 어떤 화면도
  호출하지 않는다) `calibration_runs`가 영원히 0으로 남는 죽은 카운터이기
  때문이다 — 그 값을 그대로 이어받으면 `predictNextRun`의
  `historyDamping`("회차가 쌓일수록 보정폭을 줄인다")이 실행 횟수와
  무관하게 항상 최대 폭으로 고정된다. 대신 `kiln.calibration.firing
  .FiringCoefficientTable.calibration_runs`(`GET /aice/calibration
  /{recipe_id}`의 `firing_calibration_runs`)를 쓴다 — 이 레시피로 평가
  완료되고 목표·실제 광택이 둘 다 기록된 회차 수이며, 별도 제출 화면
  없이 회차 저장 시점에 자동으로 늘어난다(`_index_firing_calibration_
  best_effort`). TS 예측기와 이 모듈의 파이썬 갱신 루프가 "같은 것"이라는
  주장은 아니다 — `predictNextRun`은 지금도 기물 크기·레시피 소성범위·
  회차 수로 계산하는 **결정론적 합성 규칙**이고 이 모듈의 `CoefficientTable`
  을 전혀 읽지 않는다.

## 결합 효과

`kiln.thickness` 가 쓰는 k1·ρ_dry가 여기서 좁혀지고, ρ_dry가 좁혀지는 만큼
`kiln.risk` 의 08절 안전창 판정이 제자리를 찾는다 — 7-2절이 보인 대로
**ρ_dry 하나로 안전창(0.8–1.3mm)이 한 칸 통째로 이동하기** 때문에, 이 모듈이
없으면 위험 판정 전체가 문헌 추정값 위에 떠 있게 된다. 회차가 쌓여 안쪽
루프(두께)가 통제되면 그때서야 바깥 루프(`kiln.search`)의 조성 ±2%p 신호가
잡음 밖으로 나온다(03절). 반대로 이 모듈이 좁히지 *못하는* 것들(k2·s·Stull
경계·안전 범위)은 점선으로 계속 남아, 그 위에 세운 판정이 어디까지
불확실한지가 화면과 보고서에 그대로 드러난다.
