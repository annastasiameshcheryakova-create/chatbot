import os
from typing import List, Dict, Optional, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import chromadb
from chromadb.config import Settings
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

# =========================
# Config
# =========================
DATA_DIR = os.getenv("DATA_DIR", "data/raw")
PERSIST_DIR = os.getenv("PERSIST_DIR", "vectorstore")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "kb")

# Embeddings (локально, без ключів)
EMBED_MODEL = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")

# LLM provider
# - openai: офіційний OpenAI
# - compatible: OpenAI-compatible (DeepSeek, інші)
# - gemini: Google Gemini (опційно; треба дод. пакет)
PROVIDER: Literal["openai", "compatible", "gemini"] = os.getenv("PROVIDER", "openai")  # openai|compatible|gemini
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")

# OpenAI-compatible settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")  # для compatible: напр. https://api.deepseek.com

# Gemini settings (опційно)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# RAG behavior
DEFAULT_TOP_K = int(os.getenv("TOP_K", "6"))
MAX_TOP_K = 12

SYSTEM_STYLE = os.getenv(
    "SYSTEM_STYLE",
    "Ти дружній навчальний асистент з біології. "
    "Відповідай українською, просто й структуровано. "
    "Використовуй КОНТЕКСТ як джерело, але НЕ цитуй його дослівно і НЕ показуй уривки. "
    "Якщо у контексті немає відповіді — скажи чесно і попроси уточнення."
)

# =========================
# App
# =========================
app = FastAPI(title="BioConsult RAG Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # для продакшну краще звузити
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Chroma (persistent)
# =========================
chroma = chromadb.PersistentClient(
    path=PERSIST_DIR,
    settings=Settings(anonymized_telemetry=False)
)

embedding_fn = SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)


def get_collection():
    return chroma.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=embedding_fn
    )


# =========================
# Utils
# =========================
def list_raw_files() -> List[str]:
    if not os.path.isdir(DATA_DIR):
        return []
    out = []
    for fn in os.listdir(DATA_DIR):
        if fn.lower().endswith((".txt", ".md")):
            out.append(os.path.join(DATA_DIR, fn))
    return sorted(out)


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


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


def rebuild_index() -> Dict:
    files = list_raw_files()
    if not files:
        return {"ok": True, "files": 0, "chunks": 0, "note": f"Немає .txt/.md у {DATA_DIR}"}

    # Пересоздаємо колекцію (простий і надійний варіант)
    try:
        chroma.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    col = get_collection()

    ids: List[str] = []
    docs: List[str] = []
    metas: List[Dict] = []

    for path in files:
        title = os.path.basename(path)
        text = read_text(path)
        parts = chunk_text(text)
        for idx, p in enumerate(parts):
            ids.append(f"{title}#{idx}")
            docs.append(p)
            metas.append({"title": title, "chunk": idx})

    if not docs:
        return {"ok": True, "files": len(files), "chunks": 0}

    # add without embeddings (embedding_function зробить їх сама)
    col.add(ids=ids, documents=docs, metadatas=metas)

    return {"ok": True, "files": len(files), "chunks": len(docs)}


def retrieve(question: str, k: int = DEFAULT_TOP_K) -> List[Dict]:
    col = get_collection()
    k = max(1, min(int(k), MAX_TOP_K))

    res = col.query(
        query_texts=[question],
        n_results=k
    )

    out = []
    documents = (res.get("documents") or [[]])[0]
    metadatas = (res.get("metadatas") or [[]])[0]

    for doc, meta in zip(documents, metadatas):
        out.append({
            "title": (meta or {}).get("title", "kb"),
            "text": doc
        })
    return out


def build_messages(question: str, contexts: List[Dict], history: List[Dict]) -> List[Dict]:
    # history: [{"role":"user"|"assistant","content":"..."}]
    context_block = "\n\n".join(
        [f"[{i+1}] ({c['title']}) {c['text']}" for i, c in enumerate(contexts)]
    )

    user_prompt = (
        f"КОНТЕКСТ (для тебе):\n{context_block}\n\n"
        f"ПИТАННЯ: {question}\n\n"
        "Відповідь: коротко, ясно, структуровано. "
        "Не цитуй уривки з контексту дослівно."
    )

    msgs = [{"role": "system", "content": SYSTEM_STYLE}]

    # додаємо останні 8 реплік історії (щоб не роздувати)
    if history:
        trimmed = history[-8:]
        for m in trimmed:
            role = m.get("role")
            content = m.get("content", "")
            if role in ("user", "assistant") and content:
                msgs.append({"role": role, "content": content})

    msgs.append({"role": "user", "content": user_prompt})
    return msgs


# =========================
# LLM call
# =========================
def llm_answer(messages: List[Dict]) -> str:
    if PROVIDER in ("openai", "compatible"):
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=400, detail="Немає OPENAI_API_KEY у змінних середовища.")

        from openai import OpenAI

        if PROVIDER == "compatible":
            if not OPENAI_BASE_URL:
                raise HTTPException(status_code=400, detail="Для PROVIDER=compatible вкажи OPENAI_BASE_URL.")
            cli = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        else:
            cli = OpenAI(api_key=OPENAI_API_KEY)

        resp = cli.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            temperature=0.4
        )
        return (resp.choices[0].message.content or "").strip()

    if PROVIDER == "gemini":
        # Опційно: встанови пакет google-genai
        # pip install google-genai
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=400, detail="Немає GEMINI_API_KEY у змінних середовища.")
        try:
            from google import genai
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Для Gemini треба встановити пакет: pip install google-genai"
            )

        client = genai.Client(api_key=GEMINI_API_KEY)

        # Перетворюємо messages у текст (простий варіант)
        joined = ""
        for m in messages:
            joined += f"{m['role'].upper()}: {m['content']}\n\n"

        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=joined
        )
        return (resp.text or "").strip()

    raise HTTPException(status_code=400, detail="Невідомий PROVIDER.")


# =========================
# API схеми
# =========================
class ChatIn(BaseModel):
    question: str
    rag: bool = True
    top_k: int = DEFAULT_TOP_K
    history: List[Dict] = []  # [{"role":"user"/"assistant","content":"..."}]


class ChatOut(BaseModel):
    answer: str
    used_contexts: int


# =========================
# API routes
# =========================
@app.get("/api/health")
def health():
    return {"ok": True, "provider": PROVIDER, "model": CHAT_MODEL, "embed": EMBED_MODEL}


@app.post("/api/reindex")
def reindex():
    return rebuild_index()


@app.post("/api/chat", response_model=ChatOut)
def chat(payload: ChatIn):
    q = (payload.question or "").strip()
    if not q:
        return ChatOut(answer="Напиши запитання 🙂", used_contexts=0)

    contexts = retrieve(q, payload.top_k) if payload.rag else []
    messages = build_messages(q, contexts, payload.history)

    answer = llm_answer(messages)
    if not answer:
        answer = "Я не зміг сформувати відповідь. Спробуй перефразувати питання."

    return ChatOut(answer=answer, used_contexts=len(contexts))


# =========================
# Serve frontend (app/)
# =========================
# Важливо: монтуємо після /api, щоб /api/* працювало
if os.path.isdir("app"):
    app.mount("/", StaticFiles(directory="app", html=True), name="static")
