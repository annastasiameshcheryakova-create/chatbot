from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class Chunk:
    text: str
    meta: Dict

def normalize(text: str) -> str:
    return " ".join((text or "").replace("\r", "").split()).strip()

def chunk_text(
    text: str,
    source: str,
    chunk_size: int = 900,
    chunk_overlap: int = 150
) -> List[Chunk]:
    text = normalize(text)
    if not text:
        return []

    chunks: List[Chunk] = []
    i = 0
    n = len(text)

    while i < n:
        end = min(n, i + chunk_size)
        chunk = text[i:end].strip()

        if chunk:
            chunks.append(Chunk(
                text=chunk,
                meta={
                    "source": source,
                    "start": i,
                    "end": end
                }
            ))

        if end == n:
            break
        i = max(0, end - chunk_overlap)

    return chunks

def chunk_docs(raw_docs, chunk_size=900, chunk_overlap=150) -> List[Chunk]:
    all_chunks: List[Chunk] = []
    for d in raw_docs:
        all_chunks.extend(chunk_text(d.text, source=d.source, chunk_size=chunk_size, chunk_overlap=chunk_overlap))
    return all_chunks
