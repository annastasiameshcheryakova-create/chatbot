from pathlib import Path

def ensure_dirs():
    Path("data/raw").mkdir(parents=True, exist_ok=True)
    Path("data/processed").mkdir(parents=True, exist_ok=True)
    Path("vectorstore").mkdir(parents=True, exist_ok=True)
    Path("vectorstore/chroma_db").mkdir(parents=True, exist_ok=True)

if __name__ == "__main__":
    ensure_dirs()
    print("✅ Folders ensured: data/raw, data/processed, vectorstore/chroma_db")
