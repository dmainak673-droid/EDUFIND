from collections.abc import Iterable
from dataclasses import dataclass

from app.db.models.document import DocumentPage
from app.services.claim_extractor import ClaimDraft, extract_claims
from app.services.citation_parser import (
    CitationMentionDraft,
    ReferenceDraft,
    detect_citation_mentions,
    parse_bibliography,
    split_reference_section,
)


@dataclass(frozen=True)
class DocumentExtraction:
    claims: list[ClaimDraft]
    references: list[ReferenceDraft]
    mentions: list[CitationMentionDraft]


def extract_document_content(pages: Iterable[DocumentPage]) -> DocumentExtraction:
    claims: list[ClaimDraft] = []
    mentions: list[CitationMentionDraft] = []
    reference_lines: list[str] = []
    in_references = False

    for page in pages:
        body_text, page_reference_lines, in_references = split_reference_section(
            page.extracted_text, already_in_references=in_references
        )
        reference_lines.extend(page_reference_lines)
        if not body_text:
            continue
        claims.extend(extract_claims(body_text, page.page_number))
        mentions.extend(detect_citation_mentions(body_text, page.page_number))

    references = parse_bibliography(reference_lines)
    return DocumentExtraction(claims=claims, references=references, mentions=mentions)

