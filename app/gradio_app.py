from __future__ import annotations
import os
import gradio as gr

from src.rag_pipeline import RAGPipeline, PipelineConfig
from src.llm import LLMConfig

def build_pipeline(provider: str, model: str, api_key: str, ollama_url: str) -> RAGPipeline:
    llm_cfg = LLMConfig(
        provider=provider,
        model=model,
        api_key=api_key,
        base_url=ollama_url
    )
    cfg = PipelineConfig()
    return RAGPipeline(cfg, llm_cfg)

def format_sources(sources):
    if not sources:
        return ""
    out = ["\n\n**Джерела (RAG):**"]
    for s in sources:
        out.append(f"- [#{s['n']}] **{s['source']}**: {s['snippet']}")
    return "\n".join(out)

with gr.Blocks(title="BioConsult RAG") as demo:
    gr.Markdown("# 🧬 BioConsult — RAG консультант з біології")
    gr.Markdown("1) Поклади файли (.txt/.md/.pdf) у `data/raw/`  \n2) Натисни **Індексувати**  \n3) Питай у чаті")

    with gr.Row():
        provider = gr.Dropdown(["openai", "ollama"], value="openai", label="LLM Provider")
        model = gr.Textbox(value="gpt-4o-mini", label="Model (OpenAI або Ollama)")
    with gr.Row():
        api_key = gr.Textbox(value=os.getenv("OPENAI_API_KEY",""), label="OpenAI API Key (якщо provider=openai)", type="password")
        ollama_url = gr.Textbox(value=os.getenv("OLLAMA_BASE_URL","http://localhost:11434"), label="Ollama URL (якщо provider=ollama)")

    pipeline_state = gr.State(None)

    with gr.Row():
        index_btn = gr.Button("📚 Індексувати (data/raw → Chroma)")
        clear_index = gr.Checkbox(value=False, label="Очистити індекс перед індексацією")

    index_out = gr.Markdown()

    chatbot = gr.Chatbot(height=420, type="messages")
    msg = gr.Textbox(label="Запит", placeholder="Наприклад: Поясни різницю між мітозом і мейозом")
    send = gr.Button("Надіслати")

    def do_index(provider, model, api_key, ollama_url, clear_index):
        pipe = build_pipeline(provider, model, api_key, ollama_url)
        stats = pipe.index(clear=clear_index)
        return pipe, f"✅ Індекс готовий: **docs={stats['raw_docs']}**, **chunks={stats['chunks']}** (collection: `{stats['collection']}`)"

    index_btn.click(
        do_index,
        inputs=[provider, model, api_key, ollama_url, clear_index],
        outputs=[pipeline_state, index_out]
    )

    def chat(pipe, history, text):
        if pipe is None:
            return history + [{"role":"assistant","content":"⚠️ Спочатку натисни **Індексувати**."}], ""

        result = pipe.ask(text)
        answer = result["answer"] + format_sources(result["sources"])

        history = history + [{"role":"user","content":text}]
        history = history + [{"role":"assistant","content":answer}]
        return history, ""

    send.click(chat, inputs=[pipeline_state, chatbot, msg], outputs=[chatbot, msg])
    msg.submit(chat, inputs=[pipeline_state, chatbot, msg], outputs=[chatbot, msg])

if __name__ == "__main__":
    demo.launch()
