"""브라우저 UI와 계산 엔진 사이의 얇은 경계.

이 모듈은 **계산을 하지 않는다.** 09개 모듈이 낸 결과를 JSON으로 직렬화
가능한 형태(dict·list·숫자·문자열)로 옮기는 일만 한다. 브라우저에서
Pyodide가 `kiln` 패키지를 그대로 돌리므로 계산 로직이 JS로 재구현되지
않는다 — 두 구현이 갈라지면 이 저장소의 전제(기획서가 코드보다 위에 있다)가
무너진다.

**경계에서 지켜야 하는 것 하나**: 모든 결과는 `provenance_notes` /
`annotation` / `reason` 을 **끝까지 들고 나간다.** 화면이 숫자만 보여주고
출처를 떨어뜨리면 00절 약속이 UI에서 깨진다. 그래서 이 모듈의 직렬화
함수들은 출처 필드를 선택적으로 다루지 않는다 — 항상 싣는다.

부록 D: **AI를 판단 주체로 쓰지 않는다.** 이 경계에도 모델 호출이 없다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from kiln import constants
from kiln.batch.density import assess_density, g_rho
from kiln.batch.dip_time import recommend_dip_time
from kiln.calibration.tiles import TileSample, calibrate_from_tiles
from kiln.calibration.update import run_update
from kiln.chem.colorants import COLORANTS, dose_grams, mix as mix_colorants
from kiln.chem.materials import MATERIALS
from kiln.chem.stull import classify
from kiln.chem.umf import unity_formula_from_materials
from kiln.domain.enums import (
    FailureType,
    GlazingMethod,
    Gloss,
    Grade,
    Transparency,
)
from kiln.domain.models import (
    CoefficientTable,
    CoolingSegment,
    DensityMeasurement,
    FiringResult,
    FiringRun,
    GlazeRecipe,
    GlazingRecord,
    KilnProfile,
    SearchState,
    TargetCoordinate,
    Ware,
    WareShape,
)
from kiln.exchange import issue, transform
from kiln.firing.cooling import plan_cooling
from kiln.firing.heatwork import assume_E, heat_work
from kiln.firing.loading import check_loading, packing_ratio
from kiln.firing.simulator import Disturbance, KilnSimulator
from kiln.risk import assess
from kiln.search.objective import passes_filter
from kiln.search.prior import Prior, propose
from kiln.thickness.profile import compute_profile

__all__ = ["KilnApp", "PRESET_SHAPES", "PRESET_KILNS", "PRESET_RECIPES"]


# ─── 프리셋 ──────────────────────────────────────────────────────────────────
#
# 앱을 열자마자 전체 사이클을 한 바퀴 돌 수 있어야 하므로 출발점을 둔다.
# 프리셋은 **예시이지 권장값이 아니다** — 형태와 가마는 사용자의 것이고,
# 기획서가 값을 주장하지 않는 항목(계수)은 여기에도 들어 있지 않다.

PRESET_SHAPES: dict[str, dict] = {
    "cylinder": {
        "name": "원통 머그 (h60 · r30)",
        "profile": [[0.0, 30.0], [60.0, 30.0]],
    },
    "bowl": {
        "name": "사발 (굽 r25 → 구연부 r75)",
        "profile": [[0.0, 25.0], [15.0, 45.0], [40.0, 65.0], [70.0, 75.0]],
    },
    "vase": {
        "name": "병 (어깨에서 좁아짐)",
        "profile": [[0.0, 28.0], [40.0, 55.0], [120.0, 60.0], [170.0, 25.0]],
    },
    "tile": {
        "name": "시편 타일 (평판 근사)",
        "profile": [[0.0, 40.0], [3.0, 40.0]],
    },
}

#: 9-6절 예제 가마. UA는 "1220℃ 유지전력 2.5kW에서 선형 역산"이다.
PRESET_KILNS: dict[str, dict] = {
    "ref30l": {
        "name": "30L 전기가마 (9-6절 예제)",
        "heat_capacity": 58_000.0,
        "ua": 2500.0 / 1200.0,
        "max_power": 3_000.0,
        "ambient_c": 20.0,
        "baseline_power_w": 1_400.0,
    },
    "large": {
        "name": "대형 전기가마 (느리게 식는다)",
        "heat_capacity": 160_000.0,
        "ua": 4.0,
        "max_power": 9_000.0,
        "ambient_c": 20.0,
        "baseline_power_w": 3_200.0,
    },
}

PRESET_RECIPES: dict[str, dict] = {
    "lime_matte": {
        "name": "석회 매트 (01절 대표 사례)",
        "materials": {"장석": 45.0, "석회석": 20.0, "규석": 20.0, "카올린": 13.0, "벤토나이트": 2.0},
    },
    "clear": {
        "name": "투명 유약",
        "materials": {"장석": 55.0, "석회석": 12.0, "규석": 21.0, "카올린": 10.0, "벤토나이트": 2.0},
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _footprint_area_m2(shape: WareShape) -> float:
    """기물이 선반에서 차지하는 **투영 면적** [m²] — 9-2절 점유율의 분자.

    회전체이므로 위에서 본 그림자는 가장 넓은 지점의 원이다:
    ``π·r_max²``. 굽이 아니라 최대 반지름을 쓰는 이유는 선반에서 서로
    닿지 않으려면 배가 부른 부분이 기준이 되기 때문이다.

    **점유율까지가 이 시스템의 범위다.** 이어지는 `F(점유율)`·`h(점유율)` 는
    α·β가 부록 C 미정이라 구현하지 않는다(9-2절, `kiln.firing.loading`).
    """
    r_max = max(r for _, r in shape.profile)
    return math.pi * r_max * r_max / 1e6


class _UnknownLabel(ValueError):
    """화면이 보낸 라벨이 열거형에 없다."""


def _by_label(enum_cls, label: str):
    """한국어 라벨로 열거형을 되찾는다. 모르는 라벨은 **조용히 버리지 않는다**.

    떨어뜨리면 "실패로 기록했는데 실패 유형이 비어 있다"처럼 사용자가
    확인할 수 없는 형태로 기록이 어긋난다 — 01절이 말하는 정보의 소실이
    경계에서 재생산되는 경로다.
    """
    for member in enum_cls:
        if member.value == label:
            return member
    known = " · ".join(m.value for m in enum_cls)
    raise _UnknownLabel(f"{enum_cls.__name__}에 {label!r}가 없다. 가능한 값: {known}")


# ─── 직렬화 ──────────────────────────────────────────────────────────────────


def _coefficient(symbol: str) -> dict:
    """대장 한 행을 화면용으로. **미정 계수는 값 대신 사유를 낸다.**"""
    c = constants.get(symbol)
    return {
        "symbol": c.symbol,
        "definition": c.definition,
        "dimension": c.dimension,
        "identification": c.identification,
        "provenance": c.provenance.value,
        "determined": c.is_determined,
        # 미정이면 value를 읽는 순간 예외이므로 읽지 않는다. 그것이 부록 C의 요점이다.
        "value": c.value if c.is_determined else None,
        "lower": c.lower,
        "upper": c.upper,
        "annotation": c.annotation(),
        "note": c.note,
    }


def _umf(materials: dict[str, float], cone: str) -> dict:
    """UMF + Stull **참조**. 4-3절: 판정이 아니다."""
    try:
        umf = unity_formula_from_materials(materials)
    except ValueError as exc:
        return {"ok": False, "reason": str(exc)}
    reading = classify(umf, cone)  # type: ignore[arg-type]
    return {
        "ok": True,
        "fluxes": dict(umf.fluxes),
        "stabilizers": dict(umf.stabilizers),
        "glass_formers": dict(umf.glass_formers),
        "sio2": umf.sio2,
        "al2o3": umf.al2o3,
        "ratio": umf.ratio,
        "zone": reading.zone.value,
        "cone": reading.cone,
        # 4-3절: 이 문구가 빠지면 참조가 판정으로 읽힌다.
        "provenance_note": reading.provenance_note,
    }


def _profile_payload(profile) -> dict:
    return {
        "points": [
            {"z": p.z, "radius": p.radius, "t_abs": p.t_abs, "t_flow": p.t_flow,
             "total": p.total}
            for p in profile.points
        ],
        "area_m2": profile.area_m2,
        "mean_mm": profile.mean_mm,
        "areal_density_g_m2": profile.areal_density_g_m2,
        "glaze_weight_g": profile.glaze_weight_g,
        "rho_dry": profile.rho_dry,
        "has_distribution": profile.has_distribution,
        "within_model_scope": profile.within_model_scope,
        "local_max_mm": profile.local_max_mm,
        "local_min_mm": profile.local_min_mm,
        "spread_mm": profile.spread_mm,
        "provenance_notes": list(profile.provenance_notes),
    }


def _risk_payload(assessment) -> dict:
    return {
        "worst": assessment.worst.label,
        "worst_level": assessment.worst.level,
        "findings": [
            {
                "risk": f.risk.value,
                "level": f.level.label,
                "level_value": f.level.level,
                "detail": f.detail,
                "annotation": f.annotation,
                "available": f.available,
                "actionable": f.level.is_actionable,
            }
            for f in assessment.findings
        ],
        "options": [
            {
                "name": o.name,
                "cost": o.cost,
                "effect": o.effect,
                "confidence_downgrade": o.confidence_downgrade,
            }
            for o in assessment.options
        ],
    }


# ─── 앱 상태 ─────────────────────────────────────────────────────────────────


@dataclass
class KilnApp:
    """앱 한 세션의 상태 (11절 데이터 모델을 메모리에 얹은 것).

    저장소가 아니다 — 영속화는 화면 쪽이 ``export_state`` 로 받아 처리한다.
    여기서는 03절 두 루프가 실제로 **한 바퀴 돈다**는 것만 보장한다.
    """

    target: TargetCoordinate = field(
        default_factory=lambda: TargetCoordinate(Gloss.SATIN, Transparency.OPAQUE)
    )
    recipes: dict[str, GlazeRecipe] = field(default_factory=dict)
    coefficient_tables: dict[str, CoefficientTable] = field(default_factory=dict)
    wares: dict[str, Ware] = field(default_factory=dict)
    records: dict[str, GlazingRecord] = field(default_factory=dict)
    runs: dict[str, FiringRun] = field(default_factory=dict)
    prior: Prior = field(default_factory=Prior)
    search: SearchState | None = None
    _seq: int = 0

    def __post_init__(self) -> None:
        for rid, preset in PRESET_RECIPES.items():
            self.recipes[rid] = GlazeRecipe(
                recipe_id=rid, name=preset["name"], materials=dict(preset["materials"])
            )
            self.coefficient_tables[rid] = CoefficientTable(recipe_id=rid)
        self.search = SearchState(target=self.target)

    def _next_id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}{self._seq}"

    # ── 대장 · 원료 ──────────────────────────────────────────────────────────

    def registry(self) -> list[dict]:
        """부록 C 대장 전체. 미정 계수는 값이 아니라 사유를 낸다."""
        return [_coefficient(sym) for sym in constants.REGISTRY]

    def materials(self) -> list[dict]:
        return [
            {"name": m.name, "oxides": dict(m.oxides), "loi": m.loi}
            for m in MATERIALS.values()
        ]

    def presets(self) -> dict:
        return {
            "shapes": PRESET_SHAPES,
            "kilns": PRESET_KILNS,
            "gloss": [{"level": g.level, "label": g.label} for g in Gloss],
            "transparency": [{"level": t.level, "label": t.label} for t in Transparency],
            "grades": [g.value for g in Grade],
            "failures": [f.value for f in FailureType],
            "methods": [
                {"value": m.value, "has_distribution": m.has_distribution_model}
                for m in GlazingMethod
            ],
        }

    # ── 04절 목표 ────────────────────────────────────────────────────────────

    def set_target(self, gloss_level: int, transparency_level: int) -> dict:
        """목표 좌표를 정한다 (4-1절 광택도 × 투명도 독립 2축)."""
        self.target = TargetCoordinate(
            Gloss.from_level(gloss_level),  # type: ignore[arg-type]
            Transparency.from_level(transparency_level),  # type: ignore[arg-type]
        )
        assert self.search is not None
        self.search = replace(self.search, target=self.target)
        return {
            "gloss": self.target.gloss.label,
            "transparency": self.target.transparency.label,
            # 4-4절: 색은 예측하지 않는다. 화면이 색 입력을 묻지 않게 하려고 싣는다.
            "note": (
                "색은 목적함수에 넣지 않는다 — 부수 관측으로만 기록된다 (4-4절). "
                "착색 산화물 참고 색상표는 별도 예외다 (4-4-a절)."
            ),
        }

    # ── 04-4-a절 착색 산화물 참고 색상표 (예측이 아니라 열람) ──────────────────

    def color_reference(self) -> list[dict]:
        """6종 참고 색상표. **예측이 아니라 열람이다**(4-4-a절)."""
        return [
            {
                "symbol": c.symbol, "name": c.name_ko, "hex": c.hex, "note": c.note,
                "typical_pct": list(c.typical_pct),
            }
            for c in COLORANTS.values()
        ]

    def mix_color(
        self, symbol_a: str, symbol_b: str | None = None, blend_t: float = 0.0,
        *, amount_pct: float | None = None, saturation_delta: float = 0.0,
        brightness_delta: float = 0.0, batch_dry_g: float | None = None,
    ) -> dict:
        """참고 색상 사잇값·첨가량·채도·명도 (4-4-a절). 조성·소성 조건은 입력에 없다.

        사잇값·첨가량·채도·명도 **무엇을 조절해도** 최종 색을 중성 바탕색↔
        참고색 직선에 되쏘아 첨가량을 역산하고(``implied_amount_pct``·
        ``match_quality``), 그 값으로 그램 수를 낸다 — 채도·명도 슬라이더가
        그램 수에 영향을 주더라도, 그 관계는 **임의로 지어낸 배수가 아니라
        화면에 뜬 색 자체의 기하 투영**이라서 근거를 댈 수 있다. 채도·명도로
        이 산화물의 표시 축을 크게 벗어나면 ``match_quality`` 가 내려가고
        그 사실이 ``provenance_notes`` 에 남는다 — 조용히 숫자만 나가지 않는다.
        ``kiln.search`` 로 넘어가지 않고 이 dict 밖으로는 나가지 않는다
        (DECISIONS.md 경계).
        """
        try:
            result = mix_colorants(
                symbol_a, symbol_b, blend_t, amount_pct=amount_pct,
                saturation_delta=saturation_delta, brightness_delta=brightness_delta,
            )
        except KeyError as exc:
            return {"ok": False, "reason": str(exc)}
        batch = batch_dry_g if batch_dry_g is not None else 500.0
        return {
            "ok": True,
            "hex": result.hex,
            "rgb": [round(c, 4) for c in result.rgb],
            "provenance_notes": list(result.notes),
            "amount_pct": amount_pct,
            "implied_amount_pct": result.implied_amount_pct,
            "match_quality": result.match_quality,
            "grams_per_100g_dry": result.implied_amount_pct,
            "batch_dry_g": batch,
            "grams_for_batch": dose_grams(result.implied_amount_pct, batch),
        }

    # ── 05절 탐색 ────────────────────────────────────────────────────────────

    def propose(self, n: int = 6, grid_step: float | None = None) -> dict:
        """조성 후보를 낸다 (5-2 ~ 5-5절). 규칙 기반이며 LLM을 쓰지 않는다."""
        assert self.search is not None
        state = self.search
        if grid_step is not None:
            state = replace(state, grid_step=grid_step)
            self.search = state
        candidates = propose(state, self.prior, n=n)
        return {
            "grid_step": state.grid_step,
            "observation_count": len(state.observations),
            "personal_weight": self.prior.weight_of_personal_data(),
            "candidates": [
                {
                    "materials": dict(c.materials),
                    # 관측이 없으면 inf다 — 예상 거리를 지어내지 않는다.
                    "expected_distance": (
                        None if c.expected_distance == float("inf")
                        else c.expected_distance
                    ),
                    "umf_note": c.umf_note,
                }
                for c in candidates
            ],
        }

    def inspect_composition(self, materials: dict[str, float], cone: str = "cone11") -> dict:
        """후보 하나의 UMF·Stull 참조를 본다 (04절)."""
        return _umf(materials, cone)

    def list_recipes(self) -> list[dict]:
        """등록된 레시피 목록. 계수 동정 진행도를 함께 낸다."""
        out = []
        for rid, recipe in self.recipes.items():
            table = self.coefficient_tables.get(rid)
            out.append({
                "recipe_id": rid,
                "name": recipe.name,
                "materials": dict(recipe.materials),
                "failure_mode_hint": (
                    recipe.failure_mode_hint.value
                    if recipe.failure_mode_hint is not None else None
                ),
                "calibration_runs": table.calibration_runs if table else 0,
                "k1_identified": bool(table and table.k1 is not None),
                "rho_dry_identified": bool(table and table.rho_dry is not None),
            })
        return out

    def adopt_candidate(self, name: str, materials: dict[str, float]) -> dict:
        """후보를 레시피로 등록한다. 새 계수 표가 함께 생긴다."""
        rid = self._next_id("r")
        self.recipes[rid] = GlazeRecipe(
            recipe_id=rid, name=name, materials=dict(materials)
        )
        self.coefficient_tables[rid] = CoefficientTable(recipe_id=rid)
        return {"recipe_id": rid, "name": name}

    # ── 06절 배치·비중 ───────────────────────────────────────────────────────

    def check_density(
        self, rho: float, minutes_since_stirring: float, *, target_lo: float = 1.40,
        target_hi: float = 1.50,
    ) -> dict:
        """6-4절 경고 분기. **경고가 떠도 진행을 막지 않는다.**"""
        try:
            m = DensityMeasurement(
                batch_id="b", measured_at=_now(), specific_gravity=rho,
                minutes_since_stirring=minutes_since_stirring,
            )
        except ValueError as exc:
            return {"ok": False, "reason": str(exc)}
        advice = assess_density(m, target=(target_lo, target_hi))
        return {
            "ok": True,
            "status": advice.status.value,
            "message": advice.message,
            "annotation": advice.annotation,
            "blocks_progress": advice.blocks_progress,
            "remeasure_recommended": advice.remeasure_recommended,
            "g_rho": g_rho(rho),
        }

    def suggest_dip_time(
        self, target_mm: float, rho: float, recipe_id: str, *, t_flow_mm: float = 0.0
    ) -> dict:
        """6-1절: 비중을 고정하고 담금시간만 역산한다."""
        table = self.coefficient_tables.get(recipe_id)
        k1 = table.k1 if table is not None else None
        absorption = constants.get("absorption")
        rec = recommend_dip_time(
            target_mm, rho=rho, absorption=absorption.value, k1=k1,
            t_flow_mm=t_flow_mm,
        )
        note = (
            f"k1={table.k1:.5f} (이 유약 동정값, {table.calibration_runs}회차)"
            if table is not None and table.k1 is not None
            else f"k1={constants.get('k1').value} {constants.get('k1').annotation()}"
        )
        return {
            "seconds": rec.seconds,
            "predicted_mean_mm": rec.predicted_mean_mm,
            "feasible": rec.feasible,
            "reason": rec.reason,
            "annotation": f"{note} · 흡수율은 k1과 곱으로만 식별된다 (부록 A)",
        }

    # ── 07절 시유·두께 ───────────────────────────────────────────────────────

    def register_ware(
        self, shape_key: str, clay_body: str, bisque_c: float,
        *, glaze_interior: bool = True,
    ) -> dict:
        preset = PRESET_SHAPES[shape_key]
        wid = self._next_id("w")
        shape = WareShape(
            shape_id=shape_key,
            name=preset["name"],
            profile=tuple((z, r) for z, r in preset["profile"]),
        )
        self.wares[wid] = Ware(
            ware_id=wid,
            shape=shape,
            clay_body=clay_body,
            bisque_temperature=bisque_c,
            footprint_area=_footprint_area_m2(shape),
            glaze_interior=glaze_interior,
        )
        return {
            "ware_id": wid,
            "name": preset["name"],
            "footprint_area_m2": self.wares[wid].footprint_area,
        }

    def list_wares(self) -> list[dict]:
        return [
            {
                "ware_id": w.ware_id, "name": w.shape.name, "clay_body": w.clay_body,
                "bisque_temperature": w.bisque_temperature,
                "footprint_area_m2": w.footprint_area,
                "glaze_interior": w.glaze_interior,
            }
            for w in self.wares.values()
        ]

    def glaze(
        self, ware_id: str, recipe_id: str, method: str, weight_before: float,
        weight_after: float, *, dip_seconds: float | None = None,
        rho: float | None = None, waxed_area_m2: float = 0.0,
        is_reglaze: bool = False, drying_complete: bool = True,
    ) -> dict:
        """저울 2회로 두께 분포를 낸다 (7-1 ~ 7-5절)."""
        ware = self.wares[ware_id]
        density = (
            None if rho is None
            else DensityMeasurement(
                batch_id="b", measured_at=_now(), specific_gravity=rho,
                minutes_since_stirring=0.0,
            )
        )
        try:
            gm = _by_label(GlazingMethod, method)
        except _UnknownLabel as exc:
            return {"ok": False, "reason": str(exc)}
        rid = self._next_id("g")
        try:
            record = GlazingRecord(
                record_id=rid, ware_id=ware_id, batch_id=recipe_id, method=gm,
                weight_before=weight_before, weight_after=weight_after,
                dip_seconds=dip_seconds, density=density,
                waxed_area_m2=waxed_area_m2, is_reglaze=is_reglaze,
                drying_complete=drying_complete,
            )
        except ValueError as exc:
            return {"ok": False, "reason": str(exc)}

        self.records[rid] = record
        table = self.coefficient_tables.get(recipe_id)
        profile = compute_profile(record, ware, table)
        payload = _profile_payload(profile)
        payload.update({
            "ok": True,
            "record_id": rid,
            "recipe_id": recipe_id,
            # 화면이 두께 그래프에 안전 범위 밴드를 그리려면 같이 와야 한다 —
            # 왕복을 한 번 더 돌게 하면 두 값이 어긋난 채 그려질 수 있다.
            "safe_thickness_mm": list(
                table.safe_thickness_mm if table is not None else (0.8, 1.3)
            ),
        })
        return payload

    # ── 08절 위험 ────────────────────────────────────────────────────────────

    def risk(self, record_id: str, recipe_id: str) -> dict:
        """소성 전 위험 판정 + 되돌림 선택지 (08절)."""
        record = self.records[record_id]
        ware = self.wares[record.ware_id]
        table = self.coefficient_tables.get(recipe_id)
        profile = compute_profile(record, ware, table)
        safe = table.safe_thickness_mm if table is not None else (0.8, 1.3)
        assessment = assess(
            profile, method=record.method, safe_range_mm=safe,
            recipe=self.recipes.get(recipe_id),
        )
        payload = _risk_payload(assessment)
        payload["profile"] = _profile_payload(profile)
        # 판정에 실제로 쓰인 안전창을 같이 낸다 — 화면이 계수 표를 한 번 더
        # 물어보면 두 값이 어긋난 채 그려질 수 있다.
        payload["safe_thickness_mm"] = list(safe)
        return payload

    # ── 09절 적재·소성 ───────────────────────────────────────────────────────

    def loading(
        self, kiln_key: str, ware_ids: list[str], shelf_area_m2: float,
        declared_kg: float, observed_response_w: float,
    ) -> dict:
        """9-2절 총량 이상 감지. **적재 오등록 판별이 아니다.**"""
        kiln = PRESET_KILNS[kiln_key]
        wares = [self.wares[w] for w in ware_ids if w in self.wares]
        ratio = packing_ratio(wares, shelf_area_m2) if shelf_area_m2 > 0 else 0.0
        check = check_loading(
            declared_kg, observed_response_w, kiln["baseline_power_w"]
        )
        return {
            "packing_ratio": ratio,
            "gross_error": check.gross_error,
            "threshold": check.threshold,
            "message": check.message,
            "declared_packing_ratio": check.packing_ratio,
        }

    def cooling(self, kiln_key: str, segments: list[dict]) -> dict:
        """9-6절: 자연냉각률이 상한이다. 초과 요청은 거부한다."""
        kiln = PRESET_KILNS[kiln_key]
        profile = self._kiln_profile(kiln_key)
        segs = [
            CoolingSegment(
                float(s["from_c"]), float(s["to_c"]), float(s["rate_c_per_h"]),
                s.get("purpose", ""),
            )
            for s in segments
        ]
        plan = plan_cooling(profile, segs)
        # UI가 자연냉각률 곡선을 **배경으로** 깔고 그 아래만 고르게 한다 (9-6절).
        curve = [
            {"temp_c": t, "natural_rate": profile.natural_cooling_rate(float(t))}
            for t in range(1220, 199, -20)
        ]
        return {
            "feasible": plan.feasible,
            "rejections": list(plan.rejections),
            "extra_hours": plan.extra_hours,
            "extra_kwh": plan.extra_kwh,
            "total_hours": plan.total_hours,
            "provenance_notes": list(plan.provenance_notes),
            "natural_curve": curve,
            "kiln_name": kiln["name"],
        }

    def _kiln_profile(self, kiln_key: str) -> KilnProfile:
        k = PRESET_KILNS[kiln_key]
        return KilnProfile(
            profile_id=kiln_key, name=k["name"], heat_capacity=k["heat_capacity"],
            ua=k["ua"], max_power=k["max_power"], ambient_c=k["ambient_c"],
            baseline_power_w=k["baseline_power_w"],
        )

    def simulate(
        self, kiln_key: str, peak_c: float, ramp_c_per_h: float, hold_minutes: float,
        E_kj: float, *, seed: int = 0, voltage_pct: float = 0.0,
        aging_pct: float = 0.0, noise_c: float = 0.0,
    ) -> dict:
        """12-2절 시뮬레이터. 생성기는 추정 모델과 **구조적으로 다르다**."""
        profile = self._kiln_profile(kiln_key)
        E = assume_E(E_kj * 1000.0, "앱 시뮬레이션 — 사용자가 고른 가정값")
        disturbance = Disturbance(
            supply_voltage_pct=voltage_pct, element_aging_pct=aging_pct,
            thermocouple_noise_c=noise_c, seed=seed,
        )
        sim = KilnSimulator(profile, disturbance)

        ramp_s = max((peak_c - profile.ambient_c) / max(ramp_c_per_h, 1e-9) * 3600.0, 1.0)
        hold_s = hold_minutes * 60.0
        schedule = (
            (0.0, profile.ambient_c), (ramp_s, peak_c), (ramp_s + hold_s, peak_c),
        )

        from kiln.firing.controller import SegmentedController

        controller = SegmentedController(profile, schedule, E=E.value)
        dt = 20.0
        steps = sim.run(controller, duration_s=ramp_s + hold_s, dt=dt)
        curve = [(s.t, s.sensor_c) for s in steps]

        # 간격을 벌려 내보낸다 — 브라우저가 수천 점을 그릴 필요가 없다.
        stride = max(len(steps) // 400, 1)
        return {
            "steps": [
                {"t": s.t, "sensor_c": s.sensor_c, "ware_c": s.ware_c,
                 "power_w": s.power_w}
                for s in steps[::stride]
            ],
            "schedule": [{"t": t, "temp_c": c} for t, c in schedule],
            "heat_work": heat_work(curve, E.value),
            "peak_sensor_c": max(s.sensor_c for s in steps) if steps else 0.0,
            "final_decision": controller.decide(
                steps[-1].t, steps[-1].sensor_c, dt
            ).message if steps else "",
            "E_note": E.note,
            "provenance_notes": list(getattr(sim, "provenance_notes", ())),
        }

    def record_run(
        self, kiln_key: str, record_ids: list[str], schedule: list[dict],
        measured: list[dict], cooling: list[dict], *, declared_kg: float = 0.0,
        shelf_area_m2: float = 0.0,
    ) -> dict:
        """회차를 남긴다. **냉각은 스케줄과 분리되어 저장된다** (9-4절)."""
        run_id = self._next_id("run")
        self.runs[run_id] = FiringRun(
            run_id=run_id, kiln_profile_id=kiln_key, started_at=_now(),
            schedule=tuple((float(p["t"]), float(p["temp_c"])) for p in schedule),
            measured=tuple((float(p["t"]), float(p["temp_c"])) for p in measured),
            record_ids=tuple(record_ids),
            cooling=tuple(
                CoolingSegment(
                    float(s["from_c"]), float(s["to_c"]), float(s["rate_c_per_h"]),
                    s.get("purpose", ""),
                )
                for s in cooling
            ),
            declared_kg=declared_kg, shelf_area_m2=shelf_area_m2,
        )
        return {"run_id": run_id}

    # ── 10절 결과·되먹임 ─────────────────────────────────────────────────────

    def record_result(
        self, run_id: str, record_id: str, recipe_id: str, gloss_level: int,
        transparency_level: int, grade: str, *, failures: list[str] | None = None,
        observations: dict[str, str] | None = None,
        fracture_thickness_mm: float | None = None,
        fracture_z_mm: float | None = None,
    ) -> dict:
        """10-1절 결과 3축을 남기고 되먹임을 돌린다 (10-2절, 5-5절)."""
        try:
            result = FiringResult(
                record_id=record_id,
                coordinate=TargetCoordinate(
                    Gloss.from_level(gloss_level),  # type: ignore[arg-type]
                    Transparency.from_level(transparency_level),  # type: ignore[arg-type]
                ),
                grade=_by_label(Grade, grade),
                # 모르는 실패 유형을 조용히 버리면 "실패로 기록했는데 유형이
                # 비어 있다"가 되어 도메인 불변식과 어긋난 채 저장된다.
                failures=frozenset(
                    _by_label(FailureType, label) for label in (failures or [])
                ),
                observations=dict(observations or {}),
                fracture_thickness_mm=fracture_thickness_mm,
                fracture_z_mm=fracture_z_mm,
            )
        except ValueError as exc:
            return {"ok": False, "reason": str(exc)}

        run = self.runs[run_id]
        self.runs[run_id] = replace(run, results=run.results + (result,))

        # ── 5-4절: 부수 관측은 목적함수 d에 넣지 않고 **필터로만** 쓴다.
        kept = passes_filter(result)
        recipe = self.recipes[recipe_id]
        if kept:
            self.prior.update(dict(recipe.materials), result.coordinate)
            assert self.search is not None
            self.search = replace(
                self.search,
                observations=self.search.observations
                + ((tuple(sorted(recipe.materials.items())), result.coordinate),),
            )

        # ── 10-2절: 계수 보정. 초벌 온도가 바뀌었으면 **멈춘다** (7-5절).
        record = self.records[record_id]
        ware = self.wares[record.ware_id]
        update = run_update(self.coefficient_tables[recipe_id], record, ware)
        self.coefficient_tables[recipe_id] = update.table

        return {
            "ok": True,
            "passes_filter": kept,
            "filter_note": (
                "목표 거리와 무관하게 제외됐다 — 부수 관측은 d에 넣지 않고 "
                "필터로만 쓴다 (5-4절)"
                if not kept
                else "축적에 반영됐다 (조성→결과 매핑, 5-5절)"
            ),
            "distance_to_target": self.target.distance(result.coordinate),
            "calibration": {
                "applied": update.applied,
                "k1": update.table.k1,
                "k1_estimate": update.k1_estimate,
                "rho_dry": update.table.rho_dry,
                "calibration_runs": update.table.calibration_runs,
                "solid": list(update.solid),
                "dashed": list(update.dashed),
                "notes": list(update.notes),
            },
            "personal_weight": self.prior.weight_of_personal_data(),
        }

    def calibrate_tiles(self, samples: list[dict], rho: float) -> dict:
        """7-3절 타일 캘리브레이션. **캘리퍼가 없으면 ρ_dry를 내지 않는다.**"""
        tiles = [
            TileSample(
                dip_seconds=float(s["dip_seconds"]), area_m2=float(s["area_m2"]),
                glaze_weight_g=float(s["glaze_weight_g"]),
                caliper_mm=(
                    None if s.get("caliper_mm") in (None, "") else float(s["caliper_mm"])
                ),
            )
            for s in samples
        ]
        result = calibrate_from_tiles(tiles, rho=rho)
        return {
            "k1": result.k1,
            "rho_dry": result.rho_dry,
            "areal_slope": result.areal_slope,
            "residual_rms": result.residual_rms,
            "n_samples": result.n_samples,
            "notes": list(result.notes),
            "solid": list(result.solid),
            "dashed": list(result.dashed),
        }

    def apply_calibration(
        self, recipe_id: str, *, k1: float | None = None, rho_dry: float | None = None,
    ) -> dict:
        """캘리브레이션 결과를 유약 표에 반영한다 (10-2절 실선 항목만)."""
        table = self.coefficient_tables[recipe_id]
        notes = list(table.provenance_notes)
        if k1 is not None:
            notes.append(f"k1={k1:.5f} — 타일 캘리브레이션에서 반영 (10-2절 실선)")
        if rho_dry is not None:
            notes.append(f"ρ_dry={rho_dry:.4f} — 캘리퍼 1회로 닫았다 (7-3절, 실선)")
        self.coefficient_tables[recipe_id] = replace(
            table,
            k1=k1 if k1 is not None else table.k1,
            rho_dry=rho_dry if rho_dry is not None else table.rho_dry,
            provenance_notes=tuple(notes),
        )
        return self.coefficients(recipe_id)

    def coefficients(self, recipe_id: str) -> dict:
        table = self.coefficient_tables[recipe_id]
        return {
            "recipe_id": table.recipe_id,
            "k1": table.k1, "k2": table.k2, "rho_dry": table.rho_dry,
            "s": table.s, "m_rho": table.m_rho,
            "safe_thickness_mm": list(table.safe_thickness_mm),
            "calibration_runs": table.calibration_runs,
            "calibrated_bisque_c": table.calibrated_bisque_c,
            "provenance_notes": list(table.provenance_notes),
        }

    # ── 10-3절 처방 ──────────────────────────────────────────────────────────

    def issue_prescription(self, run_id: str, E_kj: float, peak_c: float) -> dict:
        """H_s(승온·유지) + 냉각 온도 곡선으로 발행한다."""
        run = self.runs[run_id]
        E = assume_E(E_kj * 1000.0, "앱 처방 발행 — 사용자가 고른 가정값")
        p = issue(run, E=E.value, peak_c=peak_c, cooling=run.cooling)
        return {
            "heat_work_target": p.heat_work_target,
            "peak_c": p.peak_c,
            "cooling": [
                {"from_c": s.from_c, "to_c": s.to_c, "rate_c_per_h": s.rate_c_per_h,
                 "purpose": s.purpose}
                for s in p.cooling
            ],
            "E_assumed": p.E_assumed,
            "provenance_notes": list(p.provenance_notes),
        }

    def transform_prescription(self, prescription: dict, kiln_key: str) -> dict:
        """다른 가마로 옮긴다. **비대칭이라 실패할 수 있다** (10-3절)."""
        from kiln.exchange import Prescription

        p = Prescription(
            heat_work_target=float(prescription["heat_work_target"]),
            peak_c=float(prescription["peak_c"]),
            cooling=tuple(
                CoolingSegment(
                    float(s["from_c"]), float(s["to_c"]), float(s["rate_c_per_h"]),
                    s.get("purpose", ""),
                )
                for s in prescription["cooling"]
            ),
            E_assumed=float(prescription["E_assumed"]),
            provenance_notes=tuple(prescription.get("provenance_notes", [])),
        )
        result = transform(p, self._kiln_profile(kiln_key))
        return {
            "feasible": result.feasible,
            "schedule": (
                None if result.schedule is None
                else [{"t": t, "temp_c": c} for t, c in result.schedule]
            ),
            "reasons": list(result.reasons),
            "kiln_name": PRESET_KILNS[kiln_key]["name"],
        }

    # ── 상태 내보내기 ────────────────────────────────────────────────────────

    def export_state(self) -> dict:
        """화면이 브라우저에 저장할 수 있는 형태. 계수 출처가 함께 나간다.

        **축적은 조성→결과 매핑으로 나간다**(5-5절). 목표별로 저장하면
        사용자가 목표를 바꿀 때마다 리셋된다 — 그래서 ``observations`` 는
        목표와 무관하게 저장되고, ``target`` 은 그 옆에 따로 실린다.
        """
        assert self.search is not None
        return {
            "version": 1,
            "target": {
                "gloss": self.target.gloss.level,
                "transparency": self.target.transparency.level,
            },
            "recipes": {
                rid: {"name": r.name, "materials": dict(r.materials)}
                for rid, r in self.recipes.items()
            },
            "coefficients": {
                rid: self.coefficients(rid) for rid in self.coefficient_tables
            },
            "observations": [
                {
                    "materials": dict(materials),
                    "gloss": coord.gloss.level,
                    "transparency": coord.transparency.level,
                }
                for materials, coord in self.search.observations
            ],
            "grid_step": self.search.grid_step,
            "observation_count": len(self.search.observations),
            "personal_weight": self.prior.weight_of_personal_data(),
            "run_count": len(self.runs),
        }

    def import_state(self, state: dict) -> dict:
        """``export_state`` 가 낸 것을 되돌린다 — 새로고침에서 살아남게.

        **되돌리는 것은 회차 사이에 남아야 하는 것뿐이다**: 목표, 레시피,
        계수 표(출처 포함), 조성→결과 축적. 기물·시유 기록·회차는 복원하지
        않는다 — 그것들은 진행 중인 한 회차의 작업 상태이고, 저장해 두었다가
        되살리면 "저울에 올린 적 없는 기물"이 화면에 남는다.

        계수 표의 ``provenance_notes`` 가 함께 돌아오는 것이 중요하다.
        값만 복원하면 새로고침 한 번으로 "가정한 ρ_dry 위에서 낸 k₁"이
        출처 없는 숫자가 된다(00절).
        """
        if not isinstance(state, dict) or state.get("version") != 1:
            return {"ok": False, "reason": "알 수 없는 저장 형식이다"}

        try:
            target = state["target"]
            self.set_target(int(target["gloss"]), int(target["transparency"]))

            self.recipes = {}
            self.coefficient_tables = {}
            for rid, r in state.get("recipes", {}).items():
                self.recipes[rid] = GlazeRecipe(
                    recipe_id=rid, name=r["name"], materials=dict(r["materials"])
                )
            for rid, c in state.get("coefficients", {}).items():
                self.coefficient_tables[rid] = CoefficientTable(
                    recipe_id=rid,
                    k1=c.get("k1"), k2=c.get("k2"), rho_dry=c.get("rho_dry"),
                    s=c.get("s"), m_rho=c.get("m_rho"),
                    safe_thickness_mm=tuple(c.get("safe_thickness_mm", (0.8, 1.3))),
                    calibration_runs=int(c.get("calibration_runs", 0)),
                    calibrated_bisque_c=c.get("calibrated_bisque_c"),
                    provenance_notes=tuple(c.get("provenance_notes", ())),
                )

            self.prior = Prior()
            observations = []
            for obs in state.get("observations", []):
                coord = TargetCoordinate(
                    Gloss.from_level(int(obs["gloss"])),  # type: ignore[arg-type]
                    Transparency.from_level(int(obs["transparency"])),  # type: ignore[arg-type]
                )
                materials = dict(obs["materials"])
                self.prior.update(materials, coord)
                observations.append((tuple(sorted(materials.items())), coord))

            assert self.search is not None
            self.search = replace(
                self.search,
                observations=tuple(observations),
                grid_step=float(state.get("grid_step", 10.0)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            return {"ok": False, "reason": f"복원할 수 없다: {exc}"}

        return {"ok": True, **self.export_state()}
