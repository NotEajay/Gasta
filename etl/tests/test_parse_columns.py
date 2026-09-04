"""Column-position parsing of DOE price tables (no network, no PDFs).

The tests build word lists in the same shape `pdfplumber.extract_words()` returns, so
they pin the layout rules that decide which brand a price belongs to. Those rules are
where wrong prices come from: DOE prints a low-high pair per brand, omits brands that
do not operate in an area, and repeats fuel names in a summary block whose columns
mean something else entirely.
"""

from __future__ import annotations

import pytest

from src.parse_bulletin import (
    BulletinNotMachineReadable,
    _assign_prices_by_column,
    _cluster_words_into_rows,
    _find_header_anchors,
    _reject_corrupt_text_layer,
    detect_company_columns,
)

# x positions copied from a real NCR bulletin's header row.
HEADER = [
    ("AREA", 55.0),
    ("PRODUCT", 94.0),
    ("PETRON", 142.3),
    ("SHELL", 193.6),
    ("CALTEX", 238.1),
    ("PHOENIX", 283.1),
    ("TOTAL", 329.6),
    ("FLYING", 368.1),
    ("V", 388.0),
    ("UNIOIL", 413.0),
    ("SEAOIL", 454.3),
    ("PTT", 500.7),
    ("INDEPENDENT", 529.5),
    ("OVERALL", 580.9),
    ("RANGE", 606.4),
]


def _words(cells: list[tuple[str, float]], top: float) -> list[dict]:
    return [
        {"text": text, "x0": x, "x1": x + 12.0, "top": top, "bottom": top + 8.0}
        for text, x in cells
    ]


@pytest.fixture
def anchors():
    rows = _cluster_words_into_rows(_words(HEADER, 123.8))
    found = _find_header_anchors(rows)
    assert found is not None
    return found


def test_header_row_yields_brand_columns_in_page_order(anchors) -> None:
    assert detect_company_columns(anchors) == [
        "PETRON",
        "SHELL",
        "CALTEX",
        "PHOENIX",
        "TOTAL",
        "FLYING V",
        "UNIOIL",
        "SEAOIL",
        "PTT",
    ]


def test_low_and_high_of_a_pair_both_land_on_their_own_brand(anchors) -> None:
    """DOE prints two prices per brand, straddling the header rather than under it."""
    row = _words(
        [
            ("RON", 87.0),
            ("97", 100.0),
            ("95.00", 183.5),
            ("95.60", 206.5),
            ("70.79", 446.5),
            ("80.39", 467.4),
        ],
        147.7,
    )

    fuel, by_company = _assign_prices_by_column(row, anchors)

    assert fuel == "RON 97"
    assert by_company == {"SHELL": [95.00, 95.60], "SEAOIL": [70.79, 80.39]}


def test_absent_brands_get_no_prices(anchors) -> None:
    """A brand with no station in an area is simply missing from the row."""
    row = _words(
        [
            ("DIESEL", 87.0),
            ("86.10", 134.0),
            ("90.10", 160.0),
            ("85.10", 363.0),
            ("86.10", 384.0),
        ],
        175.1,
    )

    _, by_company = _assign_prices_by_column(row, anchors)

    assert by_company == {"PETRON": [86.10, 90.10], "FLYING V": [85.10, 86.10]}


def test_independent_and_overall_range_columns_are_not_brands(anchors) -> None:
    row = _words(
        [
            ("DIESEL", 87.0),
            ("77.00", 530.0),
            ("87.60", 551.0),
            ("77.00", 579.0),
            ("-", 603.0),
            ("90.64", 615.0),
        ],
        175.1,
    )

    _, by_company = _assign_prices_by_column(row, anchors)

    assert by_company == {}


def test_area_name_sharing_the_row_still_resolves_the_fuel(anchors) -> None:
    row = _words(
        [
            ("Caloocan", 46.0),
            ("City", 70.0),
            ("RON", 87.0),
            ("91", 100.0),
            ("72.80", 134.0),
            ("77.20", 160.0),
        ],
        164.5,
    )

    fuel, by_company = _assign_prices_by_column(row, anchors)

    assert fuel == "RON 91"
    assert by_company == {"PETRON": [72.80, 77.20]}


def test_summary_block_below_the_table_is_ignored(anchors) -> None:
    """The prevailing-price summary repeats fuel names under unrelated columns.

    Its "Overall Range" and "Common Price" values sit near the Total and Flying V
    columns, so reading this row would file region-wide figures under those brands.
    """
    row = _words([("Diesel", 226.0), ("77.00", 309.0), ("97.50", 352.0), ("90.30", 404.0)], 464.9)

    assert _assign_prices_by_column(row, anchors) is None


def test_words_a_hair_apart_vertically_form_one_row() -> None:
    """A product label and its prices are not always on the same text line."""
    words = _words([("DIESEL", 87.0)], 175.1) + _words([("86.10", 134.0)], 176.8)

    rows = _cluster_words_into_rows(words)

    assert len(rows) == 1
    assert [w["text"] for w in rows[0]] == ["DIESEL", "86.10"]


def test_unmapped_glyphs_reject_the_bulletin() -> None:
    text = "RON 95 93.26 " + "(cid:9) " * 6

    with pytest.raises(BulletinNotMachineReadable, match="unmapped glyphs"):
        _reject_corrupt_text_layer("scan.pdf", text)


def test_smeared_digits_reject_the_bulletin() -> None:
    """A bad text layer turns one 87.48 cell into "87.488 7.48"."""
    text = " ".join(f"8{n}.4{n}8" for n in range(10)) + " " + " ".join(
        f"7{n}.50" for n in range(15)
    )

    with pytest.raises(BulletinNotMachineReadable, match="more than two decimals"):
        _reject_corrupt_text_layer("scan.pdf", text)


def test_clean_prices_pass_the_text_layer_check() -> None:
    text = " ".join(f"8{n}.40 9{n}.60" for n in range(15))

    _reject_corrupt_text_layer("good.pdf", text)
