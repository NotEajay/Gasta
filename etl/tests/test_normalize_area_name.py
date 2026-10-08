"""Area label cleanup for DOE province + city mashups."""

from __future__ import annotations

import pytest

from src.area_names import normalize_area_name


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Cavite Tagaytay City", "Tagaytay City"),
        ("CAVITE TAGAYTAY CITY", "Tagaytay City"),
        ("Rizal Antipolo", "Antipolo"),
        ("Laguna Sta. Rosa", "Sta. Rosa"),
        ("Batangas City", "Batangas City"),
        ("Naga City", "Naga City"),
        ("Camarines Sur Naga City", "Naga City"),
        ("Albay Legazpi City", "Legazpi City"),
        ("", ""),
    ],
)
def test_normalize_area_strips_province_not_city_itself(raw: str, expected: str) -> None:
    assert normalize_area_name(raw) == expected


def test_normalize_area_removes_ocr_table_punctuation() -> None:
    assert normalize_area_name("Ilocos Norte Batac City {") == "Batac City"
    assert normalize_area_name("Cagayan Solana _—[") == "Solana"
    assert normalize_area_name("GAPANCITY") == "Gapan City"
