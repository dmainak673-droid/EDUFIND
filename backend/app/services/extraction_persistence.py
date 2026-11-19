import hashlib
import unicodedata
from collections import defaultdict
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models.extraction import Citation, CitationMention, Claim, ClaimCitation
from app.services.claim_extractor import ClaimDraft
from app.services.citation_matcher import index_reference_aliases, match_reference
from app.services.extraction_service import DocumentExtraction


def persist_extraction(db: Session, document_id: str, extraction: DocumentExtraction) -> tuple[int, int]:
    # A retry after a failed run replaces all prior Phase 3 output in one transaction.
    document_claim_ids = select_claim_ids(db, document_id)
    if document_claim_ids:
        db.execute(delete(ClaimCitation).where(ClaimCitation.claim_id.in_(document_claim_ids)))
    db.execute(delete(Claim).where(Claim.document_id == document_id))
    db.execute(delete(Citation).where(Citation.document_id == document_id))
    db.flush()

    citation_records: list[Citation] = []
    for reference in extraction.references:
        citation_records.append(
            Citation(
                id=str(uuid4()),
                document_id=document_id,
                citation_key=reference.citation_key,
                aliases=reference.aliases,
                raw_reference=reference.raw_reference,
                authors=reference.authors,
                publication_title=reference.title,
                publication_year=reference.publication_year,
                doi=reference.doi,
                journal=reference.journal,
                reference_status="BIBLIOGRAPHY",
                reference_hash=reference.reference_hash,
            )
        )
    db.add_all(citation_records)
    db.flush()

    alias_index = index_reference_aliases(extraction.references)
    claims: list[Claim] = []
    drafts_by_claim_id: dict[str, ClaimDraft] = {}
    for draft in extraction.claims:
        claim = Claim(
            id=str(uuid4()),
            document_id=document_id,
            page_number=draft.page_number,
            claim_text=draft.claim_text,
            paragraph_context=draft.paragraph_context,
            extraction_method=draft.extraction_method,
            confidence_score=draft.confidence_score,
            fingerprint=draft.fingerprint,
        )
        claims.append(claim)
        drafts_by_claim_id[claim.id] = draft
    db.add_all(claims)

    citations_by_reference_index = {index: citation for index, citation in enumerate(citation_records)}
    unmatched_by_key: dict[str, Citation] = {}
    ambiguous_by_key: dict[str, Citation] = {}
    mentions_by_page: dict[int, list[tuple[object, CitationMention]]] = defaultdict(list)
    for mention in extraction.mentions:
        match_kind, reference_index = match_reference(mention.citation_key, alias_index)
        if match_kind == "MATCHED" and reference_index is not None:
            citation = citations_by_reference_index[reference_index]
        elif match_kind == "AMBIGUOUS":
            citation = ambiguous_by_key.get(mention.citation_key)
            if citation is None:
                citation = _make_unresolved_citation(document_id, mention.citation_key, mention.mention_text, "AMBIGUOUS")
                db.add(citation)
                ambiguous_by_key[mention.citation_key] = citation
        else:
            citation = unmatched_by_key.get(mention.citation_key)
            if citation is None:
                citation = _make_unresolved_citation(document_id, mention.citation_key, mention.mention_text, "UNMATCHED")
                db.add(citation)
                unmatched_by_key[mention.citation_key] = citation

        citation_mention = CitationMention(
            id=str(uuid4()),
            citation=citation,
            page_number=mention.page_number,
            char_start=mention.start_char,
            char_end=mention.end_char,
            mention_text=mention.mention_text[:500],
        )
        db.add(citation_mention)
        mentions_by_page[mention.page_number].append((mention, citation_mention))

    db.flush()
    for claim in claims:
        draft = drafts_by_claim_id[claim.id]
        for mention, citation_mention in mentions_by_page.get(draft.page_number, []):
            if draft.start_char <= mention.start_char and mention.end_char <= draft.end_char:
                db.add(
                    ClaimCitation(
                        claim_id=claim.id,
                        citation_id=citation_mention.citation_id,
                        mention_id=citation_mention.id,
                    )
                )
    db.flush()
    citation_count = sum(1 for citation in citation_records) + len(unmatched_by_key) + len(ambiguous_by_key)
    return len(claims), citation_count


def select_claim_ids(db: Session, document_id: str) -> list[str]:
    return list(db.scalars(select(Claim.id).where(Claim.document_id == document_id)).all())


def _make_unresolved_citation(document_id: str, key: str, raw_text: str, status: str) -> Citation:
    normalized = unicodedata.normalize("NFKC", " ".join(raw_text.split())).casefold()
    reference_hash = hashlib.sha256(f"{key}\0{normalized}".encode("utf-8")).hexdigest()
    return Citation(
        id=str(uuid4()),
        document_id=document_id,
        citation_key=key,
        aliases=[key],
        raw_reference=raw_text,
        authors=[],
        publication_title=None,
        publication_year=None,
        doi=None,
        journal=None,
        reference_status=status,
        reference_hash=reference_hash,
    )

