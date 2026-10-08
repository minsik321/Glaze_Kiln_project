"""Stable recipe identity: base composition plus external colorant percentages.

Candidate positions and LLM-generated names are presentation data. They must
never key personal calibration. Legacy aggregates keyed by cand-N cannot be
assigned to a composition safely; only individual recorded runs are recoverable.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import unicodedata
from collections.abc import Mapping
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


def _parts(values: Mapping[str, float], *, normalize: bool) -> list[list[str]]:
    parts: dict[str, Decimal] = {}
    for name, amount in values.items():
        key = unicodedata.normalize("NFC", str(name).strip())
        if not key or isinstance(amount, bool) or not math.isfinite(float(amount)) or float(amount) < 0:
            raise ValueError("Recipe amounts must be finite nonnegative numbers with material names")
        if key in parts:
            raise ValueError("Duplicate normalized material name")
        parts[key] = Decimal(str(amount))
    total = sum(parts.values(), Decimal(0))
    if normalize and total <= 0:
        raise ValueError("Recipe must contain a positive base composition")
    scale = Decimal(100) / total if normalize else Decimal(1)
    quantum = Decimal("0.000001")
    return [
        [name, format((amount * scale).quantize(quantum, rounding=ROUND_HALF_UP), "f")]
        for name, amount in sorted(parts.items()) if amount > 0
    ]


def canonical_recipe_id(
    materials: Mapping[str, float], colorants: Mapping[str, float] | None = None
) -> str:
    """Order/scale-independent base recipe ID; colorants remain external wt%.

Six decimal places remove harmless float arithmetic noise. This precision is
versioned in the prefix, so a future normalization change cannot alias v1 keys.
"""
    payload = {"materials": _parts(materials, normalize=True), "colorants": _parts(colorants or {}, normalize=False)}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "glaze-v1-" + hashlib.sha256(encoded).hexdigest()


def normalize_run_recipe(run: dict[str, Any]) -> dict[str, Any]:
    """Copy a run and recover canonical identity from recorded ingredients.

An old selected candidate can supply omitted colorants only when both its old
ID and its base composition match the selected recipe. No cand-N aggregate is
ever imported. Missing compositions remain readable and are not invented.
"""
    normalized = copy.deepcopy(run)
    recipe = normalized.get("recipe") or {}
    materials = recipe.get("materials") or {}
    if not materials:
        return normalized
    intake = normalized.get("intake") or {}
    bundle = intake.get("candidates") or {}
    candidates = bundle.get("candidates") or []
    if "colorants" not in recipe:
        for candidate in candidates:
            if candidate.get("id") == recipe.get("id") and candidate.get("materials"):
                if canonical_recipe_id(candidate["materials"]) == canonical_recipe_id(materials):
                    recipe["colorants"] = copy.deepcopy(candidate.get("colorants") or {})
                    recipe["colorant_note"] = candidate.get("colorant_note") or ""
                    break
    recipe.setdefault("colorants", {})
    recipe["id"] = canonical_recipe_id(materials, recipe["colorants"])
    normalized["recipe"] = recipe
    old_selected = bundle.get("selected_id")
    unique: dict[str, dict] = {}
    for candidate in candidates:
        if not candidate.get("materials"):
            continue
        old_id = candidate.get("id")
        candidate["id"] = canonical_recipe_id(candidate["materials"], candidate.get("colorants"))
        if old_id == old_selected:
            bundle["selected_id"] = candidate["id"]
        unique.setdefault(candidate["id"], candidate)
    if candidates:
        bundle["candidates"] = list(unique.values())
    return normalized
