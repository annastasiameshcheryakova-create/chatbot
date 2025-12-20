/* BioConsult — offline RAG (no API required)
 * Put this file at: chatbot/app/main.js
 *
 * What it does:
 * - Lets you upload .txt/.md notes into localStorage (KB)
 * - Builds a simple TF‑IDF-ish index in the browser
 * - Answers questions by selecting best sentences from relevant chunks
 * - By default DOES NOT show your notes/sources (can toggle in Settings)
 */

(() => {
  "use strict";

  /***********************
   * Small helpers
   ***********************/
  const $ = (id) => document.getElementById(id);

  function setStatus(t) {
    $("statusText").textContent = t;
  }

  function escapeHtml(s) {
    return (s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function stripMarkdown(s) {
    return (s || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
      .replace(/#+\s+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sentenceSplit(text) {
    const clean = stripMarkdown(text).replace(/\s+/g, " ").trim();
    if (!clean) return [];
    // Keep it simple: split by . ! ? and Ukrainian abbreviations are rare in notes.
    return clean
      .split(/(?<=[\.\!\?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /***********************
   * UI refs
   ***********************/
  const promptEl = $("prompt");
  const sendBtn = $("sendBtn");
  const chatLog = $("chatLog");
  const chips = $("chips");
  const newChatBtn = $("newChatBtn");

  const ragToggleBtn = $("ragToggleBtn");

  const plusBtn = $("plusBtn");
  const plusMenu = $("plusMenu");
  const closePlusMenu = $("closePlusMenu");
  const pmAddTextFile = $("pmAddTextFile");
  const pmClearChat = $("pmClearChat");
  const pmClearKB = $("pmClearKB");
  const textInput = $("textInput");

  const kbList = $("kbList");
  const kbCount = $("kbCount");

  const settingsPill = $("settingsPill");
  const settingsOverlay = $("settingsOverlay");
  const settingsClose = $("settingsClose");
  const showSourcesChk = $("showSourcesChk");

  let ragEnabled = true;
  let busy = false;

  /***********************
   * Settings
   ***********************/
  const Settings = {
    key: "bioconsult_settings",
    get() {
      try {
        return JSON.parse(localStorage.getItem(this.key) || "{}") || {};
      } catch {
        return {};
      }
    },
    set(patch) {
      const cur = this.get();
      const next = { ...cur, ...(patch || {}) };
      localStorage.setItem(this.key, JSON.stringify(next));
      return next;
    },
  };

  function openSettings() {
    const s = Settings.get();
    showSourcesChk.checked = !!s.showSources;
    settingsOverlay.classList.add("open");
    settingsOverlay.setAttribute("aria-hidden", "false");
  }
  function closeSettings() {
    settingsOverlay.classList.remove("open");
    settingsOverlay.setAttribute("aria-hidden", "true");
  }

  settingsPill.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  showSourcesChk.addEventListener("change", () => {
    Settings.set({ showSources: showSourcesChk.checked });
  });

  /***********************
   * Auto-resize textarea
   ***********************/
  function autoResize() {
    promptEl.style.height = "24px";
    promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + "px";
  }
  promptEl.addEventListener("input", autoResize);

  /***********************
   * Chat render
   ***********************/
  function addMsg(text, who = "user", sources = []) {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    div.textContent = text;

    const s = Settings.get();
    const showSources = !!s.showSources;

    if (who === "bot" && showSources && Array.isArray(sources) && sources.length) {
      const wrap = document.createElement("div");
      wrap.className = "sources";
      wrap.textContent = "Джерела:";

      sources.forEach((src) => {
        const item = document.createElement("div");
        item.className = "src";

        const t = document.createElement("div");
        t.className = "t";
        t.textContent = src.title || "Джерело";

        const sn = document.createElement("div");
        sn.className = "s";
        sn.textContent = src.snippet || "";

        item.appendChild(t);
        item.appendChild(sn);
        wrap.appendChild(item);
      });

      div.appendChild(wrap);
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /***********************
   * Plus menu
   ***********************/
  function openMenu() {
    plusMenu.classList.add("open");
  }
  function closeMenu() {
    plusMenu.classList.remove("open");
  }

  plusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    plusMenu.classList.contains("open") ? closeMenu() : openMenu();
  });
  closePlusMenu.addEventListener("click", closeMenu);

  document.addEventListener("click", (e) => {
    if (!plusMenu.contains(e.target) && e.target !== plusBtn) closeMenu();
  });

  pmAddTextFile.addEventListener("click", () => {
    closeMenu();
    textInput.click();
  });

  pmClearChat.addEventListener("click", () => {
    closeMenu();
    chatLog.innerHTML = "";
    addMsg("Чат очищено ✅", "bot");
    setStatus("Готово");
  });

  pmClearKB.addEventListener("click", () => {
    closeMenu();
    if (!confirm("Очистити базу знань (всі матеріали)?")) return;
    KB.clear();
    RAG.rebuildIndexFromKB();
    renderKB();
    addMsg("Базу знань очищено ✅", "bot");
    setStatus("Готово");
  });

  /***********************
   * RAG toggle
   ***********************/
  ragToggleBtn.addEventListener("click", () => {
    ragEnabled = !ragEnabled;
    ragToggleBtn.textContent = ragEnabled ? "🧠 RAG: увімкнено" : "🧠 RAG: вимкнено";
    ragToggleBtn.setAttribute("aria-pressed", String(ragEnabled));
    setStatus(ragEnabled ? "RAG увімкнено" : "RAG вимкнено");
  });

  /***********************
   * KB storage (docs)
   ***********************/
  const KB = {
    key: "bioconsult_kb_docs",
    getAll() {
      try {
        return JSON.parse(localStorage.getItem(this.key) || "[]");
      } catch {
        return [];
      }
    },
    setAll(docs) {
      localStorage.setItem(this.key, JSON.stringify(docs || []));
    },
    addDoc(doc) {
      const docs = this.getAll();
      docs.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        title: doc.title || "doc.txt",
        text: doc.text || "",
        createdAt: Date.now(),
      });
      this.setAll(docs);
    },
    remove(id) {
      const docs = this.getAll().filter((d) => d.id !== id);
      this.setAll(docs);
    },
    clear() {
      this.setAll([]);
    },
  };

  function renderKB() {
    const docs = KB.getAll();
    kbCount.textContent = `${docs.length} файлів`;
    kbList.innerHTML = "";

    if (docs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sb-item";
      empty.textContent = "Додай .txt/.md через “+”";
      kbList.appendChild(empty);
      return;
    }

    docs
      .slice()
      .reverse()
      .forEach((d) => {
        const row = document.createElement("div");
        row.className = "sb-item";
        row.title = "Натисни, щоб видалити";

        const dot = document.createElement("span");
        dot.className = "badge";
        dot.style.width = "10px";
        dot.style.height = "10px";
        dot.style.boxShadow = "none";
        row.appendChild(dot);

        const name = document.createElement("div");
        name.textContent = d.title;
        name.style.flex = "1";
        row.appendChild(name);

        const del = document.createElement("span");
        del.textContent = "🗑️";
        del.style.opacity = ".75";
        row.appendChild(del);

        row.addEventListener("click", () => {
          if (!confirm(`Видалити "${d.title}" з бази?`)) return;
          KB.remove(d.id);
          RAG.rebuildIndexFromKB();
          renderKB();
          addMsg(`✅ Видалено з бази: ${d.title}`, "bot");
        });

        kbList.appendChild(row);
      });
  }

  /***********************
   * RAG in browser (TF‑IDF-ish)
   ***********************/
  const RAG = (() => {
    let chunks = []; // {title, text, vec}
    let stats = null; // {df, N}

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

    function buildVocabStats(chunks) {
      const df = Object.create(null);
      for (const ch of chunks) {
        const seen = new Set(tokenize(ch.text));
        for (const t of seen) df[t] = (df[t] || 0) + 1;
      }
      return { df, N: chunks.length };
    }

    function embed(text, stats) {
      const toks = tokenize(text);
      const tf = Object.create(null);
      for (const t of toks) tf[t] = (tf[t] || 0) + 1;

      const vec = Object.create(null);
      const { df, N } = stats || { df: {}, N: 1 };
      for (const [t, f] of Object.entries(tf)) {
        const d = df[t] || 0;
        const idf = Math.log((N + 1) / (d + 1)) + 1;
        vec[t] = f * idf;
      }
      return vec;
    }

    function cosine(a, b) {
      let dot = 0,
        na = 0,
        nb = 0;
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

    function rebuildIndexFromKB() {
      const docs = KB.getAll();
      chunks = [];
      for (const d of docs) {
        const parts = chunkText(d.text);
        parts.forEach((p, idx) => {
          chunks.push({ title: d.title, text: p, id: `${d.title}#${idx}` });
        });
      }
      stats = buildVocabStats(chunks);
      chunks.forEach((ch) => (ch.vec = embed(ch.text, stats)));
    }

    function retrieveTopK(question, k = 4) {
      if (!stats || !chunks.length) return [];
      const qvec = embed(question, stats);
      const scored = chunks.map((ch) => ({ ch, score: cosine(qvec, ch.vec) }));
      scored.sort((a, b) => b.score - a.score);
      return scored
        .slice(0, k)
        .filter((x) => x.score > 0.05)
        .map((x) => x.ch);
    }

    return { rebuildIndexFromKB, retrieveTopK, tokenize };
  })();

  /***********************
   * Offline answer generator (no LLM)
   ***********************/
  const FALLBACK_KB = [
    {
      keys: ["органели", "органел", "органелла", "органелли", "organelle"],
      answer:
        "Органели — це “частини” клітини, які виконують різні функції. Наприклад: ядро зберігає ДНК, мітохондрії виробляють енергію (АТФ), рибосоми синтезують білки, ендоплазматична сітка й апарат Гольджі допомагають модифікувати та транспортувати білки, а лізосоми розщеплюють речовини.",
    },
    {
      keys: ["мітохондр", "mitochond"],
      answer:
        "Мітохондрії — органели, де відбувається клітинне дихання і синтезується більшість АТФ (енергії клітини). Вони мають дві мембрани і власну ДНК, тому частково схожі на колишніх симбіонтів (ендосимбіоз).",
    },
    {
      keys: ["фотосинтез", "photosynth"],
      answer:
        "Фотосинтез — процес, під час якого рослини, водорості й ціанобактерії перетворюють енергію світла на енергію хімічних зв’язків. Загалом: у світловій фазі утворюються АТФ і НАДФ·Н, а в темновій (цикл Кальвіна) фіксується CO₂ і синтезуються вуглеводи.",
    },
    {
      keys: ["реплікац", "dna replication", "репликац"],
      answer:
        "Реплікація ДНК — це копіювання молекули ДНК перед поділом клітини. Процес напівконсервативний: кожна нова молекула має один “старий” і один “новий” ланцюг. Ключові учасники: ДНК-полімераза, праймаза, геліказа, лігаза.",
    },
    {
      keys: ["мітоз", "mitosis"],
      answer:
        "Мітоз — поділ соматичних клітин, у результаті якого утворюються дві генетично однакові клітини. Основні стадії: профаза, метафаза, анафаза, телофаза (і цитокінез).",
    },
    {
      keys: ["мейоз", "meiosis"],
      answer:
        "Мейоз — поділ, що формує статеві клітини (гамети). Він складається з двох поділів і зменшує набір хромосом удвічі. Під час мейозу I відбувається кросинговер і незалежне розходження хромосом, що підвищує різноманіття.",
    },
    {
      keys: ["вірус", "бактер", "virus", "bacter"],
      answer:
        "Бактерії — клітинні організми (прокаріоти), які мають власний обмін речовин і можуть самостійно розмножуватись. Віруси — неклітинні форми, які не мають власного метаболізму й розмножуються тільки всередині клітини-хазяїна.",
    },
  ];

  function matchFallback(question) {
    const q = (question || "").toLowerCase();
    for (const item of FALLBACK_KB) {
      if (item.keys.some((k) => q.includes(k))) return item.answer;
    }
    return null;
  }

  function buildSources(contexts) {
    return (contexts || []).map((c) => ({
      title: c.title,
      snippet: stripMarkdown(c.text).slice(0, 220) + (c.text.length > 220 ? "…" : ""),
    }));
  }

  function generateFromContexts(question, contexts) {
    const qTokens = new Set(RAG.tokenize(question));
    const scoredSentences = [];

    for (const ctx of contexts || []) {
      const sents = sentenceSplit(ctx.text);
      for (const s of sents) {
        const toks = RAG.tokenize(s);
        let score = 0;
        for (const t of toks) if (qTokens.has(t)) score += 1;
        // prefer medium sentences
        if (s.length < 40) score -= 0.5;
        if (s.length > 260) score -= 0.5;
        if (score > 0) scoredSentences.push({ s, score, title: ctx.title });
      }
    }

    scoredSentences.sort((a, b) => b.score - a.score);
    const top = scoredSentences.slice(0, 4).map((x) => x.s);

    // If we found nothing useful, return null -> fallback handler
    if (!top.length) return null;

    // Build a clean, human-looking answer:
    const intro = "";
    const body = top
      .map((s) => stripMarkdown(s))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Add a short “wrap-up” line for coherence
    const outro = "Якщо хочеш — уточни, який клас/тема і що саме треба: визначення, етапи чи приклади.";

    return (intro + body + "\n\n" + outro).trim();
  }

  async function offlineAnswer(question) {
    const contexts = ragEnabled ? RAG.retrieveTopK(question, 4) : [];
    const fromNotes = generateFromContexts(question, contexts);

    if (fromNotes) {
      return { answer: fromNotes, sources: buildSources(contexts) };
    }

    const fallback = matchFallback(question);
    if (fallback) return { answer: fallback, sources: [] };

    return {
      answer:
        "Я поки не бачу в базі знань чітких фрагментів про це. Спробуй додати конспект з цієї теми або постав питання трохи інакше (наприклад, додай 1–2 уточнювальні слова).",
      sources: [],
    };
  }

  /***********************
   * Seed KB from data/raw if empty
   ***********************/
  async function seedIfEmpty() {
    const docs = KB.getAll();
    if (docs.length) return;

    // Try to fetch your repo file: chatbot/data/raw/biology_basics.txt
    // From /chatbot/app/index.html the relative path is ../data/raw/biology_basics.txt
    try {
      const res = await fetch("../data/raw/biology_basics.txt", { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      if (!text || text.trim().length < 50) return;

      KB.addDoc({ title: "biology_basics.txt", text });
      RAG.rebuildIndexFromKB();
      renderKB();
      addMsg("✅ Я завантажив базову нотатку (biology_basics.txt) у базу знань.", "bot");
    } catch {
      // ignore
    }
  }

  /***********************
   * File upload
   ***********************/
  textInput.addEventListener("change", async () => {
    const file = textInput.files?.[0];
    if (!file) return;

    const text = await file.text();
    KB.addDoc({ title: file.name, text });
    RAG.rebuildIndexFromKB();
    renderKB();

    addMsg(`✅ Додано матеріал: ${file.name}`, "bot");
    setStatus("Базу оновлено");
    textInput.value = "";
  });

  /***********************
   * Chips & new chat
   ***********************/
  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    promptEl.value = chip.textContent.replace(/\s+/g, " ").trim() + ": ";
    promptEl.focus();
    autoResize();
  });

  newChatBtn.addEventListener("click", () => {
    chatLog.innerHTML = "";
    promptEl.value = "";
    autoResize();
    promptEl.focus();
    setStatus("Готово");
    closeMenu();
  });

  /***********************
   * Send
   ***********************/
  sendBtn.addEventListener("click", send);
  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  async function send() {
    const text = (promptEl.value || "").trim();
    if (!text || busy) return;

    busy = true;
    setStatus("Думаю…");
    sendBtn.disabled = true;

    addMsg(text, "user");
    promptEl.value = "";
    autoResize();

    try {
      const { answer, sources } = await offlineAnswer(text);
      addMsg(answer || "Немає відповіді", "bot", sources);
      setStatus("Готово");
    } catch (err) {
      addMsg("❌ Помилка: " + (err?.message || String(err)), "bot");
      setStatus("Помилка");
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  }

  /***********************
   * Init
   ***********************/
  function init() {
    renderKB();
    RAG.rebuildIndexFromKB();
    autoResize();
    setStatus("Готово");
    seedIfEmpty(); // loads biology_basics.txt if KB empty
  }

  init();
})();
