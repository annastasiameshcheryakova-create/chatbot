from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Optional

@dataclass
class RawDoc:
    text: str
    source: str  # filename
    meta: Dict

def _read_text_file(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")

def _read_pdf_file(p: Path) -> str:
    # легкий PDF рідер без OCR (працює з текстовими PDF)
    from pypdf import PdfReader
    reader = PdfReader(str(p))
    pages = []
    for i, page in enumerate(reader.pages):
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n".join(pages)

def load_raw_docs(raw_dir: str = "data/raw") -> List[RawDoc]:
    raw_path = Path(raw_dir)
    raw_path.mkdir(parents=True, exist_ok=True)

    docs: List[RawDoc] = []
    for p in raw_path.rglob("*"):
        if not p.is_file():
            continue

        suffix = p.suffix.lower()
        try:
            if suffix in [".txt", ".md"]:
                text = _read_text_file(p)
            elif suffix == ".pdf":
                text = _read_pdf_file(p)
            else:
                continue

            text = (text or "").strip()
            if not text:
                continue

            docs.append(RawDoc(
                text=text,
                source=p.name,
                meta={"path": str(p), "ext": suffix}
            ))
        except Exception as e:
            # якщо один файл битий — не валимо весь пайплайн
            docs.append(RawDoc(
                text="",
                source=p.name,
                meta={"path": str(p), "ext": suffix, "error": str(e)}
            ))

    # відфільтруємо порожні
    docs = [d for d in docs if d.text.strip()]
    return docs
