"""4-4-a절 · 착색 산화물 참고 색상표 — 예측이 아니라 열람이다.

기획서 00절은 "조성으로 결과를 예측한다고 주장하지 않는다"를 원칙으로
못박아 두면서, 4-4-a절에 좁은 예외를 하나 둔다: 도예 실무에서 통용되는
6종 대표 착색 산화물에 한해, 문헌에 보고된 **일반적인 참고 색상**을
표로 보여주고 사용자가 두 산화물 사이 사잇값을 보간하거나, 첨가량·채도·
명도를 조정할 수 있게 한다. 이 모듈이 그 표와 계산을 담는다.

**화면에서 조절한 색으로 첨가량을 되짚는다.** 사용자가 사잇값·첨가량·채도·
명도 중 무엇을 만지든 최종 색 하나가 화면에 뜬다. 이 모듈은 그 최종 색을
"중성 바탕색(첨가 0%) → 문헌 참고색(통상 첨가량 상한)" 직선에 **정사영**해서
그 위치를 첨가량으로 환산한다(``mix`` 의 ``implied_amount_pct``). 채도·
명도를 조작해서 이 직선을 벗어난 색을 만들면 ``match_quality`` 가 내려가고
그 사실이 note에 남는다 — "이 조합의 첨가량 조절만으로는 이 색이 그대로
나오지 않는다"는 뜻이다. **투영은 기하 근사이지 화학 역산이 아니다** — 채도
슬라이더를 올린다고 실제로 더 진한 산화물을 넣은 게 아니라는 사실이 바로
이 match_quality로 드러난다.

**이것이 예측이 아닌 이유** (4-3절 Stull 참조와 같은 자리): 이 모듈은
"이 레시피·이 소성 조건에서 실제로 이 색이 나온다"를 계산하지 않는다.
문헌값 하나를 그대로 돌려주거나, 두 문헌값 사이를 선형 보간하거나,
중성 바탕색과 문헌값 사이를 첨가량 비율로 보간하거나, HSV 공간에서
채도·명도를 옮기거나, 그 결과를 같은 직선에 되쏘아 첨가량으로 읽을
뿐이다 — 입력에 조성이나 소성 조건이 전혀 들어가지 않는다. 크롬처럼
첨가량에 따라 **질적으로 다른 색**(예: 극소량에서 핑크)이 나오는 경우는
이 직선 모델로 재현되지 않는다 — 그래서 그 사실은 여전히 `note`의
캐비어트로만 남기고, 별도 발색 곡선을 만들지 않는다.

**그램 수는 화학이 아니라 산수다.** ``dose_grams`` 는 "첨가량 wt%는
정의상 건조 재료 100g당 그램수"라는 관행을 배치 무게에 곱할 뿐이다 —
동정된 계수나 실측을 쓰지 않으므로 부록 C 대상이 아니다.

**경계 (`DECISIONS.md` "착색 산화물 참고 색상표를 조성 예측으로 확장"
항목이 지키는 것)**: 이 모듈은 :mod:`kiln.search` 의 입력이 아니고
5-4절 목적함수에도 들어가지 않는다. 산화 소성·통상 첨가량 기준값 하나만
등록하며, 분위기별·농도별 표로 늘리지 않는다 — 실측 없이 표를 늘리는
것은 00절이 막는 "조성으로 결과를 예측한다"의 다른 얼굴이기 때문이다.
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass

__all__ = ["ColorantOxide", "COLORANTS", "colorant", "ColorMix", "mix", "dose_grams"]

_CAVEAT = (
    "문헌 참고값 — 실제 소성 결과는 기저 조성·두께·소성 분위기·냉각에 따라 "
    "크게 달라진다. 예측이 아니라 참고 색상표 열람이다(4-4-a절)."
)

#: 첨가량 0%일 때의 표시용 중성 바탕색 — **특정 유약의 실제 색이 아니다.**
#: 슬라이더가 "옅음 → 짙음"을 눈으로 보여주고, 첨가량을 되짚어 낼 직선의
#: 한쪽 끝을 잡기 위한 표시 기준점일 뿐이다.
_NEUTRAL_BASE_HEX = "#e9e2d3"

#: 투영으로 되짚은 첨가량이 통상범위 상한의 몇 배까지 갈 수 있는가 — 채도·
#: 명도를 극단으로 밀어도 그램 수가 무한히 커지지 않도록 잘라 둔다.
_MAX_IMPLIED_MULTIPLE = 5.0


@dataclass(frozen=True, slots=True)
class ColorantOxide:
    """착색 산화물 하나의 참고 색상과 통상 첨가량.

    ``hex`` 는 산화 소성·투명 유약 기준의 **대표값**이다 — 실측 분포가
    아니라 문헌에서 흔히 보고되는 색상 하나를 대표로 고른 것이다.

    ``typical_pct`` 는 도예 문헌에서 흔히 보고되는 **통상 첨가량 범위**
    (건조 재료 대비 wt%)다. 슬라이더 눈금과 첨가량 역산의 기준점이지,
    이 범위를 넘으면 안 된다는 규칙이 아니다.
    """

    symbol: str
    name_ko: str
    hex: str
    note: str
    typical_pct: tuple[float, float]

    def __post_init__(self) -> None:
        h = self.hex.lstrip("#")
        if len(h) != 6 or any(c not in "0123456789abcdefABCDEF" for c in h):
            raise ValueError(f"{self.symbol!r}의 hex 색상값이 올바르지 않다: {self.hex!r}")
        if _CAVEAT not in self.note:
            # 4-4-a절: 이 문구가 빠지면 참고표가 예측으로 읽힌다.
            raise ValueError(f"{self.symbol!r}의 note에 문헌 참고값 캐비어트가 없다")
        lo, hi = self.typical_pct
        if not (0.0 <= lo < hi):
            raise ValueError(f"{self.symbol!r}의 typical_pct가 올바르지 않다: {self.typical_pct!r}")


def _hex_to_rgb01(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (r, g, b)


def _rgb01_to_hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb)


def _lerp_rgb(
    lo: tuple[float, float, float], hi: tuple[float, float, float], t: float
) -> tuple[float, float, float]:
    return (lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t)


def _dot(u: tuple[float, float, float], v: tuple[float, float, float]) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _sub(u: tuple[float, float, float], v: tuple[float, float, float]) -> tuple[float, float, float]:
    return (u[0] - v[0], u[1] - v[1], u[2] - v[2])


#: 6종 대표 착색 산화물(4-4-a절 최소 세트). 산화 소성·투명 유약 기준 대표값과
#: 문헌 통상 첨가량(wt%) 범위 하나씩만 둔다.
COLORANTS: dict[str, ColorantOxide] = {
    o.symbol: o
    for o in (
        ColorantOxide(
            "Fe2O3", "산화철", "#8a5a2b",
            f"산화 소성·투명 유약 기준 황갈색(amber) 계열. {_CAVEAT}",
            typical_pct=(1.0, 8.0),
        ),
        ColorantOxide(
            "CuO", "산화동", "#2f7d4f",
            f"산화 소성 기준 녹색(환원 소성에서는 적색 계열로 크게 달라지나, "
            f"분위기별 표는 두지 않는다 — 4-4-a절). {_CAVEAT}",
            typical_pct=(0.5, 5.0),
        ),
        ColorantOxide(
            "Cr2O3", "산화크롬", "#4f7a3a",
            f"통상 첨가량(수 %)의 산화 소성 기준 황록색. 극소량(0.1% 안팎, "
            f"주석 함유 유약과 결합 시)에서는 핑크 계열로 크게 달라지나, "
            f"농도별 표는 두지 않는다 — 4-4-a절. {_CAVEAT}",
            typical_pct=(0.1, 3.0),
        ),
        ColorantOxide(
            "CoO", "산화코발트", "#1e3f7f",
            f"소량으로도 짙게 발색하는 청색. 산화·환원에서 큰 차이가 없어 기준값 하나로 둔다. {_CAVEAT}",
            typical_pct=(0.1, 2.0),
        ),
        ColorantOxide(
            "NiO", "산화니켈", "#6b6650",
            f"산화 소성 기준 회갈색(khaki-grey). {_CAVEAT}",
            typical_pct=(1.0, 5.0),
        ),
        ColorantOxide(
            "MnO2", "산화망간", "#5c3a45",
            f"산화 소성 기준 자갈색(purplish brown). {_CAVEAT}",
            typical_pct=(1.0, 6.0),
        ),
    )
}


def colorant(symbol: str) -> ColorantOxide:
    """기호로 참고 색상을 찾는다. 없으면 등록된 기호 목록과 함께 KeyError."""
    try:
        return COLORANTS[symbol]
    except KeyError:
        raise KeyError(
            f"{symbol!r}는 착색 산화물 참고 색상표에 없다(4-4-a절). "
            f"등록된 산화물: {sorted(COLORANTS)}"
        ) from None


@dataclass(frozen=True, slots=True)
class ColorMix:
    """참고 색상 계산 결과. ``notes`` 는 항상 문헌 참고값 캐비어트를 포함한다.

    ``implied_amount_pct`` · ``match_quality`` 는 **역산 결과**다 —
    화면에 뜬 최종 색(``hex``)을 중성 바탕색↔참고색 직선에 정사영해서
    "이 색을 내려면 첨가량이 얼마여야 하는가"를 되짚은 것. 사잇값·첨가량만
    조절했다면(채도·명도 델타가 0이면) ``match_quality`` 는 정확히 1.0이고
    ``implied_amount_pct`` 는 입력한 ``amount_pct`` 와 같아진다 — 채도·
    명도로 그 직선을 벗어날수록 1.0에서 멀어진다.
    """

    hex: str
    rgb: tuple[float, float, float]
    notes: tuple[str, ...]
    implied_amount_pct: float
    match_quality: float


def mix(
    symbol_a: str,
    symbol_b: str | None = None,
    blend_t: float = 0.0,
    *,
    amount_pct: float | None = None,
    saturation_delta: float = 0.0,
    brightness_delta: float = 0.0,
) -> ColorMix:
    """참고 색상 사잇값·첨가량·채도·명도를 계산하고, 첨가량을 되짚는다.

    **예측이 아니라 표시값 계산 + 기하 투영이다.**

    ``blend_t``: 0이면 ``symbol_a`` 그대로, 1이면 ``symbol_b`` 그대로,
    사이값은 RGB 선형 보간이다(4-4-a절: "이 산화물 조합에서 실제로
    이 색이 나온다"는 배합 모델이 아니라, 두 문헌값 사이를 잇는 표시값).

    ``amount_pct``: 건조 재료 대비 wt%. ``None`` 이면(기본값) 첨가량을
    반영하지 않고 문헌 참고색 그대로 쓴다(=통상 첨가량 상한과 같은 자리).
    값을 주면 0%(중성 바탕색)와 ``symbol_a`` 의 문헌 통상 첨가량 상한
    사이를 선형 보간한다.

    ``saturation_delta`` · ``brightness_delta``: [-1, 1]로 잘라 HSV의
    S·V에 더한다. 둘 다 [0, 1]로 다시 잘린다.

    반환된 :class:`ColorMix` 의 ``implied_amount_pct`` 는 최종 색을 다시
    "중성 바탕색 → 문헌 참고색" 직선에 정사영해 얻은 값이다 — 사잇값·
    채도·명도 **무엇을 움직여도** 최종 색 하나에 대해 일관되게 계산된다.
    """
    a = colorant(symbol_a)
    notes = [a.note]

    if symbol_b is not None and symbol_b != symbol_a:
        b = colorant(symbol_b)
        t = max(0.0, min(1.0, blend_t))
        ref_rgb = _lerp_rgb(_hex_to_rgb01(a.hex), _hex_to_rgb01(b.hex), t)
        notes.append(b.note)
        notes.append(
            f"{a.name_ko}↔{b.name_ko} 사잇값(t={t:.2f}) — RGB 선형 보간이며 "
            "실제 배합 발색 곡선이 아니다(4-4-a절)"
        )
    else:
        ref_rgb = _hex_to_rgb01(a.hex)

    neutral_rgb = _hex_to_rgb01(_NEUTRAL_BASE_HEX)
    lo, hi = a.typical_pct

    if amount_pct is None:
        tinted_rgb = ref_rgb
    else:
        intensity = 0.0 if hi <= 0 else max(0.0, min(1.0, amount_pct / hi))
        tinted_rgb = _lerp_rgb(neutral_rgb, ref_rgb, intensity)
        notes.append(
            f"첨가량 {amount_pct:.2f}% 기준 — 문헌 통상범위 {lo:.1f}–{hi:.1f}%에 대한 "
            "표시 강도(중성 바탕색↔참고색 선형 보간)이며 실제 발색 곡선이 아니다"
            "(4-4-a절). 크롬처럼 첨가량에 따라 질적으로 다른 색이 나오는 경우는 "
            "이 보간으로 재현되지 않는다 — note를 함께 본다."
        )

    h, s, v = colorsys.rgb_to_hsv(*tinted_rgb)
    s = max(0.0, min(1.0, s + max(-1.0, min(1.0, saturation_delta))))
    v = max(0.0, min(1.0, v + max(-1.0, min(1.0, brightness_delta))))
    final_rgb = colorsys.hsv_to_rgb(h, s, v)

    # ── 화면에 뜬 색을 "중성 바탕색 → 참고색" 직선에 되쏘아 첨가량으로 읽는다.
    axis = _sub(ref_rgb, neutral_rgb)
    axis_len2 = _dot(axis, axis)
    if axis_len2 == 0.0:
        implied_t = 0.0
        match_quality = 1.0
    else:
        diff = _sub(final_rgb, neutral_rgb)
        raw_t = _dot(diff, axis) / axis_len2
        implied_t = max(0.0, min(_MAX_IMPLIED_MULTIPLE, raw_t))
        projected = (
            neutral_rgb[0] + implied_t * axis[0],
            neutral_rgb[1] + implied_t * axis[1],
            neutral_rgb[2] + implied_t * axis[2],
        )
        residual = _dot(_sub(final_rgb, projected), _sub(final_rgb, projected)) ** 0.5
        axis_len = axis_len2**0.5
        match_quality = max(0.0, 1.0 - residual / axis_len)

    implied_amount_pct = implied_t * hi
    if match_quality < 0.7:
        notes.append(
            f"이 색은 {a.name_ko} 첨가량 조절만으로는 그대로 나오지 않는다 "
            f"(일치도 {match_quality:.0%}) — 채도·명도 조정이 이 산화물의 "
            "표시 축을 크게 벗어났다는 뜻이다(4-4-a절: 기하 근사이지 화학 역산이 아니다)."
        )

    return ColorMix(
        hex=_rgb01_to_hex(final_rgb),
        rgb=final_rgb,
        notes=tuple(notes),
        implied_amount_pct=implied_amount_pct,
        match_quality=match_quality,
    )


def dose_grams(amount_pct: float, batch_dry_g: float) -> float:
    """첨가량 wt%와 배치의 건조 재료 총량으로 실제 계량할 그램 수를 낸다.

    ``amount_pct`` 는 정의상 "건조 재료 100g당 그램수"다. 이 함수는 그
    정의를 배치 무게에 곱하는 산수일 뿐 — 화학도 캘리브레이션도 아니라서
    부록 C 대상이 아니다.
    """
    if batch_dry_g < 0 or amount_pct < 0:
        raise ValueError("첨가량과 배치 무게는 음수일 수 없다")
    return amount_pct / 100.0 * batch_dry_g
