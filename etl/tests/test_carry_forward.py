"""Carry-forward fills missing city areas without hitting the network."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from src.carry_forward import areas_present, carry_forward_missing_areas


def test_areas_present_ignores_region_wide_rows() -> None:
    prices = [
        SimpleNamespace(area_name=""),
        SimpleNamespace(area_name="Naga City"),
    ]
    assert areas_present(prices) == {"Naga City"}


def test_carry_forward_adds_only_missing_cities() -> None:
    parsed = SimpleNamespace(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        prices=[
            SimpleNamespace(
                company="Shell",
                fuel_type_code="RON_91",
                price_per_liter=60.0,
                area_name="Batangas City",
            ),
            SimpleNamespace(
                company="Shell",
                fuel_type_code="RON_91",
                price_per_liter=59.0,
                area_name="",
            ),
        ],
        warnings=[],
    )
    prior = [
        SimpleNamespace(
            company="Shell",
            fuel_type_code="RON_91",
            price_per_liter=58.0,
            area_name="Batangas City",
        ),
        SimpleNamespace(
            company="Petron",
            fuel_type_code="RON_91",
            price_per_liter=57.0,
            area_name="Naga City",
        ),
        SimpleNamespace(
            company="Shell",
            fuel_type_code="DIESEL",
            price_per_liter=55.0,
            area_name="Naga City",
        ),
        SimpleNamespace(
            company="Shell",
            fuel_type_code="RON_91",
            price_per_liter=56.0,
            area_name="",
        ),
    ]

    with (
        patch("src.carry_forward._prior_bulletin_date", return_value=date(2026, 9, 15)),
        patch("src.carry_forward.fetch_region_prices_for_week", return_value=prior),
        patch(
            "src.carry_forward._parsed_price",
            side_effect=lambda c, f, p, a: SimpleNamespace(
                company=c, fuel_type_code=f, price_per_liter=p, area_name=a
            ),
        ),
    ):
        carried = carry_forward_missing_areas(parsed)  # type: ignore[arg-type]

    assert carried == ["Naga City"]
    areas = areas_present(parsed.prices)
    assert "Batangas City" in areas
    assert "Naga City" in areas
    assert any(p.area_name == "Naga City" and p.company == "Petron" for p in parsed.prices)
    assert any("Carried forward" in w for w in parsed.warnings)
