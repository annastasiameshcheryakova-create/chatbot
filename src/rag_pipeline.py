from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from pathlib import Path
import hashlib

from src.data_loader import load_raw_docs
from src.chunking import chunk_docs
from src.embeddings import EmbeddingModel
from src.retriever import ChromaRetriever
from src.llm import LLM, LLMConfig

def _chunk_id(source: str, idx: int, text: str) -> str:
    h = hashlib.md5((source + str(idx) + text[:200]).encode("utf-8", errors="ignore")).hexdigest()
    return f"{source}#{idx}#{h[:8]}"

@dataclass
class PipelineConfig:
    raw_dir: str = "data/raw"
    persist_dir: str = "vectorstore/chroma_db"
    collection: str = "bioconsult"
    embed_model: str = "intfloat/e5-large-v2"
    top_k: int = 4

class RAGPipeline:
    def __init__(self, cfg: PipelineConfig, llm_cfg: LLMConfig):
        self.cfg = cfg
        self.embedder = EmbeddingModel(model_name=cfg.embed_model)
        self.retriever = ChromaRetriever(persist_dir=cfg.persist_dir, collection_name=cfg.collection)
        self.retriever.attach_embedder(self.embedder)
        self.llm = LLM(llm_cfg)

    def index(self, clear: bool = False) -> Dict[str, Any]:
        if clear:
            self.retriever.clear()

        raw_docs = load_raw_docs(self.cfg.raw_dir)
        chunks = chunk_docs(raw_docs, chunk_size=900, chunk_overlap=150)

        payload = []
        for idx, ch in enumerate(chunks):
            payload.append({
                "id": _chunk_id(ch.meta["source"], idx, ch.text),
                "text": ch.text,
                "meta": ch.meta
            })

        if payload:
            self.retriever.add_chunks(payload)

        return {
            "raw_docs": len(raw_docs),
            "chunks": len(payload),
            "persist_dir": self.cfg.persist_dir,
            "collection": self.cfg.collection
        }

    def ask(self, question: str) -> Dict[str, Any]:
        contexts = self.retriever.query(question, top_k=self.cfg.top_k)
        answer = self.llm.generate(question, contexts)

        sources = []
        for i, c in enumerate(contexts, start=1):
            sources.append({
                "n": i,
                "source": c.get("meta", {}).get("source", ""),
                "snippet": (c.get("text") or "")[:220] + ("…" if len(c.get("text") or "") > 220 else "")
            })

        return {"answer": answer, "sources": sources}
