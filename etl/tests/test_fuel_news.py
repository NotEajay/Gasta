from __future__ import annotations

from datetime import datetime, timezone
from email.message import Message
from types import SimpleNamespace
import urllib.error
import urllib.request

import pytest

from src.fuel_news import (
    FeedError,
    FeedItem,
    FetchResult,
    NewsSource,
    SourceState,
    SupabaseNewsRepository,
    _PostgrestClient,
    _bounded_text,
    article_dedup_hash,
    canonicalize_url,
    extract_adjustments,
    extract_effective_time,
    fetch_feed,
    import_fuel_news,
    is_fuel_news_candidate,
    parse_article,
    parse_feed,
    request_headers,
)


SOURCE = NewsSource(
    key="synthetic_business",
    publisher="Synthetic Business",
    feed_url="https://feeds.example.test/business.xml",
    allowed_hosts=("example.test",),
)
PUBLISHED = datetime(2026, 11, 16, 3, 30, tzinfo=timezone.utc)  # 11:30 Asia/Manila


def item(
    headline: str,
    excerpt: str = "",
    *,
    url: str = "https://news.example.test/business/fuel-adjustment",
    guid: str | None = "story-1",
    published_at: datetime | None = PUBLISHED,
) -> FeedItem:
    return FeedItem(
        guid=guid,
        canonical_url=url,
        headline=headline,
        excerpt=excerpt,
        published_at=published_at,
    )


def amounts(parsed: object) -> dict[str, int]:
    return {
        adjustment.fuel_type: adjustment.amount_centavos
        for adjustment in parsed.adjustments
    }


def test_bounded_text_never_exceeds_requested_limit() -> None:
    assert _bounded_text("x" * 700, 500) == "x" * 499 + "…"
    assert len(_bounded_text("word " * 200, 500)) <= 500
    assert _bounded_text("abc", 1) == "…"
    assert _bounded_text("abc", 0) == ""


def test_parse_rss_metadata_and_filter_candidates_without_full_article() -> None:
    rss = b"""<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <item>
          <guid>fuel-42</guid>
          <title>Oil firms announce diesel rollback</title>
          <link>https://news.example.test/business/fuel-cut?utm_source=rss</link>
          <pubDate>Mon, 16 Nov 2026 03:30:00 +0000</pubDate>
          <description><![CDATA[Diesel will decrease by P1.20 per liter Tuesday.]]></description>
          <content:encoded><![CDATA[UNTRUSTED FULL ARTICLE BODY MUST NOT BE STORED]]></content:encoded>
          <category>Fuel prices</category>
        </item>
        <item>
          <guid>markets-1</guid>
          <title>Stocks end higher on Monday</title>
          <link>https://news.example.test/business/stocks</link>
          <description>Local shares advanced.</description>
        </item>
      </channel>
    </rss>"""

    parsed = parse_feed(rss, SOURCE)

    assert len(parsed) == 2
    assert parsed[0].guid == "fuel-42"
    assert parsed[0].canonical_url == "https://news.example.test/business/fuel-cut"
    assert parsed[0].excerpt == "Diesel will decrease by P1.20 per liter Tuesday."
    assert "FULL ARTICLE" not in parsed[0].excerpt
    assert parsed[0].published_at == PUBLISHED
    assert is_fuel_news_candidate(parsed[0])
    assert not is_fuel_news_candidate(parsed[1])


def test_generic_category_cannot_make_unrelated_story_a_candidate() -> None:
    unrelated = FeedItem(
        guid="opinion-1",
        canonical_url="https://news.example.test/business/opinion",
        headline="The plumbing that powers growth",
        excerpt="A discussion of payments infrastructure and economic output.",
        published_at=PUBLISHED,
        categories=("Business", "global oil prices"),
    )

    assert not is_fuel_news_candidate(unrelated)


@pytest.mark.parametrize(
    "headline,excerpt,expected",
    [
        ("Oil firms announce fuel price rollback", "P1 per liter cut", True),
        ("Gasoline prices to rise Tuesday", "", True),
        ("World crude oil prices rise", "Brent futures gained 2%", False),
        ("Oil company reports record profit", "", False),
        ("Diesel engine sales improve", "Truck demand rose", False),
    ],
)
def test_candidate_filter_is_deterministic(
    headline: str, excerpt: str, expected: bool
) -> None:
    assert is_fuel_news_candidate(item(headline, excerpt)) is expected


def test_forecast_is_not_promoted_to_confirmed() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Fuel price hike expected next week",
            "Gasoline may increase by P1.25 per liter, analysts estimated.",
        ),
    )

    assert parsed.classification == "forecast"
    assert parsed.direction == "hike"
    assert amounts(parsed) == {"GASOLINE": 125}


def test_confirmed_hike_extracts_signed_integer_centavos() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Oil firms announce pump price hike",
            "Effective Tuesday, gasoline will increase by P1.50 per liter and "
            "diesel by P0.80 per liter.",
        ),
    )

    assert parsed.classification == "confirmed"
    assert parsed.direction == "hike"
    assert amounts(parsed) == {"GASOLINE": 150, "DIESEL": 80}


def test_confirmed_rollback_extracts_negative_centavos() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Fuel rollback takes effect Tuesday",
            "Oil companies will cut gasoline by P1.10 per liter, diesel by P0.90 "
            "per liter, and kerosene by P0.75 per liter.",
        ),
    )

    assert parsed.classification == "confirmed"
    assert parsed.direction == "rollback"
    assert amounts(parsed) == {
        "GASOLINE": -110,
        "DIESEL": -90,
        "KEROSENE": -75,
    }


def test_mixed_adjustment_preserves_each_direction() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Mixed fuel price adjustment announced",
            "Gasoline will increase by P0.40 per liter; diesel will decrease by "
            "P0.70 per liter.",
        ),
    )

    assert parsed.classification == "confirmed"
    assert parsed.direction == "mixed"
    assert amounts(parsed) == {"GASOLINE": 40, "DIESEL": -70}


def test_omitted_fuel_has_no_zero_or_synthetic_adjustment() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Diesel rollback announced",
            "Diesel will decrease by P1.25 per liter effective Tuesday.",
        ),
    )

    assert amounts(parsed) == {"DIESEL": -125}
    assert "GASOLINE" not in amounts(parsed)
    assert "KEROSENE" not in amounts(parsed)


def test_relevant_article_remains_news_update_when_amount_is_not_safe() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Oil firms discuss pump price adjustment",
            "Companies said a fuel price announcement will be issued later.",
        ),
    )

    assert parsed.classification == "news_update"
    assert parsed.direction == "news_update"
    assert parsed.parse_status == "unstructured"
    assert parsed.adjustments == ()


def test_misleading_totals_and_non_per_liter_amounts_are_rejected() -> None:
    text = (
        "Year-to-date gasoline increases totaled P12.35 per liter. "
        "The company also budgeted P500 million. "
        "Diesel will decrease Tuesday, but no per-liter amount was announced."
    )

    assert extract_adjustments(text) == ()


def test_current_adjustment_survives_separate_historical_total() -> None:
    parsed = parse_article(
        SOURCE,
        item(
            "Diesel price cut announced",
            "Diesel will decrease by P0.70 per liter Tuesday. Year-to-date diesel "
            "adjustments now total P8.40 per liter.",
        ),
    )

    assert amounts(parsed) == {"DIESEL": -70}


def test_dedup_uses_source_and_canonical_url_not_mutable_feed_text() -> None:
    first = item(
        "Initial headline",
        url="https://news.example.test/story/42?utm_campaign=rss&b=2&a=1",
        guid="old-guid",
    )
    second = item(
        "Corrected headline",
        url="https://news.example.test/story/42?a=1&b=2#section",
        guid="new-guid",
    )
    first_url = canonicalize_url(first.canonical_url, SOURCE)
    second_url = canonicalize_url(second.canonical_url, SOURCE)
    first = FeedItem(**{**first.__dict__, "canonical_url": first_url})
    second = FeedItem(**{**second.__dict__, "canonical_url": second_url})

    assert first_url == second_url
    assert article_dedup_hash(SOURCE, first) == article_dedup_hash(SOURCE, second)


def test_effective_datetime_is_interpreted_in_asia_manila() -> None:
    effective = extract_effective_time(
        "The rollback takes effect at 6 a.m. on November 17, 2026.", PUBLISHED
    )

    assert effective is not None
    assert effective.precision == "minute"
    assert effective.value.isoformat() == "2026-11-17T06:00:00+08:00"
    assert effective.value.astimezone(timezone.utc).isoformat() == (
        "2026-11-16T22:00:00+00:00"
    )


def test_relative_effective_weekday_uses_publication_date_in_manila() -> None:
    effective = extract_effective_time("Effective Tuesday at midnight.", PUBLISHED)

    assert effective is not None
    assert effective.value.isoformat() == "2026-11-17T00:00:00+08:00"


def test_conditional_request_headers_are_sanitized() -> None:
    headers = request_headers(
        SourceState(etag='"abc"', last_modified="Mon, 16 Nov 2026 03:00:00 GMT")
    )

    assert "GasTaFuelNewsImporter" in headers["User-Agent"]
    assert headers["If-None-Match"] == '"abc"'
    assert headers["If-Modified-Since"].endswith("GMT")
    assert "If-None-Match" not in request_headers(SourceState(etag="bad\r\nheader"))


def test_postgrest_rejects_redirect_before_forwarding_service_key() -> None:
    calls: list[urllib.request.Request] = []

    def opener(request: urllib.request.Request, **kwargs: object) -> object:
        del kwargs
        calls.append(request)
        headers = Message()
        headers["Location"] = "https://attacker.test/steal"
        raise urllib.error.HTTPError(request.full_url, 302, "Found", headers, None)

    client = _PostgrestClient(
        "https://project.supabase.co",
        "service-secret",
        opener=opener,
    )
    with pytest.raises(RuntimeError, match="redirects are not allowed"):
        client.request("GET", "fuel_news_source_state")

    assert len(calls) == 1
    assert calls[0].full_url.startswith("https://project.supabase.co/rest/v1/")


def test_postgrest_rejects_cross_origin_response_before_reading_body() -> None:
    class Response:
        headers: dict[str, str] = {}

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            del args

        def geturl(self) -> str:
            return "https://attacker.test/steal"

        def read(self, size: int) -> bytes:
            del size
            raise AssertionError("cross-origin response body was read")

    client = _PostgrestClient(
        "https://project.supabase.co",
        "service-secret",
        opener=lambda *args, **kwargs: Response(),
    )
    with pytest.raises(RuntimeError, match="left its configured HTTPS origin"):
        client.request("GET", "fuel_news_source_state")


def test_atomic_rpc_is_one_call_and_failed_attempt_has_no_partial_state() -> None:
    class FakeRpcQuery:
        def __init__(self, client: "FakeClient", payload: dict[str, object]) -> None:
            self.client = client
            self.payload = payload

        def execute(self) -> SimpleNamespace:
            if self.client.fail_once:
                self.client.fail_once = False
                raise RuntimeError("synthetic transaction rollback")
            self.client.committed = dict(self.payload)
            return SimpleNamespace(
                data=[{"article_id": "article-1", "event_id": "event-1"}]
            )

    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, object]]] = []
            self.fail_once = True
            self.committed: dict[str, object] | None = None

        def rpc(self, name: str, payload: dict[str, object]) -> FakeRpcQuery:
            self.calls.append((name, payload))
            return FakeRpcQuery(self, payload)

    client = FakeClient()
    repository = SupabaseNewsRepository(client=client)
    parsed = parse_article(
        SOURCE,
        item(
            "Diesel rollback announced",
            "Diesel will decrease by P1.25 per liter effective Tuesday.",
        ),
        fetched_at=PUBLISHED,
    )

    with pytest.raises(RuntimeError, match="transaction rollback"):
        repository.write_article(parsed)

    assert client.committed is None
    assert len(client.calls) == 1
    assert client.calls[0][0] == "import_fuel_news_article"

    assert repository.write_article(parsed) == ("article-1", "event-1")

    assert len(client.calls) == 2
    payload = client.calls[1][1]
    assert set(payload) == {
        "article_payload",
        "event_payload",
        "adjustment_payloads",
    }
    assert payload["adjustment_payloads"] == [
        {
            "fuel_type": "DIESEL",
            "amount_centavos": -125,
            "confidence": "high",
        }
    ]
    event_payload = payload["event_payload"]
    assert isinstance(event_payload, dict)
    assert event_payload["summary"] is None
    assert client.committed == payload


def test_fetch_rejects_redirect_without_following_target() -> None:
    calls: list[str] = []

    def opener(request: urllib.request.Request, **kwargs: object) -> object:
        del kwargs
        calls.append(request.full_url)
        headers = Message()
        headers["Location"] = "http://127.0.0.1/latest/meta-data"
        raise urllib.error.HTTPError(
            request.full_url,
            302,
            "Found",
            headers,
            None,
        )

    with pytest.raises(FeedError, match="redirects are not allowed"):
        fetch_feed(SOURCE, opener=opener)

    assert calls == [SOURCE.feed_url]


def test_fetch_rejects_unsafe_response_url_before_reading_body() -> None:
    class Response:
        status = 200
        headers: dict[str, str] = {}

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *args: object) -> None:
            del args

        def getcode(self) -> int:
            return self.status

        def geturl(self) -> str:
            return "https://user@feeds.example.test/business.xml"

        def read(self, size: int) -> bytes:
            del size
            raise AssertionError("unsafe response body was read")

    with pytest.raises(FeedError, match="user information"):
        fetch_feed(SOURCE, opener=lambda *args, **kwargs: Response())


@pytest.mark.parametrize(
    "feed_url",
    [
        "http://feeds.example.test/business.xml",
        "https://user@feeds.example.test/business.xml",
        "https://@feeds.example.test/business.xml",
        "https://feeds.example.test:8443/business.xml",
        "https://attacker.test/business.xml",
    ],
)
def test_fetch_rejects_unsafe_configured_urls_before_opener(feed_url: str) -> None:
    unsafe = NewsSource(
        key=SOURCE.key,
        publisher=SOURCE.publisher,
        feed_url=feed_url,
        allowed_hosts=SOURCE.allowed_hosts,
    )
    calls = 0

    def opener(*args: object, **kwargs: object) -> object:
        nonlocal calls
        del args, kwargs
        calls += 1
        raise AssertionError("unsafe URL reached opener")

    with pytest.raises(FeedError):
        fetch_feed(unsafe, opener=opener)

    assert calls == 0


@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "224.0.0.1",
        "240.0.0.1",
        "0.0.0.0",
    ],
)
def test_production_fetch_rejects_non_public_resolved_ip_before_request(
    monkeypatch: pytest.MonkeyPatch,
    address: str,
) -> None:
    import src.fuel_news as fuel_news

    source = fuel_news.SOURCES[0]
    opened = False

    def resolver(*args: object, **kwargs: object) -> list[tuple[object, ...]]:
        del args, kwargs
        return [(2, 1, 6, "", (address, 443))]

    class SentinelOpener:
        def open(self, *args: object, **kwargs: object) -> object:
            nonlocal opened
            del args, kwargs
            opened = True
            raise AssertionError("unsafe IP reached network opener")

    monkeypatch.setattr(fuel_news.socket, "getaddrinfo", resolver)
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: SentinelOpener())

    with pytest.raises(FeedError, match="non-public address"):
        fetch_feed(source)

    assert not opened


def test_poll_nulls_implausible_publication_dates_without_aborting_source() -> None:
    feed = b"""<rss><channel>
      <item><title>Gasoline price hike announced</title>
        <link>https://news.example.test/future</link>
        <pubDate>Fri, 20 Nov 2026 03:30:00 +0000</pubDate>
        <description>Gasoline will increase by P1.00 per liter.</description></item>
      <item><title>Diesel price cut announced</title>
        <link>https://news.example.test/old</link>
        <pubDate>Mon, 16 Nov 2015 03:30:00 +0000</pubDate>
        <description>Diesel will decrease by P0.50 per liter.</description></item>
      <item><title>Kerosene rollback announced</title>
        <link>https://news.example.test/current</link>
        <pubDate>Mon, 16 Nov 2026 03:30:00 +0000</pubDate>
        <description>Kerosene will decrease by P0.25 per liter.</description></item>
    </channel></rss>"""

    parsed = parse_feed(feed, SOURCE, poll_time=PUBLISHED)

    assert len(parsed) == 3
    assert [entry.published_at for entry in parsed] == [None, None, PUBLISHED]


def test_partial_poll_keeps_prior_validators_then_retry_can_process_and_304() -> None:
    feed = b"""<rss><channel><item>
      <title>Gasoline price hike announced</title>
      <link>https://news.example.test/retry</link>
      <description>Gasoline will increase by P1.00 per liter.</description>
    </item></channel></rss>"""

    class Repository:
        def __init__(self) -> None:
            self.state = SourceState(etag='"old"', last_modified="old-date")
            self.fail_once = True
            self.polls: list[dict[str, object]] = []

        def get_source_state(self, source_key: str) -> SourceState:
            assert source_key == SOURCE.key
            return self.state

        def write_article(self, parsed: object) -> tuple[str, str]:
            del parsed
            if self.fail_once:
                self.fail_once = False
                raise RuntimeError("synthetic RPC failure")
            return "article-1", "event-1"

        def record_poll(self, source: NewsSource, **kwargs: object) -> None:
            assert source == SOURCE
            self.polls.append(dict(kwargs))
            self.state = SourceState(
                etag=kwargs.get("etag"),
                last_modified=kwargs.get("last_modified"),
            )

    repository = Repository()
    seen_validators: list[tuple[str | None, str | None]] = []

    def fetcher(source: NewsSource, state: SourceState | None) -> FetchResult:
        assert source == SOURCE and state is not None
        seen_validators.append((state.etag, state.last_modified))
        if len(seen_validators) < 3:
            return FetchResult(200, feed, '"new"', "new-date", source.feed_url)
        return FetchResult(304, None, '"new"', "new-date", source.feed_url)

    first = import_fuel_news(
        sources=(SOURCE,), repository=repository, fetcher=fetcher, now=PUBLISHED
    )
    second = import_fuel_news(
        sources=(SOURCE,), repository=repository, fetcher=fetcher, now=PUBLISHED
    )
    third = import_fuel_news(
        sources=(SOURCE,), repository=repository, fetcher=fetcher, now=PUBLISHED
    )

    assert [run.sources[0].status for run in (first, second, third)] == [
        "partial",
        "success",
        "not_modified",
    ]
    assert seen_validators == [
        ('"old"', "old-date"),
        ('"old"', "old-date"),
        ('"new"', "new-date"),
    ]
    assert repository.polls[0]["etag"] == '"old"'
    assert repository.polls[0]["last_modified"] == "old-date"


def test_source_failure_isolated_from_other_feed() -> None:
    good = NewsSource(
        key="good",
        publisher="Good",
        feed_url="https://feeds.good.test/rss",
        allowed_hosts=("good.test",),
    )
    bad = NewsSource(
        key="bad",
        publisher="Bad",
        feed_url="https://feeds.bad.test/rss",
        allowed_hosts=("bad.test",),
    )
    good_feed = b"""<rss><channel><item>
      <title>Gasoline price hike announced</title>
      <link>https://good.test/story</link>
      <description>Gasoline will increase by P1.00 per liter.</description>
    </item></channel></rss>"""

    def fetcher(source: NewsSource, state: SourceState | None) -> FetchResult:
        del state
        if source.key == "bad":
            raise RuntimeError("synthetic outage")
        return FetchResult(200, good_feed, '"etag"', None, source.feed_url)

    summary = import_fuel_news(
        sources=(bad, good),
        dry_run=True,
        fetcher=fetcher,
        now=PUBLISHED,
    )

    assert summary.failed_sources == 1
    assert summary.successful_sources == 1
    assert [result.status for result in summary.sources] == ["error", "dry_run"]
    assert summary.sources[1].candidates_seen == 1
