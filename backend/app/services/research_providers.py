"""Small, defensive clients for the public Crossref and OpenAlex APIs."""
from __future__ import annotations

import re
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx


DOI_RE = re.compile(r"^10\.\d{4,9}/[-._;()/:A-Z0-9]+$", re.IGNORECASE)
_CROSSREF_LOCK = threading.Lock()
_CROSSREF_LAST_REQUEST = 0.0


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = value.strip()
    doi = re.sub(r"^(?:https?://)?(?:dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.IGNORECASE).strip().rstrip(".,;)")
    return doi.lower() if DOI_RE.fullmatch(doi) else None


def normalize_title(title: str | None) -> str | None:
    if not title:
        return None
    normalized = re.sub(r"[^a-z0-9]+", " ", title.casefold()).strip()
    return normalized or None


@dataclass(frozen=True)
class Publication:
    provider: str
    identifier: str
    doi: str | None = None
    title: str | None = None
    authors: list[dict[str, Any]] = field(default_factory=list)
    journal: str | None = None
    publication_date: str | None = None
    publication_year: int | None = None
    publication_type: str | None = None
    abstract: str | None = None
    url: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    def __init__(self, provider: str, kind: str, message: str):
        self.provider = provider
        self.kind = kind
        super().__init__(message)


class ResearchHttp:
    def __init__(self, *, timeout: float = 8, retries: int = 2, client: httpx.Client | None = None):
        self.timeout = timeout
        self.retries = retries
        # httpx logs full URLs at INFO; OpenAlex keys and Crossref mailto values are query parameters.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        self.client = client or httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": "EDUFIND/0.1 (academic metadata retrieval)"})
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def get_json(self, provider: str, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in range(self.retries + 1):
            try:
                response = self.client.get(url, params=params, timeout=self.timeout)
            except httpx.TimeoutException as exc:
                if attempt < self.retries:
                    time.sleep(0.2 * (2**attempt))
                    continue
                raise ProviderError(provider, "timeout", "Research provider request timed out") from exc
            except httpx.HTTPError as exc:
                if attempt < self.retries:
                    time.sleep(0.2 * (2**attempt))
                    continue
                raise ProviderError(provider, "network", "Research provider request failed") from exc
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < self.retries:
                    retry_after = response.headers.get("Retry-After", "")
                    try:
                        delay = min(3.0, max(0.0, float(retry_after)))
                    except ValueError:
                        delay = 0.2 * (2**attempt)
                    time.sleep(delay)
                    continue
                kind = "rate_limited" if response.status_code == 429 else "upstream"
                raise ProviderError(provider, kind, f"Research provider returned HTTP {response.status_code}")
            if response.status_code == 404:
                raise ProviderError(provider, "not_found", "Publication was not found")
            if response.status_code >= 400:
                raise ProviderError(provider, "http", f"Research provider returned HTTP {response.status_code}")
            try:
                payload = response.json()
            except ValueError as exc:
                raise ProviderError(provider, "invalid_response", "Research provider returned invalid JSON") from exc
            if not isinstance(payload, dict):
                raise ProviderError(provider, "invalid_response", "Research provider returned an unexpected response")
            return payload
        raise ProviderError(provider, "upstream", "Research provider request failed")


class CrossrefClient:
    def __init__(self, http: ResearchHttp, base_url: str, mailto: str = ""):
        self.http, self.base_url, self.mailto = http, base_url.rstrip("/"), mailto.strip()

    def _params(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        result = dict(params or {})
        if self.mailto:
            result["mailto"] = self.mailto
        return result

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        global _CROSSREF_LAST_REQUEST
        # Crossref's public pool allows one concurrent request and five requests per second.
        with _CROSSREF_LOCK:
            delay = 0.2 - (time.monotonic() - _CROSSREF_LAST_REQUEST)
            if delay > 0:
                time.sleep(delay)
            try:
                return self.http.get_json("Crossref", url, params)
            finally:
                _CROSSREF_LAST_REQUEST = time.monotonic()

    def by_doi(self, doi: str) -> Publication:
        encoded = quote(doi, safe="/")
        data = self._get(f"{self.base_url}/works/{encoded}", self._params()).get("message")
        if not isinstance(data, dict):
            raise ProviderError("Crossref", "invalid_response", "Crossref work record is missing")
        return _crossref_publication(data)

    def search(self, query: str, rows: int = 5) -> list[Publication]:
        payload = self._get(f"{self.base_url}/works", self._params({"query.bibliographic": query[:1000], "rows": min(5, max(1, rows))}))
        items = payload.get("message", {}).get("items", []) if isinstance(payload.get("message"), dict) else []
        return [_crossref_publication(item) for item in items if isinstance(item, dict)][:5]


class OpenAlexClient:
    def __init__(self, http: ResearchHttp, base_url: str, api_key: str = ""):
        self.http, self.base_url, self.api_key = http, base_url.rstrip("/"), api_key.strip()

    def _params(self, params: dict[str, Any]) -> dict[str, Any]:
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def by_doi(self, doi: str) -> list[Publication]:
        return self._search({"filter": f"doi:https://doi.org/{doi}", "per-page": 5})

    def search(self, query: str, rows: int = 5) -> list[Publication]:
        return self._search({"search": query[:1000], "per-page": min(5, max(1, rows))})

    def _search(self, params: dict[str, Any]) -> list[Publication]:
        payload = self.http.get_json("OpenAlex", f"{self.base_url}/works", self._params(params))
        results = payload.get("results", [])
        return [_openalex_publication(row) for row in results if isinstance(row, dict)][:5] if isinstance(results, list) else []


def _first_text(value: Any) -> str | None:
    if isinstance(value, list):
        return next((x.strip() for x in value if isinstance(x, str) and x.strip()), None)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _year(parts: Any) -> int | None:
    try:
        year = int(parts[0][0])
        return year if 1000 <= year <= 3000 else None
    except (TypeError, ValueError, IndexError):
        return None


def _crossref_publication(row: dict[str, Any]) -> Publication:
    authors = []
    for author in row.get("author", []) if isinstance(row.get("author"), list) else []:
        if isinstance(author, dict):
            authors.append({k: author[k] for k in ("given", "family", "name", "ORCID", "affiliation") if k in author})
    published_print = row.get("published-print") if isinstance(row.get("published-print"), dict) else {}
    published_online = row.get("published-online") if isinstance(row.get("published-online"), dict) else {}
    created = row.get("created") if isinstance(row.get("created"), dict) else {}
    date_parts = published_print.get("date-parts") or published_online.get("date-parts") or created.get("date-parts")
    doi = normalize_doi(row.get("DOI"))
    title = _first_text(row.get("title"))
    return Publication("Crossref", doi or str(row.get("URL") or ""), doi, title, authors,
        _first_text(row.get("container-title")), _first_text(published_print.get("date-time") or published_online.get("date-time")),
        _year(date_parts), _first_text(row.get("type")), _first_text(row.get("abstract")),
        f"https://doi.org/{doi}" if doi else row.get("URL"), row)


def _openalex_publication(row: dict[str, Any]) -> Publication:
    authors = []
    for authorship in row.get("authorships", []) if isinstance(row.get("authorships"), list) else []:
        if not isinstance(authorship, dict):
            continue
        author = authorship.get("author") if isinstance(authorship.get("author"), dict) else {}
        institutions = [i.get("display_name") for i in authorship.get("institutions", []) if isinstance(i, dict) and i.get("display_name")]
        authors.append({"name": author.get("display_name"), "id": author.get("id"), "institutions": institutions})
    source = row.get("primary_location", {}).get("source") if isinstance(row.get("primary_location"), dict) else None
    source = source if isinstance(source, dict) else {}
    doi = normalize_doi(row.get("doi"))
    abstract = _reconstruct_abstract(row.get("abstract_inverted_index"))
    year = row.get("publication_year")
    year = year if isinstance(year, int) and 1000 <= year <= 3000 else None
    return Publication("OpenAlex", str(row.get("id") or ""), doi, _first_text(row.get("title")), authors,
        _first_text(source.get("display_name")), str(row.get("publication_date")) if row.get("publication_date") else None,
        year, _first_text(row.get("type")), abstract, row.get("doi") or row.get("id"), row)


def _reconstruct_abstract(index: Any) -> str | None:
    if not isinstance(index, dict):
        return None
    positions: dict[int, str] = {}
    for word, offsets in index.items():
        if isinstance(word, str) and isinstance(offsets, list):
            for offset in offsets:
                if isinstance(offset, int) and 0 <= offset < 100000:
                    positions.setdefault(offset, word)
    return " ".join(positions[i] for i in sorted(positions)) or None
