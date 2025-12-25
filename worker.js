// worker.js
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(request),
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(request),
      });
    }

    try {
      const { question, context, shortMode } = await request.json();

      const system = `
Ти навчальний асистент з біології.
Відповідай ЛИШЕ на основі КОНТЕКСТУ.
Якщо у контексті немає відповіді — скажи: "У базі немає відповіді на це питання."
Не вигадуй фактів.
Мова відповіді: українська.

Формат:
- якщо shortMode=true → 1 речення (до ~25 слів)
- інакше → 2–6 речень, по суті, без води.
`.trim();

      const user = `
ПИТАННЯ:
${question}

КОНТЕКСТ:
${context}
`.trim();

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }),
      });

      const data = await resp.json();
      const answer = data?.choices?.[0]?.message?.content?.trim() || "";

      return new Response(JSON.stringify({ answer }), {
        headers: {
          ...corsHeaders(request),
          "Content-Type": "application/json"
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({
        error: String(e?.message || e)
      }), {
        status: 500,
        headers: corsHeaders(request)
      });
    }
  }
};

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
