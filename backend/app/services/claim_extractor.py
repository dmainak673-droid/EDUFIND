import hashlib
import re
import unicodedata
from dataclasses import dataclass


EMPIRICAL_PATTERN = re.compile(
    r"\b(?:found|observed|measured|demonstrated|showed|revealed|reported|"
    r"increased|increases|increasing|decreased|decreases|reduced|reduces|"
    r"improved|improves|correlated|associated|predicted|estimated|"
    r"significantly|significant|concluded|conclude|indicated|indicates)\b",
    re.IGNORECASE,
)
NUMERIC_EVIDENCE_PATTERN = re.compile(
    r"(?:\b\d+(?:\.\d+)?\s*(?:%|\bpercent\b|\bmg\b|\bmcg\b|\bμg\b|\bug\b|"
    r"\bkg\b|\bg\b|\bmL\b|\bml\b|\bL\b|\bmm\b|\bcm\b|"
    r"\byears?\b|\bmonths?\b|\bdays?\b|\bhours?\b|\bfold\b|"
    r"\bparticipants?\b|\bpatients?\b|\bsubjects?\b))|"
    r"(?:\b(?:p|n)\s*[<=>]\s*\d)|"
    r"(?:\b(?:confidence interval|odds ratio|hazard ratio|relative risk|"
    r"standard deviation|standard error|95\s*%\s*CI)\b)",
    re.IGNORECASE,
)
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])" )
PARAGRAPH_BOUNDARY = re.compile(r"\n[ \t]*\n+")


@dataclass(frozen=True)
class ClaimDraft:
    claim_text: str
    paragraph_context: str
    page_number: int
    start_char: int
    end_char: int
    extraction_method: str
    confidence_score: float
    fingerprint: str


def extract_claims(page_text: str, page_number: int) -> list[ClaimDraft]:
    claims: list[ClaimDraft] = []
    for paragraph, paragraph_start, paragraph_end in _paragraphs(page_text):
        context = paragraph.strip()
        for sentence_start, sentence_end in _sentences(paragraph):
            raw_sentence = paragraph[sentence_start:sentence_end]
            left_trim = len(raw_sentence) - len(raw_sentence.lstrip())
            right_trimmed = raw_sentence.rstrip()
            claim_text = right_trimmed.lstrip()
            if not _is_scientific_claim_candidate(claim_text):
                continue
            absolute_start = paragraph_start + sentence_start + left_trim
            absolute_end = paragraph_start + sentence_start + len(right_trimmed)
            claims.append(
                ClaimDraft(
                    claim_text=claim_text,
                    paragraph_context=context,
                    page_number=page_number,
                    start_char=absolute_start,
                    end_char=absolute_end,
                    extraction_method="RULE_BASED",
                    confidence_score=_heuristic_confidence(claim_text),
                    fingerprint=claim_fingerprint(claim_text),
                )
            )
    return _deduplicate_claims(claims)


def claim_fingerprint(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", " ".join(text.split())).casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _paragraphs(text: str):
    start = 0
    for match in PARAGRAPH_BOUNDARY.finditer(text):
        if text[start:match.start()].strip():
            yield text[start:match.start()], start, match.start()
        start = match.end()
    if text[start:].strip():
        yield text[start:], start, len(text)


def _sentences(paragraph: str):
    start = 0
    for match in SENTENCE_BOUNDARY.finditer(paragraph):
        prefix = paragraph[max(0, match.start() - 24) : match.start()].casefold().rstrip()
        if re.search(r"\b(?:et\s+al|e\.g|i\.e|etc|fig|eq|dr|prof|vs|no)\.$", prefix):
            continue
        if re.search(r"\b[a-z]\.$", prefix):
            continue
        if paragraph[start:match.start()].strip():
            yield start, match.start()
        start = match.end()
    if paragraph[start:].strip():
        yield start, len(paragraph)


def _is_scientific_claim_candidate(sentence: str) -> bool:
    if len(sentence.split()) < 5:
        return False
    return bool(EMPIRICAL_PATTERN.search(sentence) or NUMERIC_EVIDENCE_PATTERN.search(sentence))


def _heuristic_confidence(sentence: str) -> float:
    has_numeric_signal = NUMERIC_EVIDENCE_PATTERN.search(sentence) is not None
    has_empirical_signal = EMPIRICAL_PATTERN.search(sentence) is not None
    if has_numeric_signal and has_empirical_signal:
        return 0.82
    if has_numeric_signal:
        return 0.7
    return 0.62


def _deduplicate_claims(claims: list[ClaimDraft]) -> list[ClaimDraft]:
    seen: set[str] = set()
    unique: list[ClaimDraft] = []
    for claim in claims:
        key = claim.fingerprint
        if key in seen:
            continue
        seen.add(key)
        unique.append(claim)
    return unique

