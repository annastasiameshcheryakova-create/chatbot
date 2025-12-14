from __future__ import annotations
from typing import List, Dict, Any, Optional
from pathlib import Path

from src.embeddings import EmbeddingModel

class ChromaRetriever:
    def __init__(self, persist_dir: str = "vectorstore/chroma_db", collection_name: str = "bioconsult"):
        import chromadb
        from chromadb.config import Settings

        Path(persist_dir).mkdir(parents=True, exist_ok=True)

        self.persist_dir = persist_dir
        self.collection_name = collection_name
        self.client = chromadb.PersistentClient(path=persist_dir, settings=Settings(anonymized_telemetry=False))
        self.collection = self.client.get_or_create_collection(name=collection_name)
        self.embedder = None

    def attach_embedder(self, embedder: EmbeddingModel):
        self.embedder = embedder

    def clear(self):
        self.client.delete_collection(self.collection_name)
        self.collection = self.client.get_or_create_collection(name=self.collection_name)

    def add_chunks(self, chunks: List[Dict[str, Any]]):
        """
        chunks: [{id, text, meta}]
        """
        if self.embedder is None:
            raise RuntimeError("Embedder not attached")

        ids = [c["id"] for c in chunks]
        docs = [c["text"] for c in chunks]
        metas = [c["meta"] for c in chunks]
        embs = self.embedder.embed_documents(docs)

        # Chroma upsert
        self.collection.upsert(ids=ids, documents=docs, metadatas=metas, embeddings=embs)

    def query(self, query_text: str, top_k: int = 4) -> List[Dict[str, Any]]:
        if self.embedder is None:
            raise RuntimeError("Embedder not attached")

        q_emb = self.embedder.embed_query(query_text)
        res = self.collection.query(
            query_embeddings=[q_emb],
            n_results=top_k,
            include=["documents", "metadatas", "distances", "ids"]
        )

        out = []
        for i in range(len(res["ids"][0])):
            out.append({
                "id": res["ids"][0][i],
                "text": res["documents"][0][i],
                "meta": res["metadatas"][0][i],
                "distance": res["distances"][0][i],
            })
        return out
