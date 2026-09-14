"""7-4절 · 7-7절 — 단위 일치 잔차와 사후 진단.

이 파일에 있는 두 함수는 둘 다 "하면 안 되는 계산"을 막기 위해 있다.

**7-4절 — 단위 일치.** 예측은 **생유약 두께**이고 파단면 실측은 **소성 후
유리질층 두께**다. 소성 중 유약층은 압밀되어 얇아진다(s<1). 그대로 빼서
오차로 쓰면 계수가 **반대 방향으로 수렴한다** — 예측이 실측보다 두꺼워
보이니 k를 낮추는데, 같은 자료를 s로 환산하면 예측이 오히려 얇았던 경우가
생긴다. 그래서 잔차는 반드시 :func:`kiln.thickness.fired_thickness` 를 거쳐

    오차 = t_예측 · s − t_파단면실측

로만 만든다. :func:`residual_mm` 이 그 한 줄이고, 이 모듈에서 파단면과
비교하는 모든 경로가 이 함수를 지나간다.

**7-7절 — 사후 진단은 파단면이 있을 때만.** 편차비 ``1 + k2·m(ρ)/t_abs`` 에서
t_abs는 사용자가 입력한 비중의 함수다. 예측 편차비로 진단하면 결론은
"당신이 낮은 비중을 입력했습니다"뿐이다 — 자기 입력을 되돌려준다. 실측이
없으면 표시하지 않는다(``available=False``). 이는 8-2절의 「판정 불가」와 같은
태도다: 모를 때 '이상 없음'으로 내리지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln.thickness.profile import ThicknessProfile, fired_thickness

__all__ = ["residual_mm", "DeviationDiagnosis", "diagnose_deviation"]


def residual_mm(
    predicted_green_mm: float, measured_fired_mm: float, *, s: float | None = None
) -> float:
    """7-4절 단위 일치 잔차: ``t_예측·s − t_파단면실측`` [mm].

    양수면 예측이 두꺼웠고 음수면 얇았다. **생두께와 소성후 두께를 그대로
    빼면 이 부호가 뒤집힌다** — 예: 예측 생두께 1.40mm, s=0.75, 파단면
    실측 1.20mm이면 순진한 차는 ``+0.20``(예측 과대)이지만 단위를 맞춘
    차는 ``1.05 − 1.20 = −0.15``(예측 과소)다. 이 부호로 계수를 움직이면
    반대 방향으로 수렴한다.

    ``s`` 를 생략하면 부록 C 대장의 압밀 계수 초기값을 쓴다. s와 k2는
    같은 신호(파단면 두께)에만 영향을 주어 **분리 동정되지 않으므로**
    s는 회차마다 역산하지 않고 유약별 고정 상수로 둔다(7-4절, 부록 A).
    """
    return fired_thickness(predicted_green_mm, s) - measured_fired_mm


@dataclass(frozen=True, slots=True)
class DeviationDiagnosis:
    """7-7절 사후 진단 — 파단면이 있을 때만 활성화된다.

    ``available=False`` 면 나머지 값은 전부 ``None`` 이다. 8-2절과 같은
    규칙으로, 판정할 수 없을 때 '편차 없음'이라고 말하지 않는다.
    """

    available: bool
    #: 예측 편차비 = 국소 최대 / 평균 = 1 + k2·m(ρ)/t_abs (생두께 기준, 무차원)
    predicted_ratio: float | None
    #: 실측 편차비 = 파단면 실측 / (평균·s) — 분자·분모 모두 소성 후 단위
    observed_ratio: float | None
    #: 7-4절 단위 일치 잔차 [mm] = 국소최대·s − 파단면실측
    residual: float | None
    reason: str
    notes: tuple[str, ...] = ()


def diagnose_deviation(
    profile: ThicknessProfile,
    fracture_mm: float | None,
    *,
    s: float | None = None,
) -> DeviationDiagnosis:
    """편차비 사후 진단 (7-7절, 7-4절).

    파단면 실측(``fracture_mm``, **소성 후** 두께 [mm])이 있을 때만 예측
    편차비와 실측 편차비를 나란히 놓는다. 실측이 없으면
    ``available=False`` 로 닫는다 — 예측 편차비 혼자서는 사용자가 입력한
    비중을 되돌려주는 것 이상을 말하지 못한다(7-7절).

    분포 모델이 없는 시유 방법(부기·분무·붓칠)에서도 닫는다. 모든 점이
    평균으로 채워져 있어 편차비가 항상 1이고, 그 1은 관측이 아니라
    "분포를 지어내지 않았다"는 표시일 뿐이다(7-5절, 8-2절).

    두 비를 비교할 때 **k2와 s는 분리되지 않는다**(부록 A). 실측 편차비가
    예측보다 크다는 사실은 "k2가 크다"거나 "s가 크다" 중 어느 쪽으로도
    읽힌다. 이 함수는 차이를 보고할 뿐 어느 계수의 값도 주장하지 않는다.
    """
    if fracture_mm is None:
        return DeviationDiagnosis(
            available=False,
            predicted_ratio=None,
            observed_ratio=None,
            residual=None,
            reason=(
                "파단면 실측이 없다 — 7-7절: 예측 편차비로 진단하면 결론은 "
                "「당신이 낮은 비중을 입력했습니다」뿐이다(자기 입력 되돌려주기). "
                "표시하지 않는다"
            ),
        )
    if fracture_mm <= 0:
        return DeviationDiagnosis(
            available=False,
            predicted_ratio=None,
            observed_ratio=None,
            residual=None,
            reason=f"파단면 실측 두께가 0 이하다: {fracture_mm}",
        )
    if not profile.has_distribution:
        return DeviationDiagnosis(
            available=False,
            predicted_ratio=None,
            observed_ratio=None,
            residual=None,
            reason=(
                "분포 모델이 없는 시유 방법이다 — 모든 점이 평균으로 채워져 "
                "편차비가 정의되지 않는다(7-5절). 「판정 불가」로 둔다"
            ),
        )
    if profile.mean_mm <= 0:
        return DeviationDiagnosis(
            available=False,
            predicted_ratio=None,
            observed_ratio=None,
            residual=None,
            reason=f"평균 두께가 0 이하다: {profile.mean_mm}",
        )

    predicted_ratio = profile.local_max_mm / profile.mean_mm
    observed_ratio = fracture_mm / fired_thickness(profile.mean_mm, s)
    residual = residual_mm(profile.local_max_mm, fracture_mm, s=s)

    notes = [
        "7-4절: 예측(생두께)과 파단면(소성후)의 단위를 s로 맞춘 뒤 비교했다 — "
        "그대로 빼면 계수가 반대 방향으로 수렴한다",
        "부록 A: k2와 s는 같은 신호(파단면 두께)에만 영향을 주어 분리 동정되지 "
        "않는다. 이 차이를 어느 한쪽 탓으로 돌리지 않는다",
        "부록 A: k2는 인출 속도에 지배되는데 인출 속도는 기록되지 않는다 — "
        "상수가 아니라 분산을 가진 양이므로 1회차 차이로 k2를 움직이지 않는다",
        "파단면 실측은 국소 1점이다. 그 점이 국소 최대인지는 기록되지 않으므로 "
        "실측 편차비는 국소 최대의 하한으로만 읽는다",
    ]
    if not profile.within_model_scope:
        notes.append(
            "모델 적용 범위 밖 회차다(재시유 또는 건조 미완) — 진단 신뢰도 하향(7-5절)"
        )

    return DeviationDiagnosis(
        available=True,
        predicted_ratio=predicted_ratio,
        observed_ratio=observed_ratio,
        residual=residual,
        reason=(
            f"파단면 실측이 있어 진단을 활성화한다(7-7절). 예측 편차비 "
            f"{predicted_ratio:.3f} vs 실측 편차비 {observed_ratio:.3f}, "
            f"단위 일치 잔차 {residual:+.4f}mm"
        ),
        notes=tuple(notes),
    )
