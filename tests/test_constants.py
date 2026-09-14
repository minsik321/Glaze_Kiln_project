"""부록 C · 미정값 대장의 규율을 테스트한다.

이 테스트가 지키는 것은 수치가 아니라 **기획서 00절의 약속**이다:
계수의 값을 주장하지 않고 동정 절차만 주장한다.
"""

import pytest

from kiln import constants as C


def test_registry_covers_appendix_c():
    """부록 C 표의 기호가 전부 대장에 있다."""
    expected = {
        "k1", "absorption", "k2", "m_rho", "g_rho", "rho_dry", "s", "E",
        "alpha", "beta", "Kh", "UA", "sensor_offset",
        "kaolin_background", "bentonite_fixed",
    }
    assert set(C.REGISTRY) == expected


@pytest.mark.parametrize("symbol", ["E", "alpha", "beta", "Kh", "sensor_offset"])
def test_undetermined_coefficients_refuse_to_yield_a_value(symbol):
    """부록 C에서 '미정'인 계수는 .value가 던진다.

    E는 명시적으로 "값 기재 금지"다. 조용히 기본값을 내주면 00절이 금지한
    주장이 코드 안에서 되살아난다.
    """
    coeff = C.get(symbol)
    assert not coeff.is_determined
    with pytest.raises(C.UndeterminedCoefficientError):
        coeff.value


def test_undetermined_error_names_the_identification_procedure():
    """값이 없어도 동정 절차가 개시되어 있으면 요건을 충족한다 (부록 C)."""
    with pytest.raises(C.UndeterminedCoefficientError) as excinfo:
        C.get("E").value
    message = str(excinfo.value)
    assert "콘" in message and "역산" in message
    assert "assume" in message


def test_assume_keeps_provenance_undetermined():
    """가정값을 세워도 provenance는 UNDETERMINED로 남는다.

    민감도 스윕은 가능해야 하지만, 결과 보고서에서 "가정에 근거함"이
    지워지면 안 된다.
    """
    assumed = C.get("E").assume(300_000.0, "10-3절 민감도 표의 중앙값")
    assert assumed.value == 300_000.0
    assert assumed.provenance is C.Provenance.UNDETERMINED
    assert not assumed.provenance.is_trustworthy
    assert "가정" in assumed.annotation()
    # 대장 원본은 오염되지 않는다
    assert not C.get("E").is_determined


def test_calibrated_upgrades_provenance():
    """실측 동정은 provenance를 CALIBRATED로 올린다 (10-2절)."""
    calibrated = C.get("k1").calibrated(0.62, "타일 4장 회귀, 2026-09-10")
    assert calibrated.provenance is C.Provenance.CALIBRATED
    assert calibrated.provenance.is_trustworthy
    assert C.get("k1").provenance is C.Provenance.LITERATURE


def test_literature_values_carry_the_required_annotation():
    """6-4절: 화면의 권장 범위 수치에는 출처를 병기한다."""
    assert C.get("k1").annotation() == "(문헌 추정 초기값 · 캘리브레이션 전)"
    assert C.get("rho_dry").annotation() == "(문헌 추정 초기값 · 캘리브레이션 전)"


def test_rho_dry_range_matches_plan():
    """부록 C: ρ_dry 추정 범위 1.3–1.7. 7-2절 감도 계산의 근거."""
    rho = C.get("rho_dry")
    assert (rho.lower, rho.upper) == (1.3, 1.7)


def test_e_range_matches_sensitivity_table():
    """10-3절 E 민감도 표가 다루는 범위는 200–400 kJ/mol."""
    e = C.get("E")
    assert (e.lower, e.upper) == (200_000.0, 400_000.0)


def test_absorption_documents_that_it_is_not_separable_from_k1():
    """부록 A: k₁과 흡수율은 곱으로만 식별된다. 분리 불가."""
    assert "분리 불가" in C.get("absorption").identification


def test_k2_documents_the_draw_speed_problem():
    """부록 A #39: k₂는 인출 속도에 지배되는데 인출 속도는 기록되지 않는다."""
    assert "분산" in C.get("k2").note


def test_coefficients_are_immutable():
    """계수는 frozen. 실수로 전역 상태를 바꾸는 경로를 막는다."""
    with pytest.raises(Exception):
        C.get("k1")._value = 9.9  # type: ignore[misc]


def test_unknown_symbol_lists_what_exists():
    with pytest.raises(KeyError) as excinfo:
        C.get("k9")
    assert "부록 C" in str(excinfo.value)
