"""Deterministic local glaze previews used when the paid image quota is exhausted."""

from __future__ import annotations

from hashlib import sha256
from html import escape
import random


_COLORANT_RGB: dict[str, tuple[int, int, int]] = {
    "Fe2O3": (151, 72, 42),
    "CuO": (42, 137, 129),
    "Cr2O3": (68, 119, 68),
    "CoO": (42, 78, 151),
    "NiO": (124, 111, 88),
    "MnO2": (104, 76, 91),
}


def _mix_color(colorants: dict[str, float]) -> tuple[int, int, int]:
    known = [(max(amount, 0.0), _COLORANT_RGB[name]) for name, amount in colorants.items() if name in _COLORANT_RGB]
    total = sum(amount for amount, _ in known)
    if total <= 0:
        return (204, 199, 184)
    mixed = tuple(round(sum(amount * rgb[channel] for amount, rgb in known) / total) for channel in range(3))
    strength = min(0.32 + total / 8.0, 0.92)
    clay = (204, 199, 184)
    return tuple(round(clay[channel] * (1 - strength) + mixed[channel] * strength) for channel in range(3))


def _hex(rgb: tuple[int, int, int], shift: int = 0) -> str:
    return "#" + "".join(f"{max(0, min(255, channel + shift)):02x}" for channel in rgb)


def build_glaze_preview_svg(
    *,
    candidate_name: str,
    materials: dict[str, float],
    colorants: dict[str, float],
    target_gloss: str,
    target_transparency: str,
) -> bytes:
    """Return a safe, dependency-free SVG preview derived from recipe inputs.

    This is deliberately presented as a synthetic preview rather than an AI or
    measured firing result.  A deterministic seed keeps the same recipe visually
    stable across requests while still giving different candidates distinct tiles.
    """

    recipe_key = repr(
        (
            candidate_name,
            sorted(materials.items()),
            sorted(colorants.items()),
            target_gloss,
            target_transparency,
        )
    )
    seed = int.from_bytes(sha256(recipe_key.encode("utf-8")).digest()[:8], "big")
    rng = random.Random(seed)
    glaze = _mix_color(colorants)
    gloss = target_gloss.strip().upper()
    transparency = target_transparency.strip().upper()
    highlight_opacity = {
        "DRY": 0.08,
        "MATTE": 0.14,
        "SATIN": 0.28,
        "SEMI_GLOSS": 0.43,
        "GLOSS": 0.62,
    }.get(gloss, 0.30)
    glaze_opacity = {
        "OPAQUE": 1.0,
        "SEMI_OPAQUE": 0.92,
        "TRANSLUCENT": 0.82,
        "TRANSPARENT": 0.70,
    }.get(transparency, 0.94)
    speckles = "".join(
        f'<circle cx="{rng.randint(245, 779)}" cy="{rng.randint(244, 760)}" '
        f'r="{rng.randint(2, 10)}" fill="{_hex(glaze, rng.randint(-38, 28))}" '
        f'opacity="{rng.uniform(0.08, 0.30):.2f}"/>'
        for _ in range(42)
    )
    safe_title = escape(candidate_name, quote=True)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<title>{safe_title} synthetic glaze preview</title>
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eee9df"/><stop offset="1" stop-color="#cfc7b9"/></linearGradient>
  <radialGradient id="glaze" cx="38%" cy="27%" r="72%"><stop stop-color="{_hex(glaze, 38)}"/><stop offset="0.48" stop-color="{_hex(glaze)}"/><stop offset="1" stop-color="{_hex(glaze, -52)}"/></radialGradient>
  <radialGradient id="shine" cx="36%" cy="22%" r="48%"><stop stop-color="#ffffff" stop-opacity="{highlight_opacity:.2f}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  <clipPath id="tile"><rect x="208" y="202" width="608" height="608" rx="96"/></clipPath>
  <filter id="shadow"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#403a31" flood-opacity=".28"/></filter>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<rect x="208" y="202" width="608" height="608" rx="96" fill="#b9aa94" filter="url(#shadow)"/>
<g clip-path="url(#tile)" opacity="{glaze_opacity:.2f}">
  <rect x="208" y="202" width="608" height="608" fill="url(#glaze)"/>
  {speckles}
  <ellipse cx="430" cy="354" rx="250" ry="205" fill="url(#shine)"/>
  <path d="M210 680 C360 620 580 790 818 650 L818 812 L210 812Z" fill="{_hex(glaze, -28)}" opacity=".24"/>
</g>
<rect x="208" y="202" width="608" height="608" rx="96" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="8"/>
</svg>'''
    return svg.encode("utf-8")
