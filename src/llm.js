function buildSystem(){
  return [
    "Ти — BioConsult, навчальний консультант з біології.",
    "Мова відповіді: українська.",
    "Стиль: чітко, структуровано, без зайвої води.",
    "",
    "ГОЛОВНЕ ПРАВИЛО:",
    "- Якщо надано 'Контекст (RAG)', використовуй ЙОГО як основне джерело фактів.",
    "- Не вигадуй інформацію, якої немає в контексті.",
    "- Якщо контексту недостатньо — прямо скажи, що саме потрібно додати.",
    "",
    "ФОРМАТ ВІДПОВІДІ:",
    "1) Коротка відповідь (1–3 речення).",
    "2) Пояснення списком (маркери або нумерація).",
    "3) За потреби — приклад або порівняння.",
    "4) Блок 'Джерела' з позначками [#1], [#2] — ТІЛЬКИ якщо реально використано RAG-контекст.",
    "",
    "ОБМЕЖЕННЯ:",
    "- Не підміняй джерела власними знаннями.",
    "- Не давай медичних діагнозів або лікування.",
    "- Якщо питання виходить за межі біології — повідом про це."
  ].join(\"\\n\");
}


function buildContextBlock(contexts){
  if(!contexts?.length) return "";
  return contexts.map((c, i) => `[#${i+1} ${c.title}] ${c.text}`).join("\n\n");
}

function sourcesFromContexts(contexts){
  return (contexts || []).map(c => ({
    title: c.title,
    snippet: (c.text || "").slice(0, 200) + ((c.text || "").length > 200 ? "…" : "")
  }));
}

function extractOutputText(data){
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;

  const out = data?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") return c.text;
          if (c?.type === "text" && typeof c?.text === "string") return c.text;
        }
      }
    }
  }
  return "";
}

export const LLM = {
  async answer({ apiKey, model, userText, contexts, image }){
    const system = buildSystem();
    const ctx = buildContextBlock(contexts);

    const userParts = [{ type:"text", text: userText }];

    if (image?.url) {
      userParts.push({ type:"text", text: `\n(Додано зображення: ${image.label || "image"})\n` });
      userParts.push({ type:"image_url", image_url: { url: image.url } });
    }

    if (ctx) userParts.push({ type:"text", text: `\n\nКонтекст (RAG):\n${ctx}` });

    const body = {
      model: model || "gpt-4o-mini",
      input: [
        { role:"system", content:[{ type:"text", text: system }] },
        { role:"user", content: userParts }
      ]
    };

    const res = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + apiKey
      },
      body: JSON.stringify(body)
    });

    if(!res.ok){
      const t = await res.text();
      throw new Error(t || ("HTTP " + res.status));
    }

    const data = await res.json();
    const text = extractOutputText(data) || "(порожня відповідь)";

    return { answer: text, sources: sourcesFromContexts(contexts) };
  }
};
