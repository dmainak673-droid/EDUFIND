from collections import defaultdict

from app.services.citation_parser import ReferenceDraft


def index_reference_aliases(references: list[ReferenceDraft]) -> dict[str, list[int]]:
    """Map citation keys to reference indexes; ambiguity is preserved, never guessed away."""
    aliases: dict[str, list[int]] = defaultdict(list)
    for index, reference in enumerate(references):
        for alias in reference.aliases:
            aliases[alias].append(index)
    return dict(aliases)


def match_reference(citation_key: str, alias_index: dict[str, list[int]]) -> tuple[str, int | None]:
    matches = alias_index.get(citation_key, [])
    if len(matches) == 1:
        return "MATCHED", matches[0]
    if len(matches) > 1:
        return "AMBIGUOUS", None
    return "UNMATCHED", None

