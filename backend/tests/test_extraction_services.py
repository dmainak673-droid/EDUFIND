from app.services.citation_parser import (
    detect_citation_mentions,
    parse_bibliography,
    split_reference_section,
)
from app.services.claim_extractor import extract_claims


def test_detects_numbered_citations_and_ranges():
    mentions = detect_citation_mentions("The result improved by 20% [1, 2-3].", page_number=4)

    assert [mention.citation_key for mention in mentions] == [
        "number:1",
        "number:2",
        "number:3",
    ]
    assert all(mention.page_number == 4 for mention in mentions)
    assert all(mention.mention_text == "[1, 2-3]" for mention in mentions)


def test_detects_parenthetical_and_narrative_author_year_citations():
    mentions = detect_citation_mentions(
        "Smith et al. (2020) found a 12% increase (Doe, 2021; Jones & Lee, 2022).",
        page_number=2,
    )

    assert [mention.citation_key for mention in mentions] == [
        "author-year:smith:2020",
        "author-year:doe:2021",
        "author-year:jones:2022",
    ]


def test_parses_numbered_and_author_year_bibliography_entries_and_doi():
    references = parse_bibliography(
        [
            "[1] Smith, J. (2020). Treatment response. Journal A, 4. doi:10.1234/alpha.1",
            "Doe, R. and Lee, K. (2021). Comparative outcome. Journal B, 7.",
        ]
    )

    assert len(references) == 2
    assert references[0].citation_key == "number:1"
    assert references[0].authors == ["Smith, J"]
    assert references[0].title == "Treatment response"
    assert references[0].publication_year == 2020
    assert references[0].doi == "10.1234/alpha.1"
    assert references[0].journal == "Journal A, 4"
    assert references[1].citation_key == "author-year:doe:2021"
    assert references[1].title == "Comparative outcome"


def test_preserves_malformed_bibliography_text_without_fabricating_fields():
    references = parse_bibliography(["[4] incomplete citation without a DOI or year"])

    assert len(references) == 1
    assert references[0].raw_reference == "[4] incomplete citation without a DOI or year"
    assert references[0].title is None
    assert references[0].publication_year is None
    assert references[0].doi is None


def test_splits_reference_section_and_preserves_body():
    body, reference_lines, in_references = split_reference_section(
        "A result was observed.\nReferences\n[1] Smith (2020). The paper."
    )

    assert body == "A result was observed."
    assert reference_lines == ["[1] Smith (2020). The paper."]
    assert in_references is True


def test_extracts_verifiable_claims_without_rewriting_original_text():
    source = "In the trial, treatment reduced symptoms by 35% [1].\nA generic introduction sentence."
    claims = extract_claims(source, page_number=3)

    assert len(claims) == 1
    assert claims[0].claim_text == "In the trial, treatment reduced symptoms by 35% [1]."
    assert claims[0].paragraph_context.startswith("In the trial, treatment")
    assert claims[0].page_number == 3
    assert claims[0].extraction_method == "RULE_BASED"
    assert 0 <= claims[0].confidence_score <= 1


def test_deduplicates_repeated_claims_on_the_same_page():
    claims = extract_claims(
        "The treatment reduced risk by 25%. The treatment reduced risk by 25%.",
        page_number=1,
    )
    assert len(claims) == 1

