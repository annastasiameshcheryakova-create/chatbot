import { KB } from "./kb.js";

/**
 * RAG (browser) — BM25 Retriever
 * - chunking з перекриттям
 * - токенізація під укр/лат, цифри
 * - BM25 (k1, b)
 * - topK retrieval + score threshold
 */
export const RAG = (() => {
  let chunks = []; // {id,title,text, tokens, tf:Map, len}
  let df = Object.create(null); // term -> doc freq
  let idf = Object.create(null); // term -> idf
  let avgdl = 0;
  let N = 0;

  const k1 = 1.4;
  const b = 0.75;

  // легка нормалізація
  function normalizeText(text) {
    return (text || "")
      .replace(/\r/g, "")
      .replace(/[“”«»]/g, '"')
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  // токенізація: літери/цифри, підтримка укр через \p{L}
  function tokenize(text) {
    const t = (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!t) return [];

    // можна викинути дуже короткі токени
    return t.split(" ").filter(w => w.length >= 2);
  }

  // простий split по абзацах + “нарізка” до chunkSize
  function chunkText(text, chunkSize = 900, overlap = 140) {
    const clean = normalizeText(text);
    if (!clean) return [];

    // спочатку ріжемо по абзацах, щоб не ламати думку
    const paras = clean.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean);

    const out = [];
    let buf = "";

    for (const p of paras) {
      if ((buf + "\n\n" + p).length <= chunkSize) {
        buf = buf ? (buf + "\n\n" + p) : p;
      } else {
        if (buf) out.push(buf);
        // якщо абзац завеликий — ріжемо “по символах”
        if (p.length > chunkSize) {
          let i = 0;
          while (i < p.length) {
            const end = Math.min(p.length, i + chunkSize);
            out.push(p.slice(i, end));
            i = end - overlap;
            if (i < 0) i = 0;
            if (end === p.length) break;
          }
          buf = "";
        } else {
          buf = p;
        }
      }
    }
    if (buf) out.push(buf);

    // додаємо overlap між чанками (якщо треба)
    // тут уже є overlap на випадок довгих абзаців; для коротких — не обов’язково
    return out;
  }

  function buildIndex(chs) {
    df = Object.create(null);
    idf = Object.create(null);
    N = chs.length;

    let totalLen = 0;

    // рахуємо df + довжини
    for (const ch of chs) {
      totalLen += ch.len;
      const seen = new Set(ch.tokens);
      for (const term of seen) df[term] = (df[term] || 0) + 1;
    }
    avgdl = N ? (totalLen / N) : 0;

    // idf BM25 (okapi)
    // idf = ln( 1 + (N - df + 0.5)/(df + 0.5) )
    for (const [term, d] of Object.entries(df)) {
      idf[term] = Math.log(1 + (N - d + 0.5) / (d + 0.5));
    }
  }

  function makeChunk({ title, text, id }) {
    const norm = normalizeText(text);
    const toks = tokenize(norm);

    // term freq map
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);

    return {
      id,
      title,
      text: norm,
      tokens: toks,
      tf,
      len: toks.length
    };
  }

  function bm25Score(queryTokens, ch) {
    if (!N || !avgdl) return 0;

    let score = 0;
    const dl = ch.len || 0;
    const denomBase = k1 * (1 - b + b * (dl / avgdl));

    // рахуй унікальні терми запиту (щоб “дубль” слів не ламав)
    const uq = new Set(queryTokens);
    for (const term of uq) {
      const f = ch.tf.get(term) || 0;
      if (!f) continue;
      const termIdf = idf[term] || 0;

      const numer = f * (k1 + 1);
      const denom = f + denomBase;

      score += termIdf * (numer / denom);
    }
    return score;
  }

  function rebuildIndexFromKB() {
    const docs = KB.getAll();
    const newChunks = [];

    for (const d of docs) {
      const parts = chunkText(d.text);
      parts.forEach((p, idx) => {
        newChunks.push(makeChunk({
          title: d.title,
          text: p,
          id: `${d.id || d.title}#${idx}`
        }));
      });
    }

    chunks = newChunks;
    buildIndex(chunks);
  }

  function retrieveTopK(question, k = 4) {
    if (!chunks.length) return [];

    const qTokens = tokenize(question);
    if (!qTokens.length) return [];

    const scored = chunks.map(ch => ({
      ch,
      score: bm25Score(qTokens, ch)
    }));

    scored.sort((a, b) => b.score - a.score);

    // поріг відсікання (підкручується)
    const top = scored.slice(0, k).filter(x => x.score > 0.35);

    return top.map(x => x.ch);
  }

  // Корисно для дебага
  function statsInfo() {
    return {
      docs: KB.getAll().length,
      chunks: chunks.length,
      avgdl: Math.round(avgdl),
      vocab: Object.keys(df).length
    };
  }

  return { rebuildIndexFromKB, retrieveTopK, statsInfo };
})();

  function buildVocabStats(chs) {
    const df = Object.create(null);
    for (const ch of chs) {
      const seen = new Set(tokenize(ch.text));
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    return { df, N: chs.length };
  }

  function embed(text, st) {
    const toks = tokenize(text);
    const tf = Object.create(null);
    for (const t of toks) tf[t] = (tf[t] || 0) + 1;

    const vec = Object.create(null);
    const { df, N } = st || { df:{}, N:1 };
    for (const [t, f] of Object.entries(tf)) {
      const d = df[t] || 0;
      const idf = Math.log((N + 1) / (d + 1)) + 1;
      vec[t] = f * idf;
    }
    return vec;
  }

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const x = a[k] || 0;
      const y = b[k] || 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function rebuildIndexFromKB(){
    const docs = KB.getAll();
    chunks = [];
    for (const d of docs) {
      const parts = chunkText(d.text);
      parts.forEach((p, idx) => {
        chunks.push({ title: d.title, text: p, id: `${d.title}#${idx}` });
      });
    }
    stats = buildVocabStats(chunks);
    chunks.forEach(ch => ch.vec = embed(ch.text, stats));
  }

  function retrieveTopK(question, k=4){
    if(!stats || !chunks.length) return [];
    const qvec = embed(question, stats);
    const scored = chunks.map(ch => ({ ch, score: cosine(qvec, ch.vec) }));
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0, k).filter(x => x.score > 0.05).map(x => x.ch);
  }

  return { rebuildIndexFromKB, retrieveTopK };
})();
