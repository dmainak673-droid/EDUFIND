from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.extraction import Citation, Claim, ClaimCitation
from app.db.models.research import EvidenceRecord, EvidenceRetrievalRun, ResearchSource, SourceIdentifier, SourceMatch
from app.services.research_providers import CrossrefClient, OpenAlexClient, Publication, ProviderError, ResearchHttp, normalize_doi, normalize_title
from app.services.source_matching import score_publication

logger = logging.getLogger(__name__)


def retrieve_document_evidence(db: Session, document_id: str, settings: Settings, http: ResearchHttp | None = None) -> EvidenceRetrievalRun:
    owned_http = http or ResearchHttp(timeout=settings.research_http_timeout_seconds, retries=settings.research_retry_attempts)
    crossref = CrossrefClient(owned_http, settings.crossref_api_url, settings.crossref_mailto)
    openalex = OpenAlexClient(owned_http, settings.openalex_api_url, settings.openalex_api_key)
    run = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
    if run and run.status == "COMPLETED":
        if http is None: owned_http.close()
        return run
    now = datetime.now(UTC)
    if run is None:
        run = EvidenceRetrievalRun(id=str(uuid4()), document_id=document_id, status="RUNNING", started_at=now)
        db.add(run)
    else:
        run.status, run.started_at, run.completed_at, run.error_message = "RUNNING", now, None, None
    run.citations_processed = run.sources_matched = 0
    try:
        db.flush()
        db.commit()  # Claim the unique document run before any network requests.
    except IntegrityError:
        db.rollback()
        competing_run = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
        if competing_run is not None and competing_run.status in {"RUNNING", "COMPLETED"}:
            if http is None: owned_http.close()
            return competing_run
        raise
    db.refresh(run)
    citations = db.scalars(select(Citation).where(Citation.document_id == document_id).order_by(Citation.id)).all()
    # Reprocessing replaces this document's evidence and matching results in the same transaction.
    citation_ids = [c.id for c in citations]
    if citation_ids:
        db.execute(delete(EvidenceRecord).where(EvidenceRecord.citation_id.in_(citation_ids)))
        db.execute(delete(SourceMatch).where(SourceMatch.citation_id.in_(citation_ids)))
    failed_provider_calls = 0
    try:
        for citation in citations:
            candidates: list[Publication] = []
            doi = normalize_doi(citation.doi)
            if doi:
                for operation in (lambda: crossref.by_doi(doi), lambda: openalex.by_doi(doi)):
                    try:
                        value = operation()
                        candidates.extend(value if isinstance(value, list) else [value])
                    except ProviderError as exc:
                        if exc.kind not in {"not_found"}: failed_provider_calls += 1
                        logger.info("Provider lookup unavailable provider=%s kind=%s", exc.provider, exc.kind)
            else:
                query = citation.publication_title or citation.raw_reference
                for operation in (lambda: crossref.search(query), lambda: openalex.search(query)):
                    try: candidates.extend(operation())
                    except ProviderError as exc:
                        failed_provider_calls += 1
                        logger.info("Provider search unavailable provider=%s kind=%s", exc.provider, exc.kind)
            unique: dict[str, Publication] = {}
            for publication in candidates:
                if publication.identifier:
                    key = normalize_doi(publication.doi) or f"{publication.provider}:{publication.identifier}"
                    # Prefer records containing an abstract, then retain other provider IDs separately below.
                    current = unique.get(key)
                    if current is None or (not current.abstract and publication.abstract): unique[key] = publication
            best = None
            source_matches: dict[str, tuple[ResearchSource, Publication, object]] = {}
            citation_claims = db.execute(
                select(ClaimCitation.claim_id, ClaimCitation.mention_id)
                .where(ClaimCitation.citation_id == citation.id)
            ).all()
            for publication in candidates:
                if not publication.identifier: continue
                source = _upsert_source(db, publication)
                matched = score_publication(citation, publication)
                prior = source_matches.get(source.id)
                if prior is None or matched.score > prior[2].score:
                    source_matches[source.id] = (source, publication, matched)
            for source, publication, matched in source_matches.values():
                db.add(SourceMatch(id=str(uuid4()), citation_id=citation.id, source_id=source.id, score=matched.score,
                                   matching_method=matched.method, status=matched.status))
                if matched.status == "MATCHED" and (best is None or matched.score > best[0]): best = (matched.score, source, publication)
            if not source_matches:
                db.add(SourceMatch(id=str(uuid4()), citation_id=citation.id, source_id=None, score=0.0,
                                   matching_method="NO_RESULTS", status="UNMATCHED"))
            if best:
                _, source, publication = best
                run.sources_matched += 1
                availability = "ABSTRACT" if source.abstract else "METADATA_ONLY"
                mentions_by_claim = {claim_id: mention_id for claim_id, mention_id in citation_claims}
                for claim_id, mention_id in mentions_by_claim.items():
                    db.add(EvidenceRecord(id=str(uuid4()), claim_id=claim_id, citation_id=citation.id, source_id=source.id,
                        mention_id=mention_id, availability=availability, retrieved_text=source.abstract,
                        source_url=publication.url))
            elif citation_claims:
                for claim_id, mention_id in citation_claims:
                    db.add(EvidenceRecord(id=str(uuid4()), claim_id=claim_id, citation_id=citation.id, source_id=None,
                        mention_id=mention_id, availability="UNAVAILABLE", retrieved_text=None, source_url=None))
            run.citations_processed += 1
            db.flush()
        run.status = "PARTIAL" if failed_provider_calls else "COMPLETED"
        run.error_message = "Some provider requests were unavailable; retry to refresh." if failed_provider_calls else None
        run.completed_at = datetime.now(UTC)
        db.commit()
        db.refresh(run)
        return run
    except Exception:
        db.rollback()
        logger.exception("Evidence retrieval failed document_id=%s", document_id)
        failed_run = db.scalar(select(EvidenceRetrievalRun).where(EvidenceRetrievalRun.document_id == document_id))
        if failed_run is not None:
            failed_run.status = "FAILED"
            failed_run.error_message = "Evidence retrieval failed. The request may be retried."
            failed_run.completed_at = datetime.now(UTC)
            db.commit()
        raise
    finally:
        if http is None: owned_http.close()


def _upsert_source(db: Session, publication: Publication) -> ResearchSource:
    doi = normalize_doi(publication.doi)
    source = db.scalar(select(ResearchSource).where(ResearchSource.doi == doi)) if doi else None
    if source is None:
        source = db.scalar(select(ResearchSource).join(SourceIdentifier).where(
            SourceIdentifier.provider == publication.provider,
            SourceIdentifier.identifier == publication.identifier,
        ))
    if source is None and doi is None and publication.publication_year and publication.title:
        source = db.scalar(select(ResearchSource).where(
            ResearchSource.normalized_title == normalize_title(publication.title),
            ResearchSource.publication_year == publication.publication_year,
        ))
    if source is None:
        source = ResearchSource(id=str(uuid4()), doi=doi, metadata_status="METADATA")
        db.add(source)
        db.flush()
    source.doi = source.doi or doi
    source.title = source.title or publication.title
    source.normalized_title = source.normalized_title or normalize_title(publication.title)
    source.authors = source.authors or publication.authors
    source.journal = source.journal or publication.journal
    source.publication_date = source.publication_date or publication.publication_date
    source.publication_year = source.publication_year or publication.publication_year
    source.publication_type = source.publication_type or publication.publication_type
    source.abstract = source.abstract or publication.abstract
    source.metadata_status = "ABSTRACT" if source.abstract else "METADATA"
    source.provider_payload = {**(source.provider_payload or {}), publication.provider.lower(): publication.raw}
    exists = db.scalar(select(SourceIdentifier.id).where(SourceIdentifier.provider == publication.provider,
                                                         SourceIdentifier.identifier == publication.identifier))
    if not exists:
        db.add(SourceIdentifier(source_id=source.id, provider=publication.provider, identifier=publication.identifier))
    if doi:
        doi_exists = db.scalar(select(SourceIdentifier.id).where(SourceIdentifier.provider == "DOI", SourceIdentifier.identifier == doi))
        if not doi_exists:
            db.add(SourceIdentifier(source_id=source.id, provider="DOI", identifier=doi))
    db.flush()
    return source
