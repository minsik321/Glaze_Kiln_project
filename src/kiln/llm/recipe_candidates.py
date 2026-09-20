"""LLM 원문 JSON → RecipeCandidateSet 변환·검증 — LLM 프런트도어 TODO Phase 2.

**v9: 배합비(wt%)는 LLM 원문에서 읽지 않는다.** ``build_recipe_candidates``는
``kiln.search.prior.propose``가 낸 ``Candidate.materials``를 정본으로 쓰고,
LLM 원문에서는 이름·착색 산화물·소성 메모 같은 서술 필드만 가져온다 —
``recipe_prompt.build_messages``가 애초에 LLM에게 배합비를 요청하지 않으므로
(고정 배합을 프롬프트에 박아 넣는다), 이건 "LLM이 낸 값을 무시한다"가
아니라 "애초에 LLM에게 그 값을 만들 권한이 없다"는 뜻이다.

``kiln.chem``으로 UMF를 교차 확인하고, 배합비 불변식은
``kiln.domain.models.GlazeRecipe``를 재사용해 검증한다 — 같은 검사를
새로 만들지 않는다. 검색이 낸 배합은 구성상 이미 유효해야 하지만, 이
검증은 안전망으로 남긴다(계산이 맞는지 확인하는 것이지, 계산을 다시
발명하는 것이 아니다).
"""

from __future__ import annotations

from typing import Any

from kiln.aice.contract import PhotoAsset, RecipeCandidate, RecipeCandidateSet, SourcedValue
from kiln.aice.identity import canonical_recipe_id
from kiln.chem.stull import classify
from kiln.chem.umf import unity_formula_from_materials
from kiln.chem.colorants import COLORANTS
from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import GlazeRecipe, TargetCoordinate
from kiln.search.objective import Candidate

__all__ = ["RecipeCandidateValidationError", "parse_target", "build_recipe_candidates"]


class RecipeCandidateValidationError(Exception):
    """LLM이 낸 후보들이 전부 화학적으로 성립하지 않을 때, 또는 목표 분류를 해석할 수 없을 때."""


def parse_target(raw: dict[str, Any]) -> TargetCoordinate:
    """목표 분류 LLM 원문(``build_target_messages`` 응답) → ``TargetCoordinate``.

    자연어 목표 해석은 언어 이해이지 배합 판단이 아니므로 LLM에 맡기되,
    반환값은 (광택도, 투명도) 좌표 하나뿐이다 — ``kiln.search``가 그 좌표로
    조성 공간을 규칙대로 탐색한다(부록 D: 판단 주체는 규칙).
    """
    try:
        gloss = Gloss[str(raw["target_gloss"]).strip().upper()]
        transparency = Transparency[str(raw["target_transparency"]).strip().upper()]
    except (KeyError, TypeError, AttributeError) as exc:
        raise RecipeCandidateValidationError(
            f"목표 분류 응답을 해석할 수 없다: {raw!r}"
        ) from exc
    return TargetCoordinate(gloss=gloss, transparency=transparency)


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
    raw: dict[str, Any],
    candidates: list[Candidate],
    *,
    source_ids: tuple[str, ...] = (),
    target: TargetCoordinate | None = None,
) -> tuple[RecipeCandidateSet, tuple[str, ...]]:
    """LLM ``chat_json()`` 서술 원문 + 검색 배합 → 검증된 ``RecipeCandidateSet``.

    ``candidates[i]``의 배합이 ``raw["candidates"][i]``의 서술과 순서로
    짝지어진다 — 개수가 다르면 짧은 쪽에 맞춰 자르고 그 사실을 반환값의
    두 번째 항목(버림 사유)에 남긴다. 각 후보는 (1) ``GlazeRecipe``
    불변식(비율 합 100%)을 통과해야 하고, (2)
    ``kiln.chem.unity_formula_from_materials``로 UMF 계산이 가능해야
    한다. 실패한 후보는 통째로 버린다.

    ``target``(1차 LLM 호출이 분류한 목표 좌표)이 주어지면 모든 후보의
    ``target_gloss``/``target_transparency``에 그대로 실린다 — 이 값이
    이미지 생성 프롬프트까지 전달되어야 "매트 레시피인데 유광 이미지"
    같은 불일치가 나지 않는다(이전에는 이 좌표가 배합 후보를 고르는 데만
    쓰이고 버려졌다).
    """
    raw_candidates = raw.get("candidates")
    if not isinstance(raw_candidates, list) or not raw_candidates:
        raise RecipeCandidateValidationError("candidates 배열이 비어있거나 없습니다")
    if not candidates:
        raise RecipeCandidateValidationError("검색이 낸 배합 후보가 없습니다")

    errors: list[str] = []
    if len(raw_candidates) != len(candidates):
        errors.append(
            f"서술 {len(raw_candidates)}건과 배합 {len(candidates)}건의 개수가 달라 "
            f"짧은 쪽({min(len(raw_candidates), len(candidates))}건)에 맞춰 짝지었다"
        )

    built: list[RecipeCandidate] = []
    for index, (item, search_candidate) in enumerate(zip(raw_candidates, candidates)):
        cid = str(item.get("id") or f"cand-{index + 1}") if isinstance(item, dict) else f"cand-{index + 1}"
        try:
            if not isinstance(item, dict):
                raise ValueError("후보 항목이 JSON 객체가 아닙니다")
            materials = dict(search_candidate.materials)
            colorants = {str(k): float(v) for k, v in dict(item.get("colorants") or {}).items()}
            unknown_colorants = sorted(set(colorants) - set(COLORANTS))
            if unknown_colorants:
                raise ValueError(f"지원하지 않는 발색 산화물: {', '.join(unknown_colorants)}")
            if any(amount < 0 for amount in colorants.values()):
                raise ValueError("발색 산화물 외배합은 음수일 수 없습니다")
            name = str(item.get("name") or cid)
            GlazeRecipe(recipe_id=cid, name=name, materials=materials)
            recipe_id = canonical_recipe_id(materials, colorants)
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
            colorant_note = str(item.get("colorant_note") or "").strip()
            stull_note = f"Stull 참조: {reading.zone.value} — {reading.provenance_note}"
            full_note = f"{note} ({stull_note})" if note else stull_note

            candidate = RecipeCandidate(
                id=recipe_id,
                name=name,
                materials=materials,
                predicted_firing_range=firing_range,
                predicted_firing_note=full_note,
                photo=_placeholder_photo(recipe_id),
                source_type="inferred",
                source_ids=source_ids,
                colorants=colorants,
                colorant_note=colorant_note,
                composition_note=search_candidate.umf_note,
                target_gloss=target.gloss.name if target is not None else "",
                target_transparency=target.transparency.name if target is not None else "",
            )
        except (KeyError, ValueError, TypeError) as exc:
            errors.append(f"{cid}: {exc}")
            continue
        if any(existing.id == candidate.id for existing in built):
            errors.append(f"{cid}: 동일 배합·외배합 후보를 중복 제거했습니다")
        else:
            built.append(candidate)

    if not built:
        raise RecipeCandidateValidationError(
            "유효한 후보가 없습니다 — " + "; ".join(errors)
        )

    return RecipeCandidateSet(tuple(built)), tuple(errors)
