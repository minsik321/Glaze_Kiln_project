# 모듈 간 계약

모듈을 병렬로 구현하기 위해 **경계 자료형과 시그니처만** 여기에 고정한다.
이 문서에 적힌 이름·인자·반환형은 구현자가 바꿀 수 없다. 내부 구조는 자유다.

의존 방향은 한 방향이며 순환하지 않는다:

```
constants ─┐
domain ────┼─→ chem ────→ search
           ├─→ batch ───→ thickness ─→ risk
           │                  └───────→ calibration
           └─→ firing ──→ exchange

webapp ─── 위 전부에 의존한다 (UI 경계. 계산하지 않고 직렬화만 한다)
```

---

## kiln.constants (구현 완료)

```python
class Provenance(Enum):
    UNDETERMINED | LITERATURE | CONVENTION | CALIBRATED | USER
    .is_trustworthy -> bool

@dataclass(frozen=True, slots=True)
class Coefficient:
    symbol, definition, dimension, identification, provenance
    .value -> float            # 미정이면 UndeterminedCoefficientError
    .is_determined -> bool
    .lower, .upper -> float | None
    .assume(value, reason) -> Coefficient      # provenance는 UNDETERMINED 유지
    .calibrated(value, source) -> Coefficient  # provenance -> CALIBRATED
    .annotation() -> str                       # "(문헌 추정 초기값 · 캘리브레이션 전)"

class UndeterminedCoefficientError(RuntimeError)

REGISTRY: dict[str, Coefficient]
get(symbol: str) -> Coefficient
```

등록된 기호: `k1 absorption k2 m_rho g_rho rho_dry s E alpha beta Kh UA
sensor_offset kaolin_background bentonite_fixed`

**미정(값 없음)**: `E alpha beta Kh sensor_offset` — 이들의 `.value` 는 던진다.
값이 필요하면 `.assume(v, 사유)` 로 가정을 명시하고, 그 사실을 결과의
`provenance_notes` 에 남긴다.

## kiln.domain (구현 완료)

`enums.py`: `OrdinalAxis`(기반), `Gloss`(5단계), `Transparency`(4단계),
`Grade`, `FailureType`, `GlazingMethod`, `RiskType`, `RiskLevel`.

- 순서형 축은 `.level:int`, `.label:str`, `.distance(other)->int`, `.span()->int`,
  `.from_level(int)`.
- `GlazingMethod.has_distribution_model -> bool` (담금만 True)
- `RiskType.needs_distribution -> bool` (흘러내림·응력균열만 True)
- `RiskLevel.UNAVAILABLE.level == -1`, `.is_actionable -> bool`

`models.py`: `TargetCoordinate GlazeRecipe Batch DensityMeasurement WareShape
Ware GlazingRecord CoolingSegment FiringResult FiringRun KilnProfile
CoefficientTable SearchState`, 상수 `QUARTZ_INVERSION_C`

주요 접근자:
- `TargetCoordinate.distance(other, w_gloss=1.0, w_transparency=1.0) -> float`
- `GlazeRecipe.materials: dict[str, float]` (합 100%)
- `WareShape.profile: tuple[tuple[float, float], ...]` — 굽(z=0)→구연부 `(z, r)` [mm]
- `WareShape.h_max -> float`
- `GlazingRecord.glaze_weight -> float` (W [g]), `.within_model_scope -> bool`
- `GlazingRecord.waxed_area_m2`, `.dip_seconds`, `.density`, `.method`
- `KilnProfile.natural_cooling_rate(temp_c) -> float` [℃/h].
  `ambient_c`(기본 20.0)와 `baseline_power_w` 를 함께 들고 있다 — 자연냉각률
  역산과 9-6절 서냉 비용이 **같은** 주위 온도를 써야 표와 어긋나지 않고,
  9-2절 총량 이상 감지는 회차마다 빈 가마 기준 유지전력을 필요로 한다.
- `CoolingSegment(from_c, to_c, rate_c_per_h, purpose)` 는 **도메인에 있다**.
  냉각은 H로 접히지 않고 회차에 귀속되는 자료이므로(9-4절, 10-3절)
  `FiringRun.cooling` 이 직접 들고 있어야 한다. 판정 로직은 `kiln.firing.cooling`
  에 있고 자료형은 거기서 **그대로 재수출**되므로
  `from kiln.firing.cooling import CoolingSegment` 는 계속 유효하다.
- `FiringRun`: `cooling` · `declared_kg` · `shelf_area_m2` 를 들고 있다.
  설정 스케줄(`schedule`)과 냉각을 **합치지 않는다** — 합치면 급냉/서냉
  구분이 사라진다.
- `FiringRun.ramp_rate_c_per_h: float | None` · `.hold_minutes: float | None`
  — 승온 속도·유지 시간 1급 필드(LLM 프런트도어 TODO Phase 1). 이전에는
  `schedule` 점열의 기울기로만 암묵적으로 존재했다. 값이 없으면 `None`이며
  `schedule`에서 되짚어 지어내지 않는다.
- `FiringResult.fracture_z_mm: float | None` — 파단면을 **어디서** 쟀는가.
  위치가 없으면 그 두께가 국소 최대인지 알 수 없어 "국소 최대의 하한"
  이상으로 읽지 못하고, k₂ 방향 신호가 흐려진다(7-7절). 위치만 있고 두께가
  없으면 `ValueError`.
- `CoefficientTable`: `k1 k2 rho_dry s m_rho` (None이면 대장 초기값),
  `safe_thickness_mm`, `calibration_runs`, 그리고
  `calibrated_bisque_c: float | None` · `provenance_notes: tuple[str, ...]`.
  앞의 것은 7-5절 **재캘리브레이션 트리거**의 근거다(초벌 온도 변경을
  흡수율로 흡수하면 k₁이 조용히 틀어진다). 뒤의 것은 00절 — 값만 나르면
  "가정한 ρ_dry 위에서 낸 k₁"과 "캘리퍼로 닫은 k₁"이 되먹임 경로에서
  구분되지 않는다.

---

## kiln.chem — 04 · 5-1절

```python
# materials.py
@dataclass(frozen=True, slots=True)
class Material:
    name: str
    oxides: dict[str, float]   # 산화물 기호 -> 중량 %
    loi: float = 0.0           # 강열감량 %

MATERIALS: dict[str, Material]   # 최소: 규석, 장석(포타쉬), 석회석, 카올린, 벤토나이트
def material(name: str) -> Material

# umf.py
@dataclass(frozen=True, slots=True)
class UMF:
    fluxes: dict[str, float]        # RO/R2O, 합 1.0으로 정규화
    stabilizers: dict[str, float]   # R2O3
    glass_formers: dict[str, float] # RO2
    @property
    def sio2(self) -> float
    @property
    def al2o3(self) -> float
    @property
    def ratio(self) -> float        # SiO2 : Al2O3

def unity_formula(recipe: GlazeRecipe) -> UMF
def unity_formula_from_materials(materials: dict[str, float]) -> UMF

# stull.py
class StullZone(Enum):  # UNDERFIRED MATTE SEMI_MATTE BRIGHT CRAZING ...
ConePreset = Literal["cone6", "cone11"]

@dataclass(frozen=True, slots=True)
class StullReading:
    zone: StullZone
    sio2: float
    al2o3: float
    cone: str
    provenance_note: str   # 반드시 "(문헌 추정 초기값)"류를 포함

def classify(umf: UMF, cone: ConePreset = "cone11") -> StullReading
```

**규칙**
- 4-3절: Stull은 **판정이 아니라 참조**. `StullReading` 은 질감을 확정하지
  않으며 `provenance_note` 에 문헌 추정임을 반드시 싣는다.
- 판정은 SiO₂:Al₂O₃ 비 1차원이 아니라 **(SiO₂, Al₂O₃) 2차원 영역**으로 한다.
  비 하나로 축약하면 석회석 축이 판정에서 사라진다.
- 콘은 **이산 프리셋(cone6 / cone11)** 만. 연속 슬라이더 금지 — 이동량을
  산출할 함수가 없다.
- 5-1절 검증 가능해야 함: 장석 단독 SiO₂:Al₂O₃ ≈ 5.97, Al₂O₃ UMF 최대 ≈ 1.01,
  카올린 0/10/20/30%에서 비 ≈ 15.19 / 10.26 / 7.63 / 6.00.

---

## kiln.batch — 06절

```python
# density.py
class DensityStatus(Enum): OK | TOO_THICK | TOO_THIN | OUT_OF_RANGE

@dataclass(frozen=True, slots=True)
class DensityAdvice:
    status: DensityStatus
    message: str            # 6-4절 안내 문구
    annotation: str         # "(문헌 추정 초기값 · 캘리브레이션 전)"
    blocks_progress: bool   # 항상 False — 경고가 떠도 진행을 막지 않는다
    remeasure_recommended: bool

def assess_density(m: DensityMeasurement, *, target=(1.40,1.50),
                   settling_limit_min: float = 10.0) -> DensityAdvice

def g_rho(rho: float, *, exponent: float | None = None) -> float   # 흡수 기여
def m_rho(rho: float, *, exponent: float | None = None) -> float   # 흘러내림 기여
```

**규칙**
- 6-4절: 경고가 떠도 **진행을 막지 않는다**. `blocks_progress` 는 항상 False.
- 6-3절: `minutes_since_stirring > settling_limit_min` 이면 재측정 권고.
- `g_rho`/`m_rho` 는 ρ=1.45 부근에서 1.0이 되도록 정규화하고 **단조증가**여야
  한다. 지수 기본값은 `constants.get("g_rho"/"m_rho").value`.

```python
# dip_time.py
@dataclass(frozen=True, slots=True)
class DipRecommendation:
    seconds: float
    predicted_mean_mm: float
    feasible: bool
    reason: str

def recommend_dip_time(target_mm: float, *, rho: float, absorption: float,
                       k1: float | None = None,
                       t_flow_mm: float = 0.0) -> DipRecommendation
```

**규칙**
- 6-1절: **비중을 고정하고 담금시간만 역산한다.** 미지수 둘에 목표 하나면
  해가 무수히 많다.
- `t_dip = ((target - t_flow) / (k1 · absorption · g(ρ)))²`
- **도메인 가드 필수**: `target <= t_flow` 이면 음수 제곱을 만들지 말고
  `feasible=False` 와 사유를 반환한다.

---

## kiln.thickness — 07절

```python
# geometry.py
def surface_area_m2(shape: WareShape, *, exclude_waxed_m2: float = 0.0,
                    include_interior: bool = True) -> float
    """파푸스·굴딘: A = ∫2πr(z)√(1+(dr/dz)²)dz. 반환 단위 m²."""

def wall_angle(shape: WareShape, z: float) -> float
    """θ(z) = arctan(dz/dr) [rad]. 수직벽이면 π/2."""

# profile.py
@dataclass(frozen=True, slots=True)
class ThicknessPoint:
    z: float; radius: float; t_abs: float; t_flow: float
    @property
    def total(self) -> float

@dataclass(frozen=True, slots=True)
class ThicknessProfile:
    points: tuple[ThicknessPoint, ...]
    area_m2: float
    mean_mm: float                    # W/(A·ρ_dry)
    glaze_weight_g: float
    rho_dry: float
    has_distribution: bool            # 담금이 아니면 False
    within_model_scope: bool
    provenance_notes: tuple[str, ...]
    @property
    def local_max_mm(self) -> float   # 분포 없으면 mean_mm
    @property
    def local_min_mm(self) -> float
    @property
    def spread_mm(self) -> float      # local_max - local_min
    @property
    def areal_density_g_m2(self) -> float  # glaze_weight_g / area_m2 (Phase 1)

def compute_profile(record: GlazingRecord, ware: Ware,
                    coeffs: CoefficientTable | None = None) -> ThicknessProfile

def fired_thickness(green_mm: float, s: float | None = None) -> float
    """7-4절: 소성 후 = 생 × s. 파단면 실측과 비교할 때 반드시 거친다."""
```

**규칙**
- 7-2절 **총량 제약**: `∫t(z)dA = W/ρ_dry`. 모양 항(`t_abs + t_flow`)을 먼저
  계산한 뒤 **총량에 맞춰 스케일**한다. `mean_mm` 는 반드시 `W/(A·ρ_dry)` 와
  일치해야 한다(부동소수 오차 내).
- 7-2절 서술을 코드 주석으로 지킬 것: 총량 제약이 보장하는 것은 **내적 정합성**
  이지 실측과의 일치가 아니다. `mean_mm` 는 `ρ_dry` 와 `A` 의 정확도에 직접
  의존하고 `k2` 에는 무관하다.
- 7-5절: `record.method.has_distribution_model` 이 False면 `has_distribution=False`
  로 두고 `points` 를 평균값으로 채운다(부위별 분포를 지어내지 않는다).
- 7-5절: 왁스 면적은 A에서 제외(`record.waxed_area_m2`), 왁스 무게는 시유 전
  무게에 포함되므로 W에서 별도 처리하지 않는다.
- `record.within_model_scope` 가 False면 `provenance_notes` 에 신뢰도 하향 사유.

---

## kiln.risk — 08절

```python
@dataclass(frozen=True, slots=True)
class RiskFinding:
    risk: RiskType
    level: RiskLevel
    detail: str                # "굽에서 12mm 지점 두께 1.72mm"
    annotation: str            # 안전 범위의 출처 병기
    available: bool            # 8-2절: 분포 없으면 False → level=UNAVAILABLE

@dataclass(frozen=True, slots=True)
class ReversalOption:
    name: str                  # 재시유 / 부분 보정 / 적재 조정 / 스케줄 보정 / 그대로 진행
    cost: str                  # "건조 4시간 재소요"
    effect: str                # "가장 확실하나 예측 신뢰도 하향"
    confidence_downgrade: bool

@dataclass(frozen=True, slots=True)
class RiskAssessment:
    findings: tuple[RiskFinding, ...]
    options: tuple[ReversalOption, ...]
    @property
    def worst(self) -> RiskLevel

def assess(profile: ThicknessProfile, *, method: GlazingMethod,
           safe_range_mm: tuple[float, float] = (0.8, 1.3),
           recipe: GlazeRecipe | None = None) -> RiskAssessment
```

**규칙**
- 8-2절: `method.has_distribution_model` 이 False면 흘러내림·응력 균열은
  `available=False`, `level=RiskLevel.UNAVAILABLE`. **위험 '없음'으로 내리지 말 것**
  (거짓 안심).
- 8-3절: 두꺼움이면 **기포 위험과 흘러내림 위험을 둘 다 표시**한다.
  `recipe.failure_mode_hint` 가 있으면 그쪽을 상향한다.
- 8-4절: 어떤 선택지에도 `✓ 안전` 같은 확정 기호를 붙이지 않는다.
  재시유는 `confidence_downgrade=True`, 스케줄 보정은 effect에 "효과 불확실".
- 되돌림 비용을 **반드시** 병기한다.

---

## kiln.firing — 09절

```python
# heatwork.py
R_GAS = 8.314462618

def heat_work(curve: Sequence[tuple[float, float]], E: float) -> float
    """H_s = ∫exp(−E/(R·T_s))dτ. curve는 (시각[s], 센서온도[℃])."""

def equivalent_hold_seconds(h_deficit: float, peak_c: float, E: float) -> float
    """9-5절 Δt_eq = (H_목표 − H_실제)/exp(−E/(R·T_peak))."""

# loading.py
@dataclass(frozen=True, slots=True)
class LoadingCheck:
    packing_ratio: float
    gross_error: bool
    threshold: float
    message: str

def packing_ratio(wares: Sequence[Ware], shelf_area_m2: float) -> float
def check_loading(declared_kg: float, observed_response_w: float,
                  baseline_w: float, *, threshold: float = 0.20) -> LoadingCheck
```
9-2절: 기능 목표는 **총량 이상 감지(gross error detection)** 다.
"적재 오등록 판별"은 주장하지 않는다. 임계는 계통 불확실(≈10%)보다 크게.

```python
# cooling.py
@dataclass(frozen=True, slots=True)
class CoolingSegment:
    from_c: float; to_c: float; rate_c_per_h: float; purpose: str

@dataclass(frozen=True, slots=True)
class CoolingPlan:
    segments: tuple[CoolingSegment, ...]
    feasible: bool
    rejections: tuple[str, ...]
    extra_hours: float
    extra_kwh: float

def plan_cooling(profile: KilnProfile, segments: Sequence[CoolingSegment]) -> CoolingPlan
```
- 9-6절: **자연냉각률이 상한이다.** 요청 냉각률이 상한을 넘으면 거부하고
  `rejections` 에 사유. 전기가마는 서냉만 제어 가능하다.
- 서냉 선택 시 `extra_hours`/`extra_kwh` 병기(08절 되돌림 비용과 같은 원칙).
- **573℃ 석영 전이 구간**은 결정 성장 구간과 목적이 다르므로 별도 세그먼트.

```python
# simulator.py
@dataclass(frozen=True, slots=True)
class Disturbance:
    supply_voltage_pct: float = 0.0   # ±5%
    element_aging_pct: float = 0.0    # −5~15%
    thermocouple_noise_c: float = 0.0
    thermocouple_lag_s: float = 0.0
    load_mismatch_pct: float = 0.0
    wall_lag_s: float = 0.0
    seed: int = 0

@dataclass(frozen=True, slots=True)
class SimStep:
    t: float; sensor_c: float; ware_c: float; power_w: float

class KilnSimulator:
    def __init__(self, profile: KilnProfile, disturbance: Disturbance | None = None)
    def step(self, power_w: float, dt: float) -> SimStep
    def run(self, controller, duration_s: float, dt: float = 1.0) -> list[SimStep]
```
12-2절: **생성기는 추정 모델과 구조적으로 다르게(오지정)** 만든다.
외란은 반드시 주입 가능해야 하고 `seed` 로 재현 가능해야 한다.

```python
# controller.py
class Phase(Enum): RAMP | HOLD | COOL
class OuterMode(Enum): WATCHING | ACTIVE

@dataclass(frozen=True, slots=True)
class ControlDecision:
    power_w: float
    phase: Phase
    outer_mode: OuterMode
    hold_extension_s: float
    message: str

class SegmentedController:
    def __init__(self, profile: KilnProfile, schedule, *, E: float,
                 target_heat_work: float | None = None)
    def decide(self, t: float, sensor_c: float, dt: float) -> ControlDecision
```
- 9-4절 구간별: 승온=감시 / 유지=능동(누적 H_s 추종) / 냉각=**단일 루프**
  (목표 냉각률 궤적 추종, H로 환산하지 않는다).
- 9-5절 모드 전환: 누적 H < 목표의 **1%** 면 `WATCHING`(보정 출력 0),
  이상이면 `ACTIVE`. `e_H = (H목표−H실제)/H목표` 는 **쓰지 말 것** — 앞 80%
  구간에서 0으로 나눈다. 대신 `Δt_eq` 를 초 단위로 낸다.
- 9-2절: 센서 이상(온도 정체·급변) 감지 시 알림 후 **일시 정지**, 사람이
  개입할 때까지 자동 진행 금지.

---

## kiln.search — 05절

```python
# grid.py
def simplex_grid(step_pct: float, components: Sequence[str],
                 *, fixed: dict[str, float] | None = None
                 ) -> list[dict[str, float]]
def refine(center: dict[str, float], step_pct: float,
           components: Sequence[str]) -> list[dict[str, float]]

# objective.py
@dataclass(frozen=True, slots=True)
class Candidate:
    materials: dict[str, float]
    expected_distance: float
    umf_note: str

def objective(target: TargetCoordinate, result: TargetCoordinate,
              w_gloss: float = 1.0, w_transparency: float = 1.0) -> float
def passes_filter(result: FiringResult) -> bool

# prior.py
class Prior:
    def __init__(self, observations=()) -> None
    def update(self, materials: dict[str, float], coord: TargetCoordinate) -> None
    def predict(self, materials: dict[str, float]) -> TargetCoordinate | None
    def weight_of_personal_data(self) -> float   # 회차가 쌓일수록 커진다

def propose(state: SearchState, prior: Prior, n: int = 6) -> list[Candidate]
```
- 5-2절: **격자 간격은 관측 노이즈보다 커야 한다.** 1차 10%p → 2차 5%p → 3차 2%p.
- 5-3절: **소성 조건에 베이지안 최적화를 쓰지 않는다.** 이 모듈은 조성 계층 전용.
- 5-4절: 부수 관측은 d에 넣지 않고 `passes_filter` 로만 쓴다
  (예: "흐름 발생" 시편은 목표 거리와 무관하게 제외).
- 5-5절: 사전분포는 **조성 축에만** 정보를 준다. 소성 축은 개인 데이터로만.
- 5-5절: 축적은 **조성→결과 매핑**으로. 목표별 저장 금지.

---

## kiln.calibration — 7-3 · 10-2절

```python
@dataclass(frozen=True, slots=True)
class TileSample:
    dip_seconds: float; area_m2: float
    glaze_weight_g: float
    caliper_mm: float | None = None

@dataclass(frozen=True, slots=True)
class CalibrationResult:
    k1: float | None
    rho_dry: float | None
    residual_rms: float
    n_samples: int
    notes: tuple[str, ...]
    solid: tuple[str, ...]    # 실선 표기 대상
    dashed: tuple[str, ...]   # 점선 표기 대상
    areal_slope: float | None = None   # C = W/(A·√t) [g/(m²·√s)]

def calibrate_from_tiles(samples: Sequence[TileSample], *, rho: float,
                         absorption: float = 1.0) -> CalibrationResult
def update_after_run(table: CoefficientTable, record: GlazingRecord,
                     ware: Ware) -> CoefficientTable
```
- 7-3절: **저울만으로는 ρ_dry를 식별할 수 없다.** 무게 데이터에서 ρ_dry와
  평균두께는 곱으로 붙어 분리되지 않는다. `caliper_mm` 가 하나도 없으면
  `rho_dry=None` 을 반환하고 사유를 `notes` 에 적는다.
- 7-5절: `update_after_run` 은 `table.calibrated_bisque_c` 와
  `ware.bisque_temperature` 가 다르면 **갱신하지 않는다**. 초벌 온도 변경은
  흡수가 아니라 재캘리브레이션 트리거다.
- 10-2절 실선/점선: `k1`, `rho_dry` 만 **실선**(매 회차·저울만 / 캘리퍼 1회).
  `k2`, Stull 경계, 안전 두께 범위, 위험 분기 우선순위는 **점선**.
- `areal_slope` 는 저울만으로 **실제 식별되는 불변량**
  `C = W/(A·√t) = 1000·ρ_dry·k1·흡수율·g(ρ)` 다. 캘리퍼가 없으면 `k1` 은
  ρ_dry 가정 위에서만 나오고(가정이 X배면 k1은 1/X배) `C` 만 가정과 무관하다.
  7-3절의 "저울만으로는 분리되지 않는다"를 값으로 드러내는 자리이므로
  `k1` 을 조용히 내보내는 대신 이 필드를 함께 낸다.

### Phase 5 추가 — `kiln.calibration.registry` · `kiln.calibration.demo_convergence`

```python
class CoefficientTableStore:
    def get(self, recipe_id: str) -> CoefficientTable
    def put(self, table: CoefficientTable) -> None
    def apply_run_update(self, recipe_id: str, record: GlazingRecord,
                          ware: Ware) -> RunUpdate
    def recipe_ids(self) -> tuple[str, ...]
    def calibration_runs(self, recipe_id: str) -> int

@dataclass(frozen=True, slots=True)
class ConvergenceDemoResult:
    rounds: tuple[ConvergenceRound, ...]
    synthetic_target_k1: float
    mean_gap_first_window: float
    mean_gap_last_window: float
    narrowing_pct: float
    remaining_bias_pct: float
    notes: tuple[str, ...]

def run_convergence_demo(*, seed: int = 20260917, rounds: int = 20,
                          window: int = 5) -> ConvergenceDemoResult
```

- `CoefficientTableStore`: `recipe_id -> CoefficientTable` 딕셔너리. 처음
  보는 `recipe_id`는 모든 계수가 `None`(미동정)인 새 테이블을 받는다.
  레시피 하나의 갱신이 다른 레시피의 항목을 건드리지 않는다는 격리 보증
  하나가 전부다 — 새 물리 모델이 아니다.
- `run_convergence_demo`: v5/v7의 "더미 20회차 수렴"을 재사용하지 않는다
  (`docs/DECISIONS.md` §12-2). `run_update`와 구조적으로 다른(√t + 담금시간
  선형 크러스트 항 + 잡음) 생성기로 20회차를 굴리고, "수렴했다"가 아니라
  앞/뒤 창의 평균 gap narrowing(%)과 남은 편향(%)을 낸다. `seed`로 재현
  가능하다. **UI는 없다** — 파이썬 시연이고 화면 결선은 범위 밖이다.
- Prediction Model(프런트엔드 `predictionModel.ts`)과의 연결은 값 하나뿐이다
  — `CoefficientTableStore.calibration_runs(recipe_id)`가 `priorRunCount`의
  미래 소스다. 이번 변경에 **백엔드 엔드포인트는 포함되지 않는다**; 프런트
  엔드는 여전히 `priorRunCount=0`을 하드코딩한다(`AicePrototype.tsx`).

---

## kiln.exchange — 10-3절

```python
@dataclass(frozen=True, slots=True)
class Prescription:
    heat_work_target: float               # H_s (승온·유지)
    peak_c: float
    cooling: tuple[CoolingSegment, ...]   # 냉각은 온도–시간 그대로. H에 합산 금지
    E_assumed: float
    provenance_notes: tuple[str, ...]

@dataclass(frozen=True, slots=True)
class TransformResult:
    schedule: tuple[tuple[float, float], ...] | None
    feasible: bool
    reasons: tuple[str, ...]

def issue(run: FiringRun, *, E: float, peak_c: float,
          cooling: Sequence[CoolingSegment]) -> Prescription
def transform(p: Prescription, target: KilnProfile) -> TransformResult
```
- 10-3절: 대비축은 온도곡선/열일곡선이 아니라 **설정 스케줄 / 달성 열이력**이다.
  E가 주어지면 H(t)와 T(t)는 일대일 변환이므로 정보량이 같다.
- 공유 단위는 **H_s(승온·유지) + 냉각 온도 곡선**. 냉각은 분리한다.
- **변환은 비대칭이다**: 대상 가마의 자연냉각률이 원본보다 느리면 재현 불가 →
  `feasible=False` 와 사유. 서냉은 이식 가능하고 급냉은 아닐 수 있다.

---

## 공통 규칙

1. **00절을 코드가 지킨다.** 계수 값을 주장하지 않는다. 문헌 추정값을 쓸 때는
   반환 자료형의 `annotation` / `provenance_notes` 에 출처가 실려 나가야 한다.
2. 순수 stdlib. 서드파티 금지(테스트의 pytest 제외).
3. 모든 공개 함수에 한국어 docstring. 기획서 절 번호를 인용한다.
4. 모듈마다 `CLAUDE.md` 를 쓴다 — 부록 D의 고정 4항목
   (① 입력 ② 처리 ③ 출력 ④ 차이) 형식.
5. 테스트는 `tests/<module>/test_*.py`. 기획서에 **수치가 적힌 것은 그 수치로**
   회귀 테스트를 건다 (예: 5-1절 카올린 표, 9-5절 H 누적 비율,
   9-6절 자연냉각률, 7-2절 ρ_dry 감도).
