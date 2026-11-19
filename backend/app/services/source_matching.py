from dataclasses import dataclass
from difflib import SequenceMatcher

from app.db.models.extraction import Citation
from app.services.research_providers import Publication, normalize_doi, normalize_title


@dataclass(frozen=True)
class MatchResult:
    score: float
    method: str
    status: str


def score_publication(citation: Citation, publication: Publication) -> MatchResult:
    cdoi, pdoi = normalize_doi(citation.doi), normalize_doi(publication.doi)
    if cdoi and pdoi and cdoi == pdoi:
        return MatchResult(1.0, "DOI", "MATCHED")
    ctitle = normalize_title(citation.publication_title)
    ptitle = normalize_title(publication.title)
    title_ratio = SequenceMatcher(None, ctitle, ptitle).ratio() if ctitle and ptitle else 0.0
    c_authors = {normalize_title(a) for a in (citation.authors or []) if isinstance(a, str)}
    p_authors = {normalize_title(str(a.get("family") or a.get("name") or "")) for a in publication.authors if isinstance(a, dict)}
    c_authors.discard(None); p_authors.discard(None)
    author_score = 1.0 if c_authors & p_authors else 0.0
    year_score = 1.0 if citation.publication_year and publication.publication_year == citation.publication_year else 0.0
    cjournal, pjournal = normalize_title(citation.journal), normalize_title(publication.journal)
    journal_score = SequenceMatcher(None, cjournal, pjournal).ratio() if cjournal and pjournal else 0.0
    score = 0.65 * title_ratio + 0.15 * author_score + 0.12 * year_score + 0.08 * journal_score
    methods = ["TITLE"] if title_ratio else []
    if author_score: methods.append("AUTHOR")
    if year_score: methods.append("YEAR")
    if journal_score >= 0.8: methods.append("JOURNAL")
    status = "MATCHED" if score >= 0.78 and title_ratio >= 0.88 else "POSSIBLE" if score >= 0.45 else "UNMATCHED"
    return MatchResult(round(score, 4), "+".join(methods) or "NO_METADATA_MATCH", status)
