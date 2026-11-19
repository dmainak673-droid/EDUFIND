from __future__ import annotations

import logging
import re
from threading import Lock
import unicodedata
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.analysis import AnalysisRun
from app.db.models.document import Document
from app.db.models.report import Report

logger = logging.getLogger(__name__)
_FONT_LOCK = Lock()
_PDF_NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$")


def report_directory(settings: Settings) -> Path:
    return Path(settings.upload_dir).expanduser() / "reports"


def report_path(settings: Settings, filename: str) -> Path | None:
    if not _PDF_NAME.fullmatch(filename):
        return None
    return report_directory(settings) / filename


def generate_report(db: Session, analysis: AnalysisRun, document: Document,
                    settings: Settings) -> Report:
    """Create a PDF from immutable analysis snapshots, then persist its metadata.

    A filesystem write and SQL commit cannot be one atomic transaction. If the
    database write fails, this function removes the completed PDF before
    propagating the error so ordinary failures do not leave orphaned files.
    """
    directory = report_directory(settings)
    directory.mkdir(parents=True, exist_ok=True)
    report_id = str(uuid4())
    filename = f"{uuid4()}.pdf"
    path = directory / filename
    payload = _render_pdf(analysis, document, datetime.now(UTC))

    try:
        with path.open("xb") as output:
            output.write(payload)
            output.flush()
        row = Report(id=report_id, analysis_id=analysis.id, filename=filename,
                     file_size=len(payload), created_at=datetime.now(UTC))
        db.add(row)
        db.commit()
        return row
    except Exception:
        db.rollback()
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove an unregistered report file")
        raise


def _render_pdf(analysis: AnalysisRun, document: Document, generated_at: datetime) -> bytes:
    styles = _styles()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter, title="EDUFIND Scientific Verification Report",
        author="EDUFIND", leftMargin=0.72 * inch, rightMargin=0.72 * inch,
        topMargin=0.72 * inch, bottomMargin=0.68 * inch,
    )
    story = [
        Spacer(1, 0.65 * inch),
        Paragraph("EDUFIND", styles["brand"]),
        Paragraph("Scientific Verification Report", styles["cover_title"]),
        Spacer(1, 0.22 * inch),
        HRFlowable(width="72%", thickness=2, color=colors.HexColor("#247A78"), hAlign="CENTER"),
        Spacer(1, 0.36 * inch),
        Paragraph(_text(document.title, "Untitled document"), styles["document_title"]),
        Spacer(1, 0.12 * inch),
        _label_value("Original filename", document.original_filename, styles),
        _label_value("Analysis ID", analysis.id, styles),
        _label_value("Report generated", generated_at.strftime("%Y-%m-%d %H:%M UTC"), styles),
        PageBreak(),
        Paragraph("Executive summary", styles["section"]),
        _summary_table(analysis, styles),
        Spacer(1, 0.15 * inch),
        Paragraph("Verdict distribution", styles["subsection"]),
        _distribution_table(analysis.verdict_counts or {}, styles),
        Spacer(1, 0.22 * inch),
        Paragraph("Claim-wise verification", styles["section"]),
    ]

    results = analysis.verdict_details if isinstance(analysis.verdict_details, list) else []
    if not results:
        story.append(Paragraph("No claim-wise verification results were recorded for this analysis.", styles["body"]))
    for index, result in enumerate(results, start=1):
        if not isinstance(result, dict):
            continue
        story.append(KeepTogether([
            Paragraph(f"Claim {index}: {_text(result.get('verdict'), 'Unspecified')}", styles["claim_heading"]),
            _field("Original claim", result.get("original_claim"), styles),
            _field("Page", result.get("claim_page_number"), styles),
            _field("Context", result.get("claim_context"), styles),
            _field("Verdict", result.get("verdict"), styles),
            _field("Confidence", _confidence(result.get("confidence_score")), styles),
            _field("Evidence availability", result.get("evidence_availability"), styles),
            _field("Explanation", result.get("explanation"), styles),
            _field("Limitations", _joined(result.get("limitations")), styles),
            _field("Assessment timestamp", result.get("verified_at"), styles),
        ]))
        evidence_items = result.get("evidence")
        if isinstance(evidence_items, list) and evidence_items:
            for evidence_index, evidence in enumerate(evidence_items, start=1):
                if not isinstance(evidence, dict):
                    continue
                story.extend(_evidence_section(evidence, evidence_index, styles))
        else:
            story.append(Paragraph("No evidence records were included in this assessment snapshot.", styles["body"]))
        story.append(Spacer(1, 0.14 * inch))
        story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#D8E0E5")))

    story.extend([
        PageBreak(),
        Paragraph("Methodology and limitations", styles["section"]),
        Paragraph(
            "EDUFIND combines extracted scientific claims with available citation and research evidence, "
            "then records an evidence-assisted automated assessment. Results depend on the quality, "
            "coverage, and accessibility of the supplied document and retrieved sources.", styles["body"]),
        Paragraph(
            "Automated AI verification is evidence-assisted and should not be treated as definitive "
            "scientific proof. A verdict is not a substitute for review of the full source material, "
            "study design, methods, and relevant scientific literature.", styles["body"]),
        _field("Analysis status", analysis.status, styles),
        _field("Assessment models", _unique_values(results, "model_identifier"), styles),
        _field("Prompt versions", _unique_values(results, "prompt_version"), styles),
    ])
    doc.build(story, onFirstPage=_draw_page, onLaterPages=_draw_page)
    return buffer.getvalue()


def _styles() -> dict[str, ParagraphStyle]:
    _register_fonts()
    base = getSampleStyleSheet()
    font = "EduFindVera" if "EduFindVera" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
    bold = "EduFindVera-Bold" if "EduFindVera-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
    return {
        "brand": ParagraphStyle("Brand", parent=base["Title"], fontName=bold,
            fontSize=19, leading=24, textColor=colors.HexColor("#176A68"), alignment=TA_CENTER),
        "cover_title": ParagraphStyle("CoverTitle", parent=base["Title"], fontName=bold,
            fontSize=24, leading=31, textColor=colors.HexColor("#18324A"), alignment=TA_CENTER),
        "document_title": ParagraphStyle("DocumentTitle", parent=base["Heading2"], fontName=bold,
            fontSize=17, leading=23, alignment=TA_CENTER, textColor=colors.HexColor("#253B50"),
            spaceAfter=18),
        "section": ParagraphStyle("Section", parent=base["Heading1"], fontName=bold,
            fontSize=17, leading=22, textColor=colors.HexColor("#18324A"), spaceBefore=8, spaceAfter=12),
        "subsection": ParagraphStyle("Subsection", parent=base["Heading2"], fontName=bold,
            fontSize=12, leading=16, textColor=colors.HexColor("#176A68"), spaceBefore=8, spaceAfter=6),
        "claim_heading": ParagraphStyle("ClaimHeading", parent=base["Heading2"], fontName=bold,
            fontSize=13, leading=18, textColor=colors.HexColor("#176A68"), spaceBefore=10, spaceAfter=6),
        "body": ParagraphStyle("ReportBody", parent=base["BodyText"], fontName=font,
            fontSize=9.3, leading=13.4, textColor=colors.HexColor("#25313B"), spaceAfter=6,
            splitLongWords=1),
        "small": ParagraphStyle("ReportSmall", parent=base["BodyText"], fontName=font,
            fontSize=8.2, leading=11, textColor=colors.HexColor("#465563"), spaceAfter=4,
            splitLongWords=1),
        "table_header": ParagraphStyle("TableHeader", parent=base["BodyText"], fontName=bold,
            fontSize=9, leading=12, textColor=colors.white),
    }


def _register_fonts() -> None:
    with _FONT_LOCK:
        if "EduFindVera" in pdfmetrics.getRegisteredFontNames():
            return
        try:
            import reportlab

            font_dir = Path(reportlab.__file__).parent / "fonts"
            regular, bold = font_dir / "Vera.ttf", font_dir / "VeraBd.ttf"
            if regular.exists() and bold.exists():
                pdfmetrics.registerFont(TTFont("EduFindVera", str(regular)))
                pdfmetrics.registerFont(TTFont("EduFindVera-Bold", str(bold)))
        except (OSError, ImportError):
            # Built-in Helvetica remains a safe fallback if bundled TTF files are unavailable.
            return


def _summary_table(analysis: AnalysisRun, styles: dict[str, ParagraphStyle]) -> Table:
    rows = [
        [_p("Overall analysis status", styles["small"]), _p(analysis.status, styles["body"])],
        [_p("Total claims", styles["small"]), _p(analysis.claims_detected, styles["body"])],
        [_p("Total citations", styles["small"]), _p(analysis.citations_identified, styles["body"])],
        [_p("Total evidence records", styles["small"]), _p(analysis.evidence_records, styles["body"])],
        [_p("Total verification results", styles["small"]), _p(analysis.verification_results, styles["body"])],
    ]
    table = Table(rows, colWidths=[2.4 * inch, 4.3 * inch], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EEF4F5")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D8E0E5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _distribution_table(counts: dict[str, int], styles: dict[str, ParagraphStyle]) -> Table:
    rows = [[_p("Verdict", styles["table_header"]), _p("Count", styles["table_header"])]]
    rows.extend([[_p(key, styles["small"]), _p(value, styles["small"])]
                 for key, value in sorted(counts.items())])
    if len(rows) == 1:
        rows.append([_p("No verification results", styles["small"]), _p(0, styles["small"])])
    table = Table(rows, colWidths=[4.9 * inch, 1.8 * inch], hAlign="LEFT", repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#176A68")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F8F9")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D8E0E5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _evidence_section(evidence: dict[str, object], index: int,
                      styles: dict[str, ParagraphStyle]) -> list[object]:
    title = evidence.get("citation_title") or evidence.get("source_title") or evidence.get("raw_reference")
    authors = evidence.get("citation_authors") or evidence.get("source_authors")
    lines = [
        Paragraph(f"Evidence {index}: {_text(title, 'Citation metadata unavailable')}", styles["subsection"]),
        _field("Evidence ID", evidence.get("evidence_id"), styles),
        _field("Evidence excerpt", evidence.get("excerpt"), styles),
        _field("Evidence relationship", evidence.get("relation"), styles),
        _field("Evidence rationale", evidence.get("rationale"), styles),
        _field("Evidence availability", evidence.get("evidence_availability"), styles),
        _field("Citation title", title, styles),
        _field("Authors", _authors(authors), styles),
        _field("Publication year", evidence.get("citation_year") or evidence.get("source_year"), styles),
        _field("Journal", evidence.get("citation_journal") or evidence.get("source_journal"), styles),
        _field("DOI", evidence.get("citation_doi") or evidence.get("source_doi"), styles),
        _field("Source URL", evidence.get("source_url"), styles),
        _field("Source provider", evidence.get("source_provider"), styles),
        _field("Source identifiers", _format_identifiers(evidence.get("source_identifiers")), styles),
    ]
    return lines


def _label_value(label: str, value: object, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return _p(f"<b>{_text(label)}</b>: {_text(value, 'Not available')}", styles["body"])


def _field(label: str, value: object, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return _label_value(label, value, styles)


def _p(value: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_text(value), style)


def _text(value: object, fallback: str = "—") -> str:
    if value is None or value == "":
        value = fallback
    # Escape all user/database text before constructing ReportLab's XML-like markup.
    cleaned = "".join(
        character for character in str(value)
        if (character in "\r\n\t" or
            (unicodedata.category(character) not in {"Cc", "Cs"} and ord(character) not in {0xFFFE, 0xFFFF}))
    )
    escaped = escape(cleaned, {"'": "&#x27;", '"': "&quot;"})
    return escaped.replace("\r\n", "<br/>").replace("\n", "<br/>").replace("\r", "<br/>")


def _joined(value: object) -> str:
    if isinstance(value, (list, tuple)):
        return "; ".join(str(item) for item in value) if value else "None recorded"
    return str(value) if value else "None recorded"


def _authors(value: object) -> str:
    if not isinstance(value, (list, tuple)):
        return str(value) if value else "Not available"
    names = []
    for author in value:
        if isinstance(author, dict):
            name = author.get("name") or " ".join(
                part for part in (author.get("given"), author.get("family")) if part
            )
            names.append(str(name) if name else str(author))
        else:
            names.append(str(author))
    return "; ".join(names) if names else "Not available"


def _format_identifiers(value: object) -> str:
    if not isinstance(value, (list, tuple)):
        return str(value) if value else "Not available"
    formatted = []
    for item in value:
        if isinstance(item, dict):
            provider, identifier = item.get("provider"), item.get("identifier")
            if provider or identifier:
                formatted.append(f"{provider or 'Source'}: {identifier or 'Not available'}")
        else:
            formatted.append(str(item))
    return "; ".join(formatted) if formatted else "Not available"


def _confidence(value: object) -> str:
    if isinstance(value, (float, int)):
        return f"{value:.0%}"
    return str(value) if value is not None else "Not available"


def _unique_values(results: list[object], key: str) -> str:
    values = sorted({str(row[key]) for row in results if isinstance(row, dict) and row.get(key)})
    return "; ".join(values) if values else "Not recorded"


def _draw_page(canvas, doc) -> None:
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(colors.HexColor("#D8E0E5"))
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 0.48 * inch, width - doc.rightMargin, 0.48 * inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#62717D"))
    canvas.drawString(doc.leftMargin, 0.31 * inch, "EDUFIND · Scientific Verification Report")
    canvas.drawRightString(width - doc.rightMargin, 0.31 * inch, f"Page {doc.page}")
    canvas.restoreState()
