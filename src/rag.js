import { KB } from "./kb.js";

export const RAG = (() => {
  let chunks = [];
  let stats = null;

  function tokenize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function chunkText(text, chunkSize = 900, overlap = 120) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];
    const out = [];
    let i = 0;
    while (i < clean.length) {
      const end = Math.min(clean.length, i + chunkSize);
      out.push(clean.slice(i, end));
      i = end - overlap;
      if (i < 0) i = 0;
      if (end === clean.length) break;
    }
    return out;
  }

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
