"""LLM 원문 JSON → RecipeCandidateSet 변환·검증 — LLM 프런트도어 TODO Phase 2.

``kiln.chem`` 으로 UMF를 교차 확인하고, 배합비 불변식은
``kiln.domain.models.GlazeRecipe`` 를 재사용해 검증한다 — 같은 검사를
새로 만들지 않는다(계산이 맞는지 확인하는 것이지, 계산을 다시 발명하는
것이 아니다).
"""

from __future__ import annotations

from typing import Any

from kiln.aice.contract import PhotoAsset, RecipeCandidate, RecipeCandidateSet, SourcedValue
from kiln.chem.stull import classify
from kiln.chem.umf import unity_formula_from_materials
from kiln.domain.models import GlazeRecipe

__all__ = ["RecipeCandidateValidationError", "build_recipe_candidates"]


class RecipeCandidateValidationError(Exception):
    """LLM이 낸 후보들이 전부 화학적으로 성립하지 않을 때."""


def _placeholder_photo(candidate_id: str) -> PhotoAsset:
    return PhotoAsset(
        id=f"{candidate_id}-photo",
        kind="recipe",
        storage_path=None,
        placeholder=True,
        source_type="synthetic",
        rights_confirmed=True,
        alt="AI가 생성했거나 아직 생성되지 않은 예상 이미지 플레이스홀더",
    )


def build_recipe_candidates(
    raw: dict[str, Any], *, source_ids: tuple[str, ...] = ()
) -> tuple[RecipeCandidateSet, tuple[str, ...]]:
    """LLM ``chat_json()`` 원문(dict)을 검증된 ``RecipeCandidateSet``으로 바꾼다.

    각 후보는 (1) ``GlazeRecipe`` 불변식(비율 합 100%)을 통과해야 하고,
    (2) ``kiln.chem.unity_formula_from_materials`` 로 UMF 계산이 가능해야
    한다(원료명이 ``kiln.chem.materials.MATERIALS`` 밖이면 여기서 실패).
    실패한 후보는 통째로 버린다 — 절반만 검증된 후보를 화면에 올리지
    않는다. 반환값의 두 번째 항목은 버려진 후보의 사유 목록이다(빈
    튜플이면 전부 통과).
    """
    raw_candidates = raw.get("candidates")
    if not isinstance(raw_candidates, list) or not raw_candidates:
        raise RecipeCandidateValidationError("candidates 배열이 비어있거나 없습니다")

    built: list[RecipeCandidate] = []
    errors: list[str] = []
    for index, item in enumerate(raw_candidates):
        cid = str(item.get("id") or f"cand-{index + 1}") if isinstance(item, dict) else f"cand-{index + 1}"
        try:
            if not isinstance(item, dict):
                raise ValueError("후보 항목이 JSON 객체가 아닙니다")
            materials = {str(k): float(v) for k, v in dict(item["materials"]).items()}
            name = str(item.get("name") or cid)
            GlazeRecipe(recipe_id=cid, name=name, materials=materials)
            umf = unity_formula_from_materials(materials)
            reading = classify(umf)

            firing_c = item.get("predicted_firing_range_c") or [None, None]
            lo = firing_c[0] if len(firing_c) > 0 else None
            hi = firing_c[1] if len(firing_c) > 1 else None
            firing_range = SourcedValue(
                (lo, hi), "°C", "inferred", 0.4,
                "LLM 제안, 문헌·일반 지식 기반 — 실측 아님",
            )
            note = str(item.get("predicted_firing_note") or "").strip()
            stull_note = f"Stull 참조: {reading.zone.value} — {reading.provenance_note}"
            full_note = f"{note} ({stull_note})" if note else stull_note

            candidate = RecipeCandidate(
                id=cid,
                name=name,
                materials=materials,
                predicted_firing_range=firing_range,
                predicted_firing_note=full_note,
                photo=_placeholder_photo(cid),
                source_type="inferred",
                source_ids=source_ids,
            )
        except (KeyError, ValueError, TypeError) as exc:
            errors.append(f"{cid}: {exc}")
            continue
        built.append(candidate)

    if not built:
        raise RecipeCandidateValidationError(
            "유효한 후보가 없습니다 — " + "; ".join(errors)
        )

    return RecipeCandidateSet(tuple(built)), tuple(errors)
