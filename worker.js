export default {
  async fetch(request, env) {
    // --- CORS helpers ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json; charset=utf-8",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      const { question, context, shortMode } = await request.json();

      if (!question || !context) {
        return new Response(JSON.stringify({ error: "Missing question/context" }), {
          status: 400,
          headers: corsHeaders,
        });
      }

      const system =
        "Ти навчальний помічник з біології. " +
        "Відповідай ТІЛЬКИ використовуючи наданий CONTEXT. " +
        "Якщо в CONTEXT нема відповіді — скажи: 'Немає в моїй базі знань.' " +
        "Не вигадуй фактів.";

      const user =
        `QUESTION:\n${question}\n\nCONTEXT:\n${context}\n\n` +
        (shortMode
          ? "Зроби дуже коротко (1-2 речення), без зайвого."
          : "Поясни зрозуміло українською, 3-7 речень, без води.");

      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
        }),
      });

      const data = await resp.json();

      const answer =
        data?.choices?.[0]?.message?.content?.trim() ||
        "Немає відповіді.";

      return new Response(JSON.stringify({ answer }), {
        status: 200,
        headers: corsHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
