import os
from pathlib import Path
from uuid import UUID


class LocalDocumentStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def staging_path(self, document_id: UUID) -> Path:
        return self.root / f".{document_id.hex}.upload"

    def document_path(self, stored_filename: str) -> Path:
        # Callers use server-generated UUID filenames, never original names.
        document_id = UUID(Path(stored_filename).stem)
        return self.root / f"{document_id}.pdf"

    def promote(self, staging_path: Path, stored_filename: str) -> Path:
        destination = self.document_path(stored_filename)
        os.replace(staging_path, destination)
        return destination

    def remove_staging(self, path: Path) -> None:
        self._remove_managed_path(path)

    def remove_document(self, stored_filename: str) -> None:
        self._remove_managed_path(self.document_path(stored_filename))

    def _remove_managed_path(self, path: Path) -> None:
        resolved = path.resolve()
        if resolved.parent != self.root:
            raise ValueError("Refusing to remove a path outside document storage.")
        resolved.unlink(missing_ok=True)

