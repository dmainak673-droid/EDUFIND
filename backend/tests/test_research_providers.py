import httpx
import pytest

from app.services.research_providers import (
    CrossrefClient,
    OpenAlexClient,
    ProviderError,
    ResearchHttp,
    _reconstruct_abstract,
    normalize_doi,
)


def test_normalize_and_validate_doi():
    assert normalize_doi(" https://doi.org/10.1000/ABC.2. ") == "10.1000/abc.2"
    assert normalize_doi("doi:10.5555/Some-Doi") == "10.5555/some-doi"
    assert normalize_doi("https://example.org/not-a-doi") is None
    assert normalize_doi("10.1000/") is None
    assert normalize_doi("10.1000/invalid doi") is None


def test_crossref_doi_and_search_parse_missing_fields():
    def handler(request):
        if "/works/" in request.url.path:
            payload = {"message": {"DOI": "10.1234/Test", "title": ["Paper"], "author": [{"given": "Ada", "family": "Lovelace"}], "published-print": {"date-parts": [[2020, 1, 2]]}}}
        else:
            payload = {"message": {"items": [{"DOI": "10.1234/Test", "title": ["Paper"]}]}}
        return httpx.Response(200, json=payload)
    http = ResearchHttp(client=httpx.Client(transport=httpx.MockTransport(handler)))
    client = CrossrefClient(http, "https://api.crossref.test/v1", "test@example.org")
    by_doi = client.by_doi("10.1234/test")
    assert by_doi.doi == "10.1234/test"
    assert by_doi.publication_year == 2020
    assert by_doi.authors[0]["family"] == "Lovelace"
    assert client.search("Paper")[0].journal is None
    http.close()


def test_openalex_reconstructs_abstract_and_parses_authors():
    row = {"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1234/x", "title": "Title",
           "publication_year": 2024, "type": "article", "abstract_inverted_index": {"A": [0], "study": [1], "works.": [2]},
           "authorships": [{"author": {"display_name": "A. Author", "id": "https://openalex.org/A1"}, "institutions": [{"display_name": "Example University"}]}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"results": [row]}))
    http = ResearchHttp(client=httpx.Client(transport=transport))
    result = OpenAlexClient(http, "https://api.openalex.test").search("Title")[0]
    assert result.abstract == "A study works."
    assert result.doi == "10.1234/x"
    assert result.authors[0]["institutions"] == ["Example University"]
    assert _reconstruct_abstract({"lost": [2], "first": [0]}) == "first lost"
    assert _reconstruct_abstract("unsafe") is None
    http.close()


def test_rate_limit_retries_then_succeeds(monkeypatch):
    calls = 0
    delays = []
    monkeypatch.setattr("app.services.research_providers.time.sleep", delays.append)
    def handler(_request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, headers={"Retry-After": "1"}) if calls == 1 else httpx.Response(200, json={"ok": True})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert ResearchHttp(retries=1, client=client).get_json("Crossref", "https://test/api") == {"ok": True}
    assert calls == 2 and delays == [1.0]
    client.close()


def test_timeout_and_invalid_json_are_sanitized():
    timed = httpx.Client(transport=httpx.MockTransport(lambda _r: (_ for _ in ()).throw(httpx.ReadTimeout("secret"))))
    with pytest.raises(ProviderError, match="timed out"):
        ResearchHttp(retries=0, client=timed).get_json("Crossref", "https://test")
    timed.close()
    invalid = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, text="not-json")))
    with pytest.raises(ProviderError, match="invalid JSON"):
        ResearchHttp(retries=0, client=invalid).get_json("OpenAlex", "https://test")
    invalid.close()
