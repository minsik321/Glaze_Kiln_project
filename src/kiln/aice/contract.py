"""프런트엔드·API·DB가 공유하는 AiceRun v2 계약.

값의 출처를 값과 분리하지 않고, 근거가 없는 값은 ``None``으로 유지한다.
실제 품질이나 실제 가마 제어를 표현하는 계약이 아니다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

AICE_SCHEMA_VERSION = 3
SOURCE_TYPES = ("observed", "patent_example", "patent_range", "literature", "inferred", "synthetic")
SourceType = Literal["observed", "patent_example", "patent_range", "literature", "inferred", "synthetic"]


def _source(value: str) -> SourceType:
    if value not in SOURCE_TYPES:
        raise ValueError(f"지원하지 않는 source_type: {value}")
    return value  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class SourcedValue:
    value: Any
    unit: str
    source_type: SourceType
    confidence: float | None
    note: str

    def __post_init__(self) -> None:
        _source(self.source_type)
        if not self.unit:
            raise ValueError("unit은 비어 있을 수 없습니다")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("confidence는 0..1이어야 합니다")


@dataclass(frozen=True, slots=True)
class SourceReference:
    source_type: SourceType
    reference: str
    limitation: str
    confidence: Literal["low", "medium", "high"]
    locator: str | None = None
    original_condition: str | None = None
    conversion: str | None = None
    interpretation: str | None = None

    def __post_init__(self) -> None:
        _source(self.source_type)
        if not self.reference or not self.limitation:
            raise ValueError("출처와 적용 한계는 필수입니다")


@dataclass(frozen=True, slots=True)
class PhotoAsset:
    id: str
    kind: Literal["recipe", "result"]
    storage_path: str | None
    placeholder: bool
    source_type: SourceType
    rights_confirmed: bool
    alt: str

    def __post_init__(self) -> None:
        _source(self.source_type)
        if self.storage_path and not self.rights_confirmed:
            raise ValueError("사진 파일은 권리 확인 없이 연결할 수 없습니다")


@dataclass(frozen=True, slots=True)
class Goal:
    gloss: str
    transparency: str
    color: str
    texture: str


@dataclass(frozen=True, slots=True)
class RecipeSelection:
    id: str
    name: str
    photo: PhotoAsset
    firing_range: SourcedValue
    source_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RecipeCandidate:
    """RAG가 제안한 레시피 후보 1개 (화면 1, LLM 프런트도어 TODO Phase 1).

    아직 확정되지 않은 상태를 표현한다. ``materials`` 는
    :class:`kiln.domain.models.GlazeRecipe` 와 같은 모양(원료명 → 중량%)이다
    — UMF는 저장하지 않고 필요할 때 :mod:`kiln.chem` 으로 다시 계산한다
    (원료 DB 갱신 시 저장된 UMF가 조용히 낡는 것을 피하기 위해서다).
    """

    id: str
    name: str
    materials: dict[str, float]
    predicted_firing_range: SourcedValue
    predicted_firing_note: str
    photo: PhotoAsset
    source_type: SourceType
    source_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        _source(self.source_type)
        if not self.materials:
            raise ValueError("후보 레시피에 원료가 없습니다")


@dataclass(frozen=True, slots=True)
class RecipeCandidateSet:
    """화면 1의 레시피 후보 묶음과 선택 상태.

    :class:`RecipeSelection`(단일·이미 확정된 레시피 1개)과는 다른 타입이다 —
    화면 1은 후보 중 아직 고르기 전 상태를 표현해야 하므로 RecipeSelection을
    억지로 리스트로 바꾸지 않는다. 선택 시 :meth:`select` 로만
    RecipeSelection에 이어진다.
    """

    candidates: tuple[RecipeCandidate, ...]
    selected_id: str | None = None

    def __post_init__(self) -> None:
        ids = [c.id for c in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("후보 id는 중복될 수 없습니다")
        if self.selected_id is not None and self.selected_id not in ids:
            raise ValueError("선택 id는 후보 목록에 있어야 합니다")

    def select(self, candidate_id: str) -> RecipeSelection:
        """선택된 후보를 RecipeSelection으로 전환한다."""
        chosen = next((c for c in self.candidates if c.id == candidate_id), None)
        if chosen is None:
            raise ValueError(f"후보 목록에 없는 id: {candidate_id}")
        return RecipeSelection(
            id=chosen.id,
            name=chosen.name,
            photo=chosen.photo,
            firing_range=chosen.predicted_firing_range,
            source_ids=chosen.source_ids,
        )


@dataclass(frozen=True, slots=True)
class WareSelection:
    preset: str
    clay_body: str
    size_category: str
    glazing: str
    geometry_source: SourceType

    def __post_init__(self) -> None:
        _source(self.geometry_source)


@dataclass(frozen=True, slots=True)
class ApplicationRecord:
    method: str
    before_weight: SourcedValue
    after_weight: SourcedValue
    density: SourcedValue


@dataclass(frozen=True, slots=True)
class ThicknessEstimate:
    mean: SourcedValue
    distribution: Literal["unavailable", "shape_based", "position_observed"]
    uncertainty: SourcedValue
    warning: str
    #: 면적당 시유량 [g/m²] — mean(단위 mm)과 별개 단위의 1급 필드.
    #: ``kiln.thickness.profile.ThicknessProfile.areal_density_g_m2`` 와
    #: 대응한다 (LLM 프런트도어 TODO Phase 1).
    areal_density: SourcedValue


@dataclass(frozen=True, slots=True)
class LoadingPlan:
    kiln_profile_id: str
    sensor_plan: Literal["single", "three", "multi"]
    sensors: tuple[dict[str, Any], ...]


@dataclass(frozen=True, slots=True)
class FiringCurve:
    id: str
    role: Literal["baseline", "candidate", "selected", "actual", "next"]
    points: tuple[dict[str, float], ...]
    source_type: SourceType
    reason: str

    def __post_init__(self) -> None:
        _source(self.source_type)


@dataclass(frozen=True, slots=True)
class CurveBundle:
    baseline: FiringCurve
    candidates: tuple[FiringCurve, ...]
    selected_id: str | None

    def __post_init__(self) -> None:
        ids = {curve.id for curve in self.candidates}
        if self.selected_id is not None and self.selected_id not in ids:
            raise ValueError("선택 곡선은 후보 목록에 있어야 합니다")


@dataclass(frozen=True, slots=True)
class PidExecution:
    """가상 제어 실행 기록 (LLM 프런트도어 TODO Phase 3).

    v2에는 사용자에게 "빠른 반응/균형/안정 우선" 같은 이름 붙은 제어
    프리셋을 고르게 하는 ``preset`` 필드가 있었다. 이름 붙은 프리셋은
    실제 가마 튜닝이 아닌 설명용 합성 게인 3벌을 마치 성격이 다른 제품
    옵션인 것처럼 보이게 했다(v9 각주 §2-1, 화면 3 설명형 UI 제거 대상).
    v3은 사용자에게 이진 결정(``decision``: 이대로 진행/다시 추천)만
    노출한다 — 실제로 어떤 게인이 쓰였는지는 ``parameters``에 이미
    수치로 남아 있으므로, 이름표를 따로 둘 필요가 없다.
    """

    #: 사용자가 실제로 내린 결정. 내부적으로 어떤 게인 후보가 쓰였는지는
    #: ``parameters``의 수치가 그대로 기록이다 — 별도 "프리셋 이름"을
    #: 다시 붙이지 않는다.
    decision: Literal["accepted", "regenerate"]
    controller_kind: Literal["feedforward_p", "pid"]
    parameters: dict[str, SourcedValue]
    samples: tuple[dict[str, float], ...]
    alarms: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ResultEvaluation:
    photo: PhotoAsset | None
    color: str | None
    gloss: str | None
    texture: str | None
    transparency: str | None
    defects: tuple[str, ...]
    feedback_scope: Literal["personal", "common_candidate"] | None


@dataclass(frozen=True, slots=True)
class Consent:
    share_allowed: bool
    photo_rights_confirmed: bool
    pii_reviewed: bool
    location_removed: bool
    withdrawn_at: str | None

    @property
    def active_public_consent(self) -> bool:
        return self.share_allowed and self.photo_rights_confirmed and self.pii_reviewed and self.location_removed and self.withdrawn_at is None


@dataclass(frozen=True, slots=True)
class ModelVersions:
    data: str
    rule_model: str
    simulator: str
    predictor: str | None


@dataclass(frozen=True, slots=True)
class ChatIntake:
    """화면 1(LLM 채팅) 입력·출력 기록 (LLM 프런트도어 TODO Phase 1).

    자연어 원문과 첨부 이미지는 사용자가 넣은 그대로 보존하고, 후보와 선택
    상태는 RecipeCandidateSet 한 곳에만 둔다 — 같은 정보를 두 번 다른
    모양으로 들고 있지 않는다. 채팅에서 시작하지 않은 실행(예: 레거시
    변환)은 이 필드가 None이다.
    """

    prompt_text: str
    prompt_photos: tuple[PhotoAsset, ...]
    candidates: RecipeCandidateSet


@dataclass(frozen=True, slots=True)
class AiceRun:
    run_id: str
    revision: int
    title: str
    status: Literal["draft", "simulated", "evaluated"]
    goal: Goal
    recipe: RecipeSelection
    ware: WareSelection
    application: ApplicationRecord
    thickness: ThicknessEstimate
    loading: LoadingPlan
    curves: CurveBundle
    pid: PidExecution
    result: ResultEvaluation
    sources: tuple[SourceReference, ...]
    consent: Consent
    versions: ModelVersions
    created_at: str
    updated_at: str
    schema_version: int = AICE_SCHEMA_VERSION
    #: 화면 1(LLM 채팅) 입력·출력 기록. 채팅에서 시작하지 않은 실행(레거시
    #: 변환 등)은 None (LLM 프런트도어 TODO Phase 1).
    intake: ChatIntake | None = None

    def __post_init__(self) -> None:
        if self.schema_version != AICE_SCHEMA_VERSION:
            raise ValueError(f"AiceRun schema_version은 {AICE_SCHEMA_VERSION}이어야 합니다")
        if self.revision < 1:
            raise ValueError("revision은 1 이상이어야 합니다")
        if not self.sources:
            raise ValueError("최소 하나의 출처가 필요합니다")

    def to_dict(self) -> dict[str, Any]:
        """JSON 직렬화 가능한 사전을 반환한다."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AiceRun":
        """중첩 사전을 검증해 AiceRun으로 복원한다."""
        def sourced(value: dict[str, Any]) -> SourcedValue:
            normalized = dict(value)
            if isinstance(normalized.get("value"), list):
                normalized["value"] = tuple(normalized["value"])
            return SourcedValue(**normalized)
        recipe_data = dict(data["recipe"]); recipe_data["photo"] = PhotoAsset(**recipe_data["photo"]); recipe_data["firing_range"] = sourced(recipe_data["firing_range"]); recipe_data["source_ids"] = tuple(recipe_data.get("source_ids", ()))
        app_data = dict(data["application"])
        for key in ("before_weight", "after_weight", "density"): app_data[key] = sourced(app_data[key])
        thickness_data = dict(data["thickness"]); thickness_data["mean"] = sourced(thickness_data["mean"]); thickness_data["uncertainty"] = sourced(thickness_data["uncertainty"]); thickness_data["areal_density"] = sourced(thickness_data["areal_density"])
        loading_data = dict(data["loading"]); loading_data["sensors"] = tuple(loading_data.get("sensors", ()))
        curve_data = dict(data["curves"]); curve_data["baseline"] = FiringCurve(**{**curve_data["baseline"], "points": tuple(curve_data["baseline"].get("points", ())) }); curve_data["candidates"] = tuple(FiringCurve(**{**item, "points": tuple(item.get("points", ()))}) for item in curve_data.get("candidates", ()))
        pid_data = dict(data["pid"]); pid_data["parameters"] = {key: sourced(value) for key, value in pid_data.get("parameters", {}).items()}; pid_data["samples"] = tuple(pid_data.get("samples", ())); pid_data["alarms"] = tuple(pid_data.get("alarms", ()))
        result_data = dict(data["result"]); result_data["photo"] = PhotoAsset(**result_data["photo"]) if result_data.get("photo") else None; result_data["defects"] = tuple(result_data.get("defects", ()))
        intake_data = data.get("intake")
        if intake_data is not None:
            intake_data = dict(intake_data)
            intake_data["prompt_photos"] = tuple(PhotoAsset(**p) for p in intake_data.get("prompt_photos", ()))
            candidates_data = dict(intake_data["candidates"])
            candidates_data["candidates"] = tuple(
                RecipeCandidate(**{
                    **c,
                    "photo": PhotoAsset(**c["photo"]),
                    "predicted_firing_range": sourced(c["predicted_firing_range"]),
                    "source_ids": tuple(c.get("source_ids", ())),
                })
                for c in candidates_data.get("candidates", ())
            )
            intake_data["candidates"] = RecipeCandidateSet(**candidates_data)
            intake = ChatIntake(**intake_data)
        else:
            intake = None
        return cls(run_id=data["run_id"], revision=data["revision"], title=data["title"], status=data["status"], goal=Goal(**data["goal"]), recipe=RecipeSelection(**recipe_data), ware=WareSelection(**data["ware"]), application=ApplicationRecord(**app_data), thickness=ThicknessEstimate(**thickness_data), loading=LoadingPlan(**loading_data), curves=CurveBundle(**curve_data), pid=PidExecution(**pid_data), result=ResultEvaluation(**result_data), sources=tuple(SourceReference(**item) for item in data["sources"]), consent=Consent(**data["consent"]), versions=ModelVersions(**data["versions"]), created_at=data["created_at"], updated_at=data["updated_at"], schema_version=data.get("schema_version", 0), intake=intake)


def sample_aice_run(now: str = "2026-09-16T00:00:00+00:00") -> AiceRun:
    """모든 경계를 왕복 검증할 결정적 합성 샘플을 만든다."""
    syn = lambda value, unit, note: SourcedValue(value, unit, "synthetic", .5, note)
    inf = lambda value, unit, note: SourcedValue(value, unit, "inferred", 0 if value is None else .6, note)
    curve = lambda ident, role: FiringCurve(ident, role, ({"minute": 0.0, "temperature_c": 20.0}, {"minute": 480.0, "temperature_c": 1220.0}), "synthetic", "설명용 가상 계획")
    candidate = lambda ident, name: RecipeCandidate(
        ident, name, {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0},
        SourcedValue((1180, 1230), "°C", "synthetic", .5, "LLM 추정, 검증 전"),
        "환원 소성, cone 6~8 가정",
        PhotoAsset(f"{ident}-photo", "recipe", None, True, "synthetic", True, "실물 사진이 아닌 플레이스홀더"),
        "synthetic", (),
    )
    intake = ChatIntake(
        "사발에 어울리는 청록색 사틴 유약을 찾고 있어요", (),
        RecipeCandidateSet((candidate("cand-1", "후보 1"), candidate("cand-2", "후보 2")), "cand-1"),
    )
    return AiceRun(run_id="sample-aice-run", revision=1, title="사틴 청색 사발 샘플", status="simulated", goal=Goal("satin", "opaque", "#668594", "smooth"), recipe=RecipeSelection("coastal-satin", "해안 사틴 01", PhotoAsset("recipe-placeholder", "recipe", None, True, "synthetic", True, "실물 사진이 아닌 플레이스홀더"), SourcedValue((1180, 1230), "°C", "literature", .4, "문헌 범위"), ("literature-firing-range",)), ware=WareSelection("bowl", "white-stoneware", "medium", "both", "inferred"), application=ApplicationRecord("dipping", inf(None, "g", "관측하지 않음"), inf(None, "g", "관측하지 않음"), inf(None, "g/mL", "관측하지 않음")), thickness=ThicknessEstimate(inf(None, "mm", "판정 불가"), "shape_based", syn((.7, 1.4), "relative", "형상 기반 가상 분포"), "두께 표현은 과장됨", inf(None, "g/m²", "판정 불가")), loading=LoadingPlan("virtual-electric-kiln", "three", tuple({"id": name, "height_ratio": ratio, "temperature": asdict(syn(None, "°C", "가상 소성 전"))} for name, ratio in (("top", 1.0), ("middle", .5), ("bottom", 0.0)))), curves=CurveBundle(curve("baseline", "baseline"), (curve("candidate-balanced", "candidate"),), "candidate-balanced"), pid=PidExecution("accepted", "feedforward_p", {}, (), ()), result=ResultEvaluation(None, None, None, None, None, (), None), sources=(SourceReference("literature", "kiln-plan-v7", "실물 가마 정확도와 품질을 보장하지 않음", "medium", locator="12절"),), consent=Consent(False, False, False, False, None), versions=ModelVersions("aice-sample-1", "rule-rank-1", "kiln-simulator-0.7", None), created_at=now, updated_at=now, intake=intake)


def legacy_to_aice_run(record: dict[str, Any]) -> AiceRun:
    """work_records v1을 읽기 전용 AiceRun v2로 올린다."""
    now = record.get("created_at") or datetime.fromtimestamp(0, timezone.utc).isoformat()
    run = sample_aice_run(now)
    data = run.to_dict(); data.update(run_id=record.get("id", "legacy-record"), title=(record.get("title") or "이전 작업 기록").strip(), status="draft", updated_at=record.get("updated_at") or now)
    data["sources"] = (*data["sources"], asdict(SourceReference("inferred", "work_records schema v1", "직접 매핑되지 않은 필드는 관측값이 아님", "low")))
    return AiceRun.from_dict(data)


def aice_run_to_legacy(run: AiceRun) -> dict[str, Any]:
    """v1 소비자가 보관할 수 있는 읽기 전용 호환 레코드를 만든다."""
    return {"title": run.title, "schema_version": 1, "is_public": False, "payload": {"aice_run": run.to_dict(), "compatibility": "read_only", "original_schema_version": AICE_SCHEMA_VERSION}}
