from uuid import uuid4

import httpx
from sqlalchemy import func, select

from app.db.models.document import Document
from app.db.models.extraction import Citation, CitationMention, Claim, ClaimCitation
from app.db.models.research import EvidenceRecord, EvidenceRetrievalRun, ResearchSource, SourceIdentifier, SourceMatch
from app.services.evidence_retrieval import retrieve_document_evidence
from app.services.research_providers import ResearchHttp


def _create_retrieval_fixture(db):
    document_id, claim_id, citation_id, mention_id = [str(uuid4()) for _ in range(4)]
    doc = Document(id=document_id, original_filename="paper.pdf", stored_filename=f"{uuid4()}.pdf", title="Paper",
        authors=[], pdf_metadata={}, file_size=100, mime_type="application/pdf", page_count=1, extraction_status="EXTRACTED")
    claim = Claim(id=claim_id, document_id=document_id, page_number=3, claim_text="Study showed an effect.",
        paragraph_context="Study showed an effect (Smith, 2021).", extraction_method="RULE_BASED", confidence_score=.8, fingerprint="a" * 64)
    citation = Citation(id=citation_id, document_id=document_id, citation_key="Smith2021", aliases=["Smith2021"],
        raw_reference="Smith. 2021. A Research Study. Research Journal. doi:10.1234/test", authors=["Smith"],
        publication_title="A Research Study", publication_year=2021, doi="https://doi.org/10.1234/TEST", journal="Research Journal",
        reference_status="BIBLIOGRAPHY", reference_hash="b" * 64)
    mention = CitationMention(id=mention_id, citation_id=citation_id, page_number=3, char_start=0, char_end=14, mention_text="(Smith, 2021)")
    db.add_all([doc, claim, citation, mention])
    db.flush()
    db.add(ClaimCitation(claim_id=claim_id, citation_id=citation_id, mention_id=mention_id))
    db.commit()
    return document_id, claim_id, citation_id


def test_retrieves_merges_sources_persists_provenance_and_is_idempotent(api):
    with api.session_factory() as db:
        document_id, claim_id, citation_id = _create_retrieval_fixture(db)
        requests = []
        def handler(request):
            requests.append(request)
            if "crossref.test" in request.url.host:
                return httpx.Response(200, json={"message": {"DOI": "10.1234/test", "title": ["A Research Study"],
                    "author": [{"given": "Jane", "family": "Smith"}], "container-title": ["Research Journal"],
                    "published-print": {"date-parts": [[2021]]}, "type": "journal-article", "URL": "https://doi.org/10.1234/test"}})
            return httpx.Response(200, json={"results": [{"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1234/test",
                "title": "A Research Study", "publication_year": 2021, "publication_date": "2021-02-01", "type": "article",
                "abstract_inverted_index": {"The": [0], "study": [1], "supports": [2], "nothing": [3], "by": [4], "itself.": [5]},
                "authorships": [{"author": {"display_name": "Jane Smith"}, "institutions": [{"display_name": "Example University"}]}],
                "primary_location": {"source": {"display_name": "Research Journal"}}}]})
        http = ResearchHttp(client=httpx.Client(transport=httpx.MockTransport(handler)))
        settings = api.settings.model_copy(update={"crossref_api_url": "https://crossref.test/v1", "openalex_api_url": "https://openalex.test"})
        run = retrieve_document_evidence(db, document_id, settings, http=http)
        assert run.status == "COMPLETED"
        assert run.sources_matched == 1
        assert db.scalar(select(func.count()).select_from(ResearchSource)) == 1
        assert db.scalar(select(func.count()).select_from(SourceIdentifier)) == 3
        match = db.scalar(select(SourceMatch).where(SourceMatch.citation_id == citation_id))
        assert match.status == "MATCHED" and match.score == 1.0 and match.matching_method == "DOI"
        record = db.scalar(select(EvidenceRecord).where(EvidenceRecord.claim_id == claim_id))
        assert record.availability == "ABSTRACT"
        assert record.retrieved_text == "The study supports nothing by itself."
        assert db.get(CitationMention, record.mention_id).page_number == 3
        request_count = len(requests)
        assert retrieve_document_evidence(db, document_id, settings, http=http).id == run.id
        assert len(requests) == request_count
        http.close()

    status = api.client.get(f"/api/documents/{document_id}/evidence-status")
    assert status.status_code == 200 and status.json()["status"] == "COMPLETED"
    evidence = api.client.get(f"/api/claims/{claim_id}/evidence")
    assert evidence.status_code == 200
    assert evidence.json()["evidence"][0]["pageNumber"] == 3
    assert evidence.json()["evidence"][0]["availability"] == "ABSTRACT"
    document_evidence = api.client.get(f"/api/documents/{document_id}/evidence")
    assert document_evidence.status_code == 200 and document_evidence.json()["total"] == 1
    matches_response = api.client.get(f"/api/citations/{citation_id}/matches")
    assert matches_response.status_code == 200 and matches_response.json()[0]["status"] == "MATCHED"
    source_response = api.client.get(f"/api/sources/{matches_response.json()[0]['sourceId']}")
    assert source_response.status_code == 200
    assert source_response.json()["metadataStatus"] == "ABSTRACT"
    assert {item["provider"] for item in source_response.json()["identifiers"]} == {"DOI", "Crossref", "OpenAlex"}
    citations = api.client.get(f"/api/citations/{document_id}").json()["citations"]
    assert citations[0]["resolved"] is True
    assert citations[0]["evidenceAvailability"] == "ABSTRACT"

    assert api.client.delete(f"/api/documents/{document_id}").status_code == 204
    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(EvidenceRecord)) == 0
        assert db.scalar(select(func.count()).select_from(SourceMatch)) == 0
        assert db.scalar(select(func.count()).select_from(EvidenceRetrievalRun)) == 0
        assert db.scalar(select(func.count()).select_from(ResearchSource)) == 1


def test_no_results_are_explicit_and_unavailable_evidence_is_persisted(api):
    with api.session_factory() as db:
        document_id, claim_id, citation_id = _create_retrieval_fixture(db)
        http = ResearchHttp(client=httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"message": {"items": []}} if "crossref" in _r.url.host else {"results": []}))))
        settings = api.settings.model_copy(update={"crossref_api_url": "https://crossref.test/v1", "openalex_api_url": "https://openalex.test"})
        run = retrieve_document_evidence(db, document_id, settings, http=http)
        http.close()
        assert run.status == "COMPLETED"
        match = db.scalar(select(SourceMatch).where(SourceMatch.citation_id == citation_id))
        assert match.status == "UNMATCHED" and match.source_id is None
        record = db.scalar(select(EvidenceRecord).where(EvidenceRecord.claim_id == claim_id))
        assert record.availability == "UNAVAILABLE" and record.retrieved_text is None


def test_matching_uses_title_author_year_and_doi(api):
    from app.services.source_matching import score_publication
    from app.services.research_providers import Publication
    with api.session_factory() as db:
        _, _, citation_id = _create_retrieval_fixture(db)
        citation = db.get(Citation, citation_id)
        by_title = Publication("OpenAlex", "W-test", title="A Research Study", authors=[{"name": "Jane Smith"}],
                               publication_year=2021, journal="Research Journal")
        result = score_publication(citation, by_title)
        assert result.status == "MATCHED" and "TITLE" in result.method and "YEAR" in result.method
        wrong = Publication("OpenAlex", "W-wrong", doi="10.9999/nope", title="Unrelated Work")
        assert score_publication(citation, wrong).status == "UNMATCHED"


def test_retrieve_endpoint_contract_and_duplicate_request_prevention(api, monkeypatch):
    from app.api.routes import evidence as routes
    from datetime import UTC, datetime
    with api.session_factory() as db:
        document_id, _, _ = _create_retrieval_fixture(db)
    calls = []
    def completed_run(db, document_id, settings, **kwargs):
        calls.append(document_id)
        run = EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="COMPLETED",
            citations_processed=1, sources_matched=1, started_at=datetime.now(UTC), completed_at=datetime.now(UTC))
        db.add(run)
        db.commit()
        db.refresh(run)
        return run
    monkeypatch.setattr(routes, "retrieve_document_evidence", completed_run)
    first = api.client.post(f"/api/documents/{document_id}/retrieve-evidence")
    second = api.client.post(f"/api/documents/{document_id}/retrieve-evidence")
    assert first.status_code == second.status_code == 200
    assert first.json()["status"] == "COMPLETED"
    assert first.json()["sourcesMatched"] == 1
    assert calls == [document_id]
