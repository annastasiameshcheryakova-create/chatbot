from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
import os
import json
import requests

@dataclass
class LLMConfig:
    provider: str = "openai"   # "openai" або "ollama"
    model: str = "gpt-4o-mini" # або "llama3.1"
    api_key: str = ""          # для openai
    base_url: str = ""         # для ollama (http://localhost:11434)

SYSTEM_PROMPT = """Ти — BioConsult, навчальний консультант з біології.
Мова: українська. Стиль: чітко, структуровано, без зайвої води.

ГОЛОВНЕ ПРАВИЛО:
- Якщо надано контекст (RAG) — опирайся на нього як на основне джерело.
- Якщо контексту недостатньо — прямо скажи, чого бракує, і попроси додати матеріали.

ФОРМАТ:
1) Коротка відповідь (1–3 речення)
2) Пояснення списком
3) (Опційно) приклад/аналогія
4) Джерела: [#1], [#2] лише якщо реально використав RAG.
"""

def _format_context(contexts: List[Dict[str, Any]]) -> str:
    if not contexts:
        return ""
    blocks = []
    for i, c in enumerate(contexts, start=1):
        src = c.get("meta", {}).get("source", "джерело")
        txt = (c.get("text") or "").strip()
        blocks.append(f"[#{i} {src}] {txt}")
    return "\n\n".join(blocks)

class LLM:
    def __init__(self, cfg: LLMConfig):
        self.cfg = cfg

    def generate(self, user_text: str, contexts: List[Dict[str, Any]]) -> str:
        ctx = _format_context(contexts)

        if self.cfg.provider == "openai":
            return self._openai(user_text, ctx)
        if self.cfg.provider == "ollama":
            return self._ollama(user_text, ctx)

        raise ValueError(f"Unknown provider: {self.cfg.provider}")

    def _openai(self, user_text: str, ctx: str) -> str:
        # OpenAI Responses API (сучасна)
        import requests

        api_key = self.cfg.api_key or os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is missing")

        content = user_text
        if ctx:
            content += "\n\nКонтекст (RAG):\n" + ctx

        payload = {
            "model": self.cfg.model,
            "input": [
                {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
                {"role": "user", "content": [{"type": "text", "text": content}]}
            ]
        }

        r = requests.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=60
        )
        if not r.ok:
            raise RuntimeError(r.text)

        data = r.json()
        # частий випадок: output_text
        if isinstance(data.get("output_text"), str) and data["output_text"]:
            return data["output_text"]

        # fallback: витяг з output[]
        out = data.get("output", [])
        for item in out:
            for c in item.get("content", []):
                if c.get("type") in ("output_text", "text") and isinstance(c.get("text"), str):
                    return c["text"]

        return ""

    def _ollama(self, user_text: str, ctx: str) -> str:
        base = self.cfg.base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        prompt = SYSTEM_PROMPT + "\n\n"
        if ctx:
            prompt += "Контекст (RAG):\n" + ctx + "\n\n"
        prompt += "Запит користувача:\n" + user_text

        # Ollama generate API
        url = f"{base}/api/generate"
        payload = {"model": self.cfg.model, "prompt": prompt, "stream": False}

        r = requests.post(url, json=payload, timeout=120)
        if not r.ok:
            raise RuntimeError(r.text)
        return (r.json().get("response") or "").strip()
