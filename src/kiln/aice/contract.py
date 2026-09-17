"""프런트엔드·API·DB가 공유하는 AiceRun v2 계약.

값의 출처를 값과 분리하지 않고, 근거가 없는 값은 ``None``으로 유지한다.
실제 품질이나 실제 가마 제어를 표현하는 계약이 아니다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

AICE_SCHEMA_VERSION = 2
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
    preset: Literal["fast", "balanced", "stable"]
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

    def __post_init__(self) -> None:
        if self.schema_version != AICE_SCHEMA_VERSION:
            raise ValueError("AiceRun schema_version은 2여야 합니다")
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
        thickness_data = dict(data["thickness"]); thickness_data["mean"] = sourced(thickness_data["mean"]); thickness_data["uncertainty"] = sourced(thickness_data["uncertainty"])
        loading_data = dict(data["loading"]); loading_data["sensors"] = tuple(loading_data.get("sensors", ()))
        curve_data = dict(data["curves"]); curve_data["baseline"] = FiringCurve(**{**curve_data["baseline"], "points": tuple(curve_data["baseline"].get("points", ())) }); curve_data["candidates"] = tuple(FiringCurve(**{**item, "points": tuple(item.get("points", ()))}) for item in curve_data.get("candidates", ()))
        pid_data = dict(data["pid"]); pid_data["parameters"] = {key: sourced(value) for key, value in pid_data.get("parameters", {}).items()}; pid_data["samples"] = tuple(pid_data.get("samples", ())); pid_data["alarms"] = tuple(pid_data.get("alarms", ()))
        result_data = dict(data["result"]); result_data["photo"] = PhotoAsset(**result_data["photo"]) if result_data.get("photo") else None; result_data["defects"] = tuple(result_data.get("defects", ()))
        return cls(run_id=data["run_id"], revision=data["revision"], title=data["title"], status=data["status"], goal=Goal(**data["goal"]), recipe=RecipeSelection(**recipe_data), ware=WareSelection(**data["ware"]), application=ApplicationRecord(**app_data), thickness=ThicknessEstimate(**thickness_data), loading=LoadingPlan(**loading_data), curves=CurveBundle(**curve_data), pid=PidExecution(**pid_data), result=ResultEvaluation(**result_data), sources=tuple(SourceReference(**item) for item in data["sources"]), consent=Consent(**data["consent"]), versions=ModelVersions(**data["versions"]), created_at=data["created_at"], updated_at=data["updated_at"], schema_version=data.get("schema_version", 0))


def sample_aice_run(now: str = "2026-09-16T00:00:00+00:00") -> AiceRun:
    """모든 경계를 왕복 검증할 결정적 합성 샘플을 만든다."""
    syn = lambda value, unit, note: SourcedValue(value, unit, "synthetic", .5, note)
    inf = lambda value, unit, note: SourcedValue(value, unit, "inferred", 0 if value is None else .6, note)
    curve = lambda ident, role: FiringCurve(ident, role, ({"minute": 0.0, "temperature_c": 20.0}, {"minute": 480.0, "temperature_c": 1220.0}), "synthetic", "설명용 가상 계획")
    return AiceRun(run_id="sample-aice-run", revision=1, title="사틴 청색 사발 샘플", status="simulated", goal=Goal("satin", "opaque", "#668594", "smooth"), recipe=RecipeSelection("coastal-satin", "해안 사틴 01", PhotoAsset("recipe-placeholder", "recipe", None, True, "synthetic", True, "실물 사진이 아닌 플레이스홀더"), SourcedValue((1180, 1230), "°C", "literature", .4, "문헌 범위"), ("literature-firing-range",)), ware=WareSelection("bowl", "white-stoneware", "medium", "both", "inferred"), application=ApplicationRecord("dipping", inf(None, "g", "관측하지 않음"), inf(None, "g", "관측하지 않음"), inf(None, "g/mL", "관측하지 않음")), thickness=ThicknessEstimate(inf(None, "mm", "판정 불가"), "shape_based", syn((.7, 1.4), "relative", "형상 기반 가상 분포"), "두께 표현은 과장됨"), loading=LoadingPlan("virtual-electric-kiln", "three", tuple({"id": name, "height_ratio": ratio, "temperature": asdict(syn(None, "°C", "가상 소성 전"))} for name, ratio in (("top", 1.0), ("middle", .5), ("bottom", 0.0)))), curves=CurveBundle(curve("baseline", "baseline"), (curve("candidate-balanced", "candidate"),), "candidate-balanced"), pid=PidExecution("balanced", "feedforward_p", {}, (), ()), result=ResultEvaluation(None, None, None, None, None, (), None), sources=(SourceReference("literature", "kiln-plan-v7", "실물 가마 정확도와 품질을 보장하지 않음", "medium", locator="12절"),), consent=Consent(False, False, False, False, None), versions=ModelVersions("aice-sample-1", "rule-rank-1", "kiln-simulator-0.7", None), created_at=now, updated_at=now)


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
