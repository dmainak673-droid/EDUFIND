import hashlib
import re
import unicodedata
from dataclasses import dataclass


REFERENCE_HEADING = re.compile(r"^\s*(?:references|bibliography|works cited|literature cited)\s*:?\s*$", re.IGNORECASE)
NUMBERED_REFERENCE = re.compile(r"^\s*(?:\[(?P<bracket>\d+)\]|(?P<plain>\d+)[.)])\s*(?P<rest>.*)$")
AUTHOR_YEAR_REFERENCE = re.compile(
    r"^\s*(?P<authors>[^\n]{2,160}?)\s*\((?P<year>(?:19|20)\d{2}[a-z]?)\)[.,]?\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
DOI_PATTERN = re.compile(r"\b(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,9}/[-._;()/:A-Z0-9]+)", re.IGNORECASE)
YEAR_PATTERN = re.compile(r"\b((?:19|20)\d{2})([a-z]?)\b")
PARENTHETICAL_GROUP = re.compile(r"\((?P<body>[^()\n]{1,240})\)")
AUTHOR_YEAR_SEGMENT = re.compile(
    r"(?P<author>[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+"
    r"(?:\s+(?:et\s+al\.?|and\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+|"
    r"&\s*[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+))?)"
    r"\s*,?\s+(?P<year>(?:19|20)\d{2}[a-z]?)",
)
NARRATIVE_AUTHOR_YEAR = re.compile(
    r"(?P<author>[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+et\s+al\.?)?)"
    r"\s+\((?P<year>(?:19|20)\d{2}[a-z]?)\)"
)
NUMBERED_CITATION = re.compile(r"\[(?P<items>\s*\d+(?:\s*[,;]\s*\d+|\s*[-–]\s*\d+)*\s*)\]")


@dataclass(frozen=True)
class ReferenceDraft:
    citation_key: str | None
    aliases: list[str]
    raw_reference: str
    authors: list[str]
    title: str | None
    publication_year: int | None
    doi: str | None
    journal: str | None
    reference_hash: str


@dataclass(frozen=True)
class CitationMentionDraft:
    citation_key: str
    mention_text: str
    page_number: int
    start_char: int
    end_char: int


def split_reference_section(page_text: str, already_in_references: bool = False) -> tuple[str, list[str], bool]:
    if already_in_references:
        return "", page_text.splitlines(), True
    lines = page_text.splitlines(keepends=True)
    offset = 0
    for index, line in enumerate(lines):
        if REFERENCE_HEADING.fullmatch(line.strip()):
            body = page_text[:offset].rstrip()
            reference_text = "".join(lines[index + 1 :])
            return body, reference_text.splitlines(), True
        offset += len(line)
    return page_text, [], False


def parse_bibliography(lines: list[str]) -> list[ReferenceDraft]:
    grouped: list[tuple[str | None, list[str]]] = []
    current_key: str | None = None
    current_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current_lines:
                current_lines.append("")
            continue
        numbered = NUMBERED_REFERENCE.match(line)
        author_year = AUTHOR_YEAR_REFERENCE.match(line)
        starts_entry = bool(numbered or author_year)
        if starts_entry and current_lines:
            grouped.append((current_key, current_lines))
            current_lines = []
        if numbered:
            number = numbered.group("bracket") or numbered.group("plain")
            current_key = f"number:{number}"
            current_lines.append(line.strip())
        elif author_year:
            current_key = author_year_key(author_year.group("authors"), author_year.group("year"))
            current_lines.append(line.strip())
        elif not current_lines:
            current_key = None
            current_lines.append(line.rstrip())
        else:
            current_lines.append(line.strip())

    if current_lines:
        grouped.append((current_key, current_lines))

    results: list[ReferenceDraft] = []
    seen_hashes: set[str] = set()
    for canonical_key, entry_lines in grouped:
        raw_reference = "\n".join(entry_lines).strip()
        if not raw_reference:
            continue
        parsed = _parse_reference(raw_reference, canonical_key)
        if parsed.reference_hash not in seen_hashes:
            seen_hashes.add(parsed.reference_hash)
            results.append(parsed)
    return results


def detect_citation_mentions(text: str, page_number: int) -> list[CitationMentionDraft]:
    mentions: list[CitationMentionDraft] = []
    for match in NUMBERED_CITATION.finditer(text):
        keys = _expand_numbered_items(match.group("items"))
        for number in keys:
            mentions.append(
                CitationMentionDraft(
                    citation_key=f"number:{number}",
                    mention_text=match.group(0),
                    page_number=page_number,
                    start_char=match.start(),
                    end_char=match.end(),
                )
            )

    for group in PARENTHETICAL_GROUP.finditer(text):
        body = group.group("body")
        for match in AUTHOR_YEAR_SEGMENT.finditer(body):
            year = match.group("year")
            key = author_year_key(match.group("author"), year)
            if key:
                mentions.append(
                    CitationMentionDraft(
                        citation_key=key,
                        mention_text=match.group(0),
                        page_number=page_number,
                        start_char=group.start("body") + match.start(),
                        end_char=group.start("body") + match.end(),
                    )
                )

    for match in NARRATIVE_AUTHOR_YEAR.finditer(text):
        key = author_year_key(match.group("author"), match.group("year"))
        if key:
            mentions.append(
                CitationMentionDraft(
                    citation_key=key,
                    mention_text=match.group(0),
                    page_number=page_number,
                    start_char=match.start(),
                    end_char=match.end(),
                )
            )

    unique: dict[tuple[str, int, int], CitationMentionDraft] = {}
    for mention in mentions:
        unique[(mention.citation_key, mention.start_char, mention.end_char)] = mention
    return sorted(unique.values(), key=lambda item: (item.start_char, item.end_char, item.citation_key))


def author_year_key(author: str, year: str) -> str | None:
    surname = _first_surname(author)
    year_match = YEAR_PATTERN.search(year)
    if not surname or not year_match:
        return None
    normalized_surname = _normalize_key_part(surname)
    year_part = f"{year_match.group(1)}{year_match.group(2).lower()}"
    return f"author-year:{normalized_surname}:{year_part}"


def _parse_reference(raw_reference: str, canonical_key: str | None) -> ReferenceDraft:
    numbered = NUMBERED_REFERENCE.match(raw_reference)
    author_year = AUTHOR_YEAR_REFERENCE.match(raw_reference)
    authors: list[str] = []
    title: str | None = None
    journal: str | None = None
    publication_year: int | None = None
    aliases: list[str] = []
    rest = ""
    metadata_structure_found = False

    if numbered:
        number = numbered.group("bracket") or numbered.group("plain")
        canonical_key = f"number:{number}"
        aliases.extend([canonical_key, number])
        rest = numbered.group("rest")
        author_year_in_body = AUTHOR_YEAR_REFERENCE.match(rest)
        if author_year_in_body:
            metadata_structure_found = True
            authors = _parse_authors(author_year_in_body.group("authors"))
            year_text = author_year_in_body.group("year")
            publication_year = int(YEAR_PATTERN.search(year_text).group(1))
            author_alias = author_year_key(author_year_in_body.group("authors"), year_text)
            if author_alias:
                aliases.append(author_alias)
            rest = author_year_in_body.group("rest")
    elif author_year:
        metadata_structure_found = True
        author_text = author_year.group("authors").strip()
        authors = _parse_authors(author_text)
        year_text = author_year.group("year")
        publication_year = int(YEAR_PATTERN.search(year_text).group(1))
        canonical_key = author_year_key(author_text, year_text)
        if canonical_key:
            aliases.append(canonical_key)
        rest = author_year.group("rest")
    else:
        # Preserve malformed entries verbatim and extract only fields with clear syntax.
        rest = raw_reference

    doi_match = DOI_PATTERN.search(raw_reference)
    doi = doi_match.group(1).rstrip(".,;)").lower() if doi_match else None
    rest_without_doi = re.sub(r"\bdoi\s*:\s*$", "", DOI_PATTERN.sub("", rest), flags=re.IGNORECASE)
    rest_without_doi = rest_without_doi.strip(" .;,\t")
    if metadata_structure_found and rest_without_doi:
        title, journal = _title_and_journal(rest_without_doi)

    normalized = unicodedata.normalize("NFKC", " ".join(raw_reference.split())).casefold()
    hash_input = f"{canonical_key or ''}\0{normalized}"
    reference_hash = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    return ReferenceDraft(
        citation_key=canonical_key,
        aliases=list(dict.fromkeys(alias for alias in aliases if alias)),
        raw_reference=raw_reference,
        authors=authors,
        title=title,
        publication_year=publication_year,
        doi=doi,
        journal=journal,
        reference_hash=reference_hash,
    )


def _title_and_journal(text: str) -> tuple[str | None, str | None]:
    cleaned = text.strip(" .;,\t")
    if not cleaned:
        return None, None
    parts = re.split(r"\.\s+(?=[A-Z0-9])", cleaned, maxsplit=1)
    title = parts[0].strip(" .;,\t") or None
    journal = parts[1].strip(" .;,\t") if len(parts) > 1 else None
    return title, journal or None


def _parse_authors(author_text: str) -> list[str]:
    parts = re.split(r";\s*|\s+and\s+|\s*&\s*|(?<=\.),\s+(?=[A-Z])", author_text)
    return [part.strip(" ,.;") for part in parts if part.strip(" ,.;")]


def _first_surname(author: str) -> str:
    cleaned = re.sub(r"\bet\s+al\.?\b", "", author, flags=re.IGNORECASE).strip(" ,.;()")
    first_author = re.split(r"\s+(?:and|&)\s+|;", cleaned, maxsplit=1, flags=re.IGNORECASE)[0]
    if "," in first_author:
        return first_author.split(",", 1)[0].strip()
    words = first_author.split()
    return words[-1] if words else ""


def _normalize_key_part(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", normalized.casefold())


def _expand_numbered_items(items: str) -> list[str]:
    values: list[str] = []
    for item in re.split(r"[,;]", items):
        token = item.strip()
        range_match = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", token)
        if range_match:
            start, end = map(int, range_match.groups())
            if start <= end and end - start <= 50:
                values.extend(str(number) for number in range(start, end + 1))
            else:
                values.append(token)
        elif token.isdigit():
            values.append(token)
    return values

