from __future__ import annotations
from typing import List
import os

class EmbeddingModel:
    def __init__(self, model_name: str = "intfloat/e5-large-v2", device: str | None = None):
        from sentence_transformers import SentenceTransformer
        self.model_name = model_name
        self.device = device
        self.model = SentenceTransformer(model_name, device=device)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        # e5: рекомендовано prefix "passage: "
        passages = [f"passage: {t}" for t in texts]
        return self.model.encode(passages, normalize_embeddings=True).tolist()

    def embed_query(self, text: str) -> List[float]:
        q = f"query: {text}"
        return self.model.encode([q], normalize_embeddings=True)[0].tolist()
