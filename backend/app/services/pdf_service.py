from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class EncryptedPdfError(ValueError):
    pass


class InvalidPdfError(ValueError):
    pass


@dataclass(frozen=True)
class PdfExtraction:
    page_texts: list[str]
    metadata: dict[str, Any]
    title: str | None
    authors: list[str]

    @property
    def page_count(self) -> int:
        return len(self.page_texts)

    @property
    def extracted_char_count(self) -> int:
        return sum(len(text.strip()) for text in self.page_texts)


def extract_pdf(path: Path) -> PdfExtraction:
    try:
        reader = PdfReader(str(path), strict=True)
        if reader.is_encrypted:
            raise EncryptedPdfError("Encrypted PDFs are not supported.")
        metadata_obj = reader.metadata
        raw_metadata = dict(metadata_obj or {})
        metadata = {
            str(key).lstrip("/"): _json_safe(value)
            for key, value in raw_metadata.items()
            if value is not None
        }
        title = _clean_metadata_text(metadata_obj.title if metadata_obj else None)
        author_text = _clean_metadata_text(metadata_obj.author if metadata_obj else None)
        authors = [part.strip() for part in author_text.split(";") if part.strip()]
        page_texts: list[str] = []
        for page in reader.pages:
            try:
                page_texts.append(page.extract_text() or "")
            except (PdfReadError, ValueError, UnicodeError) as exc:
                raise InvalidPdfError("The PDF contains a page that could not be read.") from exc
        return PdfExtraction(page_texts=page_texts, metadata=metadata, title=title, authors=authors)
    except (EncryptedPdfError, InvalidPdfError):
        raise
    except Exception as exc:
        raise InvalidPdfError("The uploaded file is not a readable PDF.") from exc


def _clean_metadata_text(value: object) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split()).strip()
    return text or None


def _json_safe(value: object) -> str | int | float | bool | None:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

