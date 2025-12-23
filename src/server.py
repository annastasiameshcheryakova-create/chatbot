import os
from typing import List, Dict
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import chromadb
from chromadb.config import Settings
from openai import OpenAI

# ========= CONFIG =========
load_dotenv()

DATA_DIR = "data/raw"
PERSIST_DIR = "vectorstore"
COLLECTION = "kb"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
if not OPENAI_API_KEY:
    raise RuntimeError("Не знайдено OPENAI_API_KEY. Створи .env і додай ключ.")

client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="BioConsult RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # для тестів, потім краще звузити
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma = chromadb.PersistentClient(
    path=PERSIST_DIR,
    settings=Settings(anonymized_telemetry=False)
)

# ========= Utils =========
def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(PERSIST_DIR, exist_ok=True)

def get_collection():
    return chroma.get_or_create_collection(COLLECTION)

def read_raw_texts() -> List[Dict]:
    ensure_dirs()
    docs = []
    for fn in os.listdir(DATA_DIR):
        if fn.lower().endswith((".txt", ".md")):
            path = os.path.join(DATA_DIR, fn)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                docs.append({"id": fn, "title": fn, "text": f.read()})
    return docs

def chunk_text(text: str, chunk_size: int = 900, overlap: int = 120) -> List[str]:
    clean = " ".join((text or "").split())
    if not clean:
        return []
    out = []
    i = 0
    while i < len(clean):
        end = min(len(clean), i + chunk_size)
        out.append(clean[i:end])
        i = max(0, end - overlap)
        if end == len(clean):
            break
    return out

def embed_texts(texts: List[str]) -> List[List[float]]:
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [d.embedding for d in resp.data]

# ========= RAG =========
def rebuild_index() -> Dict:
    ensure_dirs()

    # пересоздаємо колекцію
    try:
        chroma.delete_collection(COLLECTION)
    except Exception:
        pass
    col = chroma.get_or_create_collection(COLLECTION)

    docs = read_raw_texts()
    ids, metadatas, texts = [], [], []

    for d in docs:
        parts = chunk_text(d["text"])
        for i, p in enumerate(parts):
            ids.append(f"{d['id']}#{i}")
            metadatas.append({"title": d["title"], "chunk": i})
            texts.append(p)

    if not texts:
        return {"ok": True, "chunks": 0, "message": "Немає .txt/.md у data/raw"}

    batch = 64
    for start in range(0, len(texts), batch):
        sub_texts = texts[start:start + batch]
        sub_ids = ids[start:start + batch]
        sub_meta = metadatas[start:start + batch]
        sub_emb = embed_texts(sub_texts)

        col.add(
            ids=sub_ids,
            documents=sub_texts,
            metadatas=sub_meta,
            embeddings=sub_emb
        )

    return {"ok": True, "chunks": len(texts)}

def retrieve(question: str, k: int = 6) -> List[Dict]:
    col = get_collection()

    q_emb = embed_texts([question])[0]
    res = col.query(query_embeddings=[q_emb], n_results=k)

    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]

    out = []
    for doc, meta in zip(docs, metas):
        out.append({"title": meta.get("title", "kb"), "text": doc})
    return out

# ========= Prompt (ВАЖЛИВО: fallback якщо контексту нема) =========
def build_messages(question: str, contexts: List[Dict]) -> List[Dict]:
    if contexts:
        context_block = "\n\n".join(
            [f"[{i+1}] ({c['title']}) {c['text']}" for i, c in enumerate(contexts)]
        )

        system = (
            "Ти BioConsult — дружній навчальний асистент з біології. "
            "Відповідай українською, просто і структуровано. "
            "Контекст нижче — це база знань (використовуй її як джерело). "
            "НЕ цитуй уривки дослівно і НЕ показуй конспекти. "
            "Якщо контекст суперечить твоїм знанням — довіряй контексту."
        )

        user = (
            f"КОНТЕКСТ (для тебе):\n{context_block}\n\n"
            f"ПИТАННЯ: {question}\n\n"
            "Дай відповідь:\n"
            "1) коротко суть\n"
            "2) пояснення простими словами\n"
            "3) якщо доречно — список/кроки\n"
        )
        return [{"role": "system", "content": system},
                {"role": "user", "content": user}]
    else:
        # ✅ Немає контексту -> відповідаємо зі загальних знань
        system = (
            "Ти BioConsult — дружній навчальний асистент з біології. "
            "Відповідай українською, просто і чітко. "
            "По цьому питанню в базі знань немає контексту, тому відповідай зі своїх загальних знань. "
            "Якщо не впевнений — скажи 'не впевнений' і постав 1 уточнювальне питання."
        )
        user = (
            f"ПИТАННЯ: {question}\n\n"
            "Формат:\n"
            "Почни з фрази 'Це ...' і дай коротке пояснення 2–6 реченнями.\n"
        )
        return [{"role": "system", "content": system},
                {"role": "user", "content": user}]

# ========= API =========
class ChatIn(BaseModel):
    question: str
    rag: bool = True
    top_k: int = 6

class ChatOut(BaseModel):
    answer: str
    used_contexts: int

@app.get("/api/health")
def health():
    return {"ok": True}

@app.post("/api/reindex")
def reindex():
    return rebuild_index()

@app.post("/api/chat", response_model=ChatOut)
def chat(payload: ChatIn):
    question = (payload.question or "").strip()
    if not question:
        return ChatOut(answer="Напиши запитання 🙂", used_contexts=0)

    contexts = retrieve(question, payload.top_k) if payload.rag else []
    messages = build_messages(question, contexts)

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.4
    )

    answer = (resp.choices[0].message.content or "").strip()
    return ChatOut(answer=answer, used_contexts=len(contexts))
