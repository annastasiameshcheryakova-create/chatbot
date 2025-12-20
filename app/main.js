/* =========================================================
   BioConsult — main.js (OFFLINE-FIRST, no API messages)
   - Uses local KB (localStorage) + auto-load ../data/raw/biology_basics.txt
   - RAG TF-IDF in browser
   - Produces clean "AI-like" answers WITHOUT showing your notes/snippets
   - Never mentions API/offline in responses
   ========================================================= */

(() => {
  /***********************
   * UI refs
   ***********************/
  const promptEl = document.getElementById("prompt");
  const sendBtn = document.getElementById("sendBtn");
  const chatLog = document.getElementById("chatLog");
  const chips = document.getElementById("chips");
  const newChatBtn = document.getElementById("newChatBtn");
  const statusText = document.getElementById("statusText");

  const ragToggleBtn = document.getElementById("ragToggleBtn");

  const plusBtn = document.getElementById("plusBtn");
  const plusMenu = document.getElementById("plusMenu");
  const closePlusMenu = document.getElementById("closePlusMenu");

  const pmAddImageFile = document.getElementById("pmAddImageFile");
  const pmAddImageUrl = document.getElementById("pmAddImageUrl");
  const pmAddTextFile = document.getElementById("pmAddTextFile");
  const pmClearChat = document.getElementById("pmClearChat");
  const pmClearKB = document.getElementById("pmClearKB");

  const imageInput = document.getElementById("imageInput");
  const textInput = document.getElementById("textInput");

  const imgModalOverlay = document.getElementById("imgModalOverlay");
  const imgUrlInput = document.getElementById("imgUrlInput");
  const cancelImgModal = document.getElementById("cancelImgModal");
  const addUrlBtn = document.getElementById("addUrlBtn");

  const kbList = document.getElementById("kbList");
  const kbCount = document.getElementById("kbCount");

  // Optional UI in your HTML (can exist): api widgets — we ignore them safely
  const apiPill = document.getElementById("apiPill");
  const apiState = document.getElementById("apiState");
  const apiModalOverlay = document.getElementById("apiModalOverlay");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const modelInput = document.getElementById("modelInput");
  const apiCancel = document.getElementById("apiCancel");
  const apiClear = document.getElementById("apiClear");
  const apiSave = document.getElementById("apiSave");

  /***********************
   * State
   ***********************/
  let ragEnabled = true;
  let busy = false;

  // attachments for current message
  let pendingImageDataUrl = null; // data:image/... base64 OR url
  let pendingImageLabel = null;

  // Auto-loaded base file path:
  const AUTO_KB_PATH = "../data/raw/biology_basics.txt";
  const AUTO_KB_TITLE = "biology_basics.txt";
  const AUTO_KB_FLAG_KEY = "bioconsult_auto_kb_loaded_v1";

  /***********************
   * Helpers: UI
   ***********************/
  function setStatus(t) {
    if (!statusText) return;
    statusText.textContent = t || "";
  }

  function autoResize() {
    if (!promptEl) return;
    promptEl.style.height = "24px";
    promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + "px";
  }
  if (promptEl) promptEl.addEventListener("input", autoResize);

  function addMsg(text, who = "user") {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    div.textContent = text;

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addImagePreviewMessage({ dataUrl, caption, who = "user" }) {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    div.textContent = caption || "Зображення додано:";

    const wrap = document.createElement("div");
    wrap.className = "imgwrap";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "image";
    wrap.appendChild(img);
    div.appendChild(wrap);

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /***********************
   * Plus menu
   ***********************/
  function openMenu() {
    if (plusMenu) plusMenu.classList.add("open");
  }
  function closeMenu() {
    if (plusMenu) plusMenu.classList.remove("open");
  }

  if (plusBtn) {
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      plusMenu.classList.contains("open") ? closeMenu() : openMenu();
    });
  }
  if (closePlusMenu) closePlusMenu.addEventListener("click", closeMenu);

  document.addEventListener("click", (e) => {
    if (!plusMenu) return;
    if (!plusMenu.contains(e.target) && e.target !== plusBtn) closeMenu();
  });

  if (pmAddImageFile) pmAddImageFile.addEventListener("click", () => { closeMenu(); imageInput?.click(); });
  if (pmAddTextFile) pmAddTextFile.addEventListener("click", () => { closeMenu(); textInput?.click(); });
  if (pmAddImageUrl) pmAddImageUrl.addEventListener("click", () => { closeMenu(); openImgModal(); });

  if (pmClearChat) {
    pmClearChat.addEventListener("click", () => {
      closeMenu();
      chatLog.innerHTML = "";
      setStatus("Готово");
    });
  }

  if (pmClearKB) {
    pmClearKB.addEventListener("click", () => {
      closeMenu();
      if (!confirm("Очистити базу знань (всі матеріали)?")) return;
      KB.clear();
      localStorage.removeItem(AUTO_KB_FLAG_KEY);
      RAG.rebuildIndexFromKB();
      renderKB();
      addMsg("Базу знань очищено ✅", "bot");
      setStatus("Готово");
    });
  }

  /***********************
   * Image modal
   ***********************/
  function openImgModal() {
    if (!imgModalOverlay) return;
    imgModalOverlay.classList.add("open");
    imgModalOverlay.setAttribute("aria-hidden", "false");
    if (imgUrlInput) imgUrlInput.value = "";
    setTimeout(() => imgUrlInput?.focus(), 0);
  }
  function closeImgModal() {
    if (!imgModalOverlay) return;
    imgModalOverlay.classList.remove("open");
    imgModalOverlay.setAttribute("aria-hidden", "true");
  }

  if (cancelImgModal) cancelImgModal.addEventListener("click", closeImgModal);
  if (imgModalOverlay) {
    imgModalOverlay.addEventListener("click", (e) => {
      if (e.target === imgModalOverlay) closeImgModal();
    });
  }

  if (addUrlBtn) {
    addUrlBtn.addEventListener("click", async () => {
      const url = (imgUrlInput?.value || "").trim();
      if (!url) return;

      pendingImageDataUrl = url;
      pendingImageLabel = "Зображення (URL)";
      addMsg("Зображення додано ✅ Тепер задай питання про нього.", "bot");
      closeImgModal();
    });
  }

  /***********************
   * RAG toggle
   ***********************/
  if (ragToggleBtn) {
    ragToggleBtn.addEventListener("click", () => {
      ragEnabled = !ragEnabled;
      ragToggleBtn.textContent = ragEnabled ? "🧠 RAG: увімкнено" : "🧠 RAG: вимкнено";
      ragToggleBtn.setAttribute("aria-pressed", String(ragEnabled));
      setStatus("Готово");
    });
  }

  /***********************
   * Inputs
   ***********************/
  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        addMsg("❌ Це не зображення.", "bot");
        imageInput.value = "";
        return;
      }

      const dataUrl = await fileToDataURL(file);
      pendingImageDataUrl = dataUrl;
      pendingImageLabel = file.name;

      addImagePreviewMessage({ dataUrl, caption: `Зображення додано: ${file.name}`, who: "user" });
      addMsg("Добре. Напиши питання про це зображення.", "bot");

      imageInput.value = "";
    });
  }

  if (textInput) {
    textInput.addEventListener("change", async () => {
      const file = textInput.files?.[0];
      if (!file) return;

      const text = await file.text();
      KB.addDoc({ title: file.name, text });
      RAG.rebuildIndexFromKB();
      renderKB();

      addMsg(`✅ Додано матеріал: ${file.name}`, "bot");
      setStatus("Готово");

      textInput.value = "";
    });
  }

  /***********************
   * Chips & new chat
   ***********************/
  if (chips) {
    chips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      promptEl.value = chip.textContent.replace(/\s+/g, " ").trim();
      promptEl.focus();
      autoResize();
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      chatLog.innerHTML = "";
      promptEl.value = "";
      autoResize();
      promptEl.focus();
      setStatus("Готово");
      closeMenu();
    });
  }

  /***********************
   * Send
   ***********************/
  if (sendBtn) sendBtn.addEventListener("click", send);
  if (promptEl) {
    promptEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
  }

  async function send() {
    const text = (promptEl.value || "").trim();
    if (!text || busy) return;

    busy = true;
    setStatus("Думаю…");
    if (sendBtn) sendBtn.disabled = true;

    addMsg(text, "user");
    promptEl.value = "";
    autoResize();

    try {
      // 1) build contexts (RAG)
      const contexts = ragEnabled ? RAG.retrieveTopK(text, 5) : [];

      // 2) generate clean answer (no showing notes)
      const answer = makeCleanAnswer(text, contexts, pendingImageDataUrl);

      addMsg(answer, "bot");

      // reset attachments after send
      pendingImageDataUrl = null;
      pendingImageLabel = null;

      setStatus("Готово");
    } catch (err) {
      addMsg("❌ Помилка: " + (err?.message || String(err)), "bot");
      setStatus("Помилка");
    } finally {
      busy = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  /***********************
   * KB storage (docs)
   ***********************/
  const KB = {
    key: "bioconsult_kb_docs",
    getAll() {
      try { return JSON.parse(localStorage.getItem(this.key) || "[]"); }
      catch { return []; }
    },
    setAll(docs) { localStorage.setItem(this.key, JSON.stringify(docs || [])); },
    addDoc(doc) {
      const docs = this.getAll();
      docs.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        title: doc.title || "doc.txt",
        text: doc.text || "",
        createdAt: Date.now()
      });
      this.setAll(docs);
    },
    remove(id) {
      const docs = this.getAll().filter(d => d.id !== id);
      this.setAll(docs);
    },
    clear() { this.setAll([]); }
  };

  function renderKB() {
    if (!kbCount || !kbList) return;

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

    docs.slice().reverse().forEach(d => {
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
        addMsg(`✅ Видалено: ${d.title}`, "bot");
      });

      kbList.appendChild(row);
    });
  }

  /***********************
   * RAG in browser (TF-IDF)
   ***********************/
  const RAG = (() => {
    let chunks = [];  // {title, text, vec}
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

    function buildVocabStats(allChunks) {
      const df = Object.create(null);
      for (const ch of allChunks) {
        const seen = new Set(tokenize(ch.text));
        for (const t of seen) df[t] = (df[t] || 0) + 1;
      }
      return { df, N: allChunks.length };
    }

    function embed(text, st) {
      const toks = tokenize(text);
      const tf = Object.create(null);
      for (const t of toks) tf[t] = (tf[t] || 0) + 1;

      const vec = Object.create(null);
      const { df, N } = st || { df: {}, N: 1 };
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
      chunks.forEach(ch => ch.vec = embed(ch.text, stats));
    }

    function retrieveTopK(question, k = 5) {
      if (!stats || !chunks.length) return [];
      const qvec = embed(question, stats);
      const scored = chunks.map(ch => ({ ch, score: cosine(qvec, ch.vec) }));
      scored.sort((a, b) => b.score - a.score);
      return scored
        .slice(0, k)
        .filter(x => x.score > 0.06)
        .map(x => x.ch);
    }

    return { rebuildIndexFromKB, retrieveTopK };
  })();

  /***********************
   * Clean answer generation (NO SNIPPETS)
   ***********************/
  function makeCleanAnswer(question, contexts, imageUrl) {
    // If image given, we can only do generic guidance offline:
    if (imageUrl) {
      return "Я бачу, що ти додав(ла) зображення. Напиши, будь ласка, що саме треба визначити (орган, клітина, процес), і я поясню, як це розпізнати та з чим пов’язано.";
    }

    if (!contexts || contexts.length === 0) {
      return "Я не знайшов(ла) у базі знань точного пояснення для цього запиту. Спробуй уточнити: що саме потрібно — визначення, функції чи порівняння?";
    }

    // Build a compact internal “idea” from contexts WITHOUT exposing them
    const merged = contexts
      .slice(0, 4)
      .map(c => normalizeText(c.text))
      .join(" ");

    return buildStudyStyleAnswer(question, merged);
  }

  function normalizeText(s) {
    return (s || "")
      .replace(/[*_`#>|-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildStudyStyleAnswer(question, sourceText) {
    // Extract best sentences related to question tokens
    const qTokens = keyTokens(question);
    const sentences = splitToSentences(sourceText);

    const ranked = sentences
      .map(sent => ({
        sent,
        score: overlapScore(keyTokens(sent), qTokens)
      }))
      .filter(x => x.sent.length > 25)
      .sort((a, b) => b.score - a.score);

    const pick = ranked.slice(0, 4).map(x => x.sent);

    // If overlap low, still try first sentences
    const chosen = pick.length ? pick : sentences.slice(0, 3);

    // Build: definition + explanation + example/fact
    const def = makeDefinitionLine(question, chosen.join(" "));
    const expl = makeExplanation(chosen);
    const ex = makeExampleOrFact(question, chosen.join(" "));

    // Clean final
    return cleanOutput([def, "", expl, ex ? "" : null, ex].filter(Boolean).join("\n"));
  }

  function splitToSentences(text) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (!t) return [];
    // UA/RU punctuation support
    return t.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  }

  function keyTokens(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(t => t.length >= 3)
      .filter(t => !STOP.has(t));
  }

  function overlapScore(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    const b = new Set(bTokens);
    let hit = 0;
    for (const t of aTokens) if (b.has(t)) hit++;
    return hit / Math.max(5, bTokens.length);
  }

  function makeDefinitionLine(question, material) {
    const q = question.trim();
    const topic = extractTopic(q);

    // Try to find a “X — це ...” pattern in material
    const m = material.match(new RegExp(`\\b${escapeReg(topic)}\\b\\s*[—-]\\s*це\\s+([^.!?]{20,160})`, "iu"));
    if (m && m[1]) {
      return `**${capitalize(topic)}** — це ${m[1].trim()}.`;
    }

    // Generic definition framing
    if (q.toLowerCase().includes("що таке") || q.toLowerCase().startsWith("що ")) {
      return `**${capitalize(topic)}** — коротко: це поняття/процес у біології, який пояснюють так:`;
    }
    return `**${capitalize(topic)}**: пояснення простими словами.`;
  }

  function makeExplanation(sentences) {
    // Convert to a structured small paragraph (no copying lots)
    const s = sentences.slice(0, 3).map(x => shorten(x, 190));
    // Add connectors
    if (s.length === 1) return s[0];
    if (s.length === 2) return `${s[0]} ${s[1]}`;
    return `${s[0]} ${s[1]} ${s[2]}`;
  }

  function makeExampleOrFact(question, material) {
    const q = question.toLowerCase();
    const topic = extractTopic(question);

    // If asks functions
    if (q.includes("функц") || q.includes("для чого") || q.includes("навіщо")) {
      return `Запам’ятай: головна роль **${capitalize(topic)}** — пов’язана з роботою клітини/організму (енергія, інформація ДНК, обмін речовин або регуляція — залежно від теми).`;
    }

    // Try to pull one short “fact-like” clause
    const fact = (splitToSentences(material).find(s =>
      s.toLowerCase().includes("приклад") || s.toLowerCase().includes("наприклад")
    ) || "").replace(/^(приклад|наприклад)\s*[:—-]?\s*/i, "");

    if (fact && fact.length > 25) {
      return `Приклад: ${shorten(fact, 170)}`;
    }

    // Default helpful line
    return `Якщо хочеш — скажи, чи тобі потрібно **визначення**, **етапи/механізм**, чи **порівняння** з іншими поняттями.`;
  }

  function shorten(s, n) {
    const t = (s || "").trim();
    if (t.length <= n) return t;
    return t.slice(0, n - 1).trim() + "…";
  }

  function cleanOutput(text) {
    // Keep bold **...** as-is, remove junk spaces
    return (text || "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function extractTopic(q) {
    // Very simple: take last “meaningful” word or noun-like token
    const tokens = q
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(t => !STOP.has(t));

    if (!tokens.length) return "тема";
    // If question like "що таке реплікація ДНК" -> take last 2 tokens if "днк" included
    if (tokens.includes("днк") && tokens.length >= 2) {
      const idx = tokens.lastIndexOf("днк");
      const prev = tokens[idx - 1] || "днк";
      return `${prev} ДНК`;
    }
    return tokens[tokens.length - 1];
  }

  function capitalize(s) {
    const t = String(s || "").trim();
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function escapeReg(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const STOP = new Set([
    "що", "таке", "це", "які", "яка", "який", "як", "де", "коли", "чому", "навіщо",
    "про", "у", "в", "на", "та", "і", "або", "але", "для", "з", "до", "від", "по",
    "чи", "не", "є", "бути", "між", "над", "під", "через", "без", "якщо",
    "поясни", "поясніть", "розкажи", "розкажіть"
  ]);

  /***********************
   * Optional API UI: make it silent (no messages)
   ***********************/
  // We keep these listeners harmless if your HTML still has the modal.
  if (apiPill && apiModalOverlay) {
    apiPill.addEventListener("click", () => {
      apiModalOverlay.classList.add("open");
      apiModalOverlay.setAttribute("aria-hidden", "false");
      if (apiKeyInput) apiKeyInput.value = "";
      if (modelInput) modelInput.value = "gpt-4o-mini";
      setTimeout(() => apiKeyInput?.focus(), 0);
    });
  }
  if (apiCancel && apiModalOverlay) apiCancel.addEventListener("click", () => {
    apiModalOverlay.classList.remove("open");
    apiModalOverlay.setAttribute("aria-hidden", "true");
  });
  if (apiClear) apiClear.addEventListener("click", () => {
    // Do nothing user-visible
    try {
      localStorage.removeItem("bioconsult_api_key");
      localStorage.removeItem("bioconsult_model");
    } catch {}
    if (apiState) apiState.textContent = "не налаштовано";
    apiModalOverlay?.classList.remove("open");
    apiModalOverlay?.setAttribute("aria-hidden", "true");
  });
  if (apiSave) apiSave.addEventListener("click", () => {
    // Save silently; still we won't mention it in chat
    try {
      localStorage.setItem("bioconsult_api_key", (apiKeyInput?.value || "").trim());
      localStorage.setItem("bioconsult_model", (modelInput?.value || "gpt-4o-mini").trim());
    } catch {}
    if (apiState) apiState.textContent = "налаштовано";
    apiModalOverlay?.classList.remove("open");
    apiModalOverlay?.setAttribute("aria-hidden", "true");
  });

  /***********************
   * Helpers
   ***********************/
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function autoLoadBaseKBIfNeeded() {
    const docs = KB.getAll();

    const alreadyLoaded = localStorage.getItem(AUTO_KB_FLAG_KEY) === "1";
    const hasFileAlready = docs.some(d => (d.title || "").toLowerCase() === AUTO_KB_TITLE.toLowerCase());

    if (hasFileAlready || alreadyLoaded) return;

    try {
      const res = await fetch(AUTO_KB_PATH, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      if (!text || text.trim().length < 50) return;

      KB.addDoc({ title: AUTO_KB_TITLE, text });
      localStorage.setItem(AUTO_KB_FLAG_KEY, "1");
    } catch {
      // ignore
    }
  }

  /***********************
   * Init
   ***********************/
  async function init() {
    // Make API pill state quiet
    if (apiState) apiState.textContent = "не налаштовано";

    await autoLoadBaseKBIfNeeded();

    renderKB();
    RAG.rebuildIndexFromKB();
    autoResize();
    setStatus("Готово");
  }

  init();
})();
