/* ============================
BioConsult — app/main.js (FULL)
Offline without API:
- answers with normal text (no showing notes)
- if notes have nothing -> Wikipedia fallback
- auto-seeds KB from ../data/raw/biology_basics.txt if KB empty
============================ */

(() => {
  "use strict";

  /***********************
   * UI refs
   ***********************/
  const $ = (id) => document.getElementById(id);

  const promptEl = $("prompt");
  const sendBtn  = $("sendBtn");
  const chatLog  = $("chatLog");
  const chips    = $("chips");
  const newChatBtn = $("newChatBtn");
  const statusText = $("statusText");

  const ragToggleBtn = $("ragToggleBtn");
  const apiPill = $("apiPill");
  const apiState = $("apiState");

  const plusBtn = $("plusBtn");
  const plusMenu = $("plusMenu");
  const closePlusMenu = $("closePlusMenu");

  const pmAddImageFile = $("pmAddImageFile");
  const pmAddImageUrl  = $("pmAddImageUrl");
  const pmAddTextFile  = $("pmAddTextFile");
  const pmClearChat    = $("pmClearChat");
  const pmClearKB      = $("pmClearKB");

  const imageInput = $("imageInput");
  const textInput  = $("textInput");

  const imgModalOverlay = $("imgModalOverlay");
  const imgUrlInput = $("imgUrlInput");
  const cancelImgModal = $("cancelImgModal");
  const addUrlBtn = $("addUrlBtn");

  const apiModalOverlay = $("apiModalOverlay");
  const apiKeyInput = $("apiKeyInput");
  const modelInput = $("modelInput");
  const apiCancel = $("apiCancel");
  const apiClear = $("apiClear");
  const apiSave = $("apiSave");

  const kbList = $("kbList");
  const kbCount = $("kbCount");

  let ragEnabled = true;
  let busy = false;

  // attachments for current message
  let pendingImageDataUrl = null; // data:image/... base64 OR url
  let pendingImageLabel = null;

  function setStatus(t){ if(statusText) statusText.textContent = t; }

  function autoResize() {
    if(!promptEl) return;
    promptEl.style.height = "24px";
    promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + "px";
  }

  /***********************
   * Chat render
   ***********************/
  function addMsg(text, who="user", sources=[]) {
    const div = document.createElement('div');
    div.className = `msg ${who}`;
    div.textContent = text;

    // Note: in offline mode we do NOT pass sources, so notes are not shown.
    if (who === "bot" && Array.isArray(sources) && sources.length) {
      const s = document.createElement('div');
      s.className = "sources";
      s.textContent = "Джерела (RAG):";

      sources.forEach(src => {
        const item = document.createElement('div');
        item.className = "src";

        const t = document.createElement('div');
        t.className = "t";
        t.textContent = src.title || "Джерело";

        const sn = document.createElement('div');
        sn.className = "s";
        sn.textContent = src.snippet || "";

        item.appendChild(t);
        item.appendChild(sn);
        s.appendChild(item);
      });

      div.appendChild(s);
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addImagePreviewMessage({ dataUrl, caption, who="user" }){
    const div = document.createElement('div');
    div.className = `msg ${who}`;
    div.textContent = caption || "Зображення додано:";

    const wrap = document.createElement('div');
    wrap.className = "imgwrap";
    const img = document.createElement('img');
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
  function openMenu(){ plusMenu?.classList.add("open"); }
  function closeMenu(){ plusMenu?.classList.remove("open"); }

  /***********************
   * Modals
   ***********************/
  function openImgModal(){
    imgModalOverlay?.classList.add("open");
    imgModalOverlay?.setAttribute("aria-hidden","false");
    if(imgUrlInput) imgUrlInput.value = "";
    setTimeout(() => imgUrlInput?.focus(), 0);
  }
  function closeImgModal(){
    imgModalOverlay?.classList.remove("open");
    imgModalOverlay?.setAttribute("aria-hidden","true");
  }

  function openApiModal(){
    apiModalOverlay?.classList.add("open");
    apiModalOverlay?.setAttribute("aria-hidden","false");
    if(apiKeyInput) apiKeyInput.value = Settings.getApiKey() || "";
    if(modelInput) modelInput.value = Settings.getModel() || "gpt-4o-mini";
    setTimeout(() => apiKeyInput?.focus(), 0);
  }
  function closeApiModal(){
    apiModalOverlay?.classList.remove("open");
    apiModalOverlay?.setAttribute("aria-hidden","true");
  }

  /***********************
   * Settings storage
   ***********************/
  const Settings = {
    kApiKey: "bioconsult_api_key",
    kModel: "bioconsult_model",
    getApiKey(){ return localStorage.getItem(this.kApiKey) || ""; },
    setApiKey(v){ localStorage.setItem(this.kApiKey, v || ""); },
    getModel(){ return localStorage.getItem(this.kModel) || ""; },
    setModel(v){ localStorage.setItem(this.kModel, v || ""); },
    clear(){
      localStorage.removeItem(this.kApiKey);
      localStorage.removeItem(this.kModel);
    }
  };

  function updateApiState(){
    const hasKey = !!Settings.getApiKey();
    if(apiState) apiState.textContent = hasKey ? "налаштовано" : "не налаштовано";
  }

  /***********************
   * KB storage (docs)
   ***********************/
  const KB = {
    key: "bioconsult_kb_docs",
    getAll(){
      try { return JSON.parse(localStorage.getItem(this.key) || "[]"); }
      catch { return []; }
    },
    setAll(docs){
      localStorage.setItem(this.key, JSON.stringify(docs || []));
    },
    addDoc(doc){
      const docs = this.getAll();
      docs.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        title: doc.title || "doc.txt",
        text: doc.text || "",
        createdAt: Date.now()
      });
      this.setAll(docs);
    },
    remove(id){
      const docs = this.getAll().filter(d => d.id !== id);
      this.setAll(docs);
    },
    clear(){ this.setAll([]); }
  };

  function renderKB(){
    const docs = KB.getAll();
    if(kbCount) kbCount.textContent = `${docs.length} файлів`;
    if(!kbList) return;
    kbList.innerHTML = "";

    if(docs.length === 0){
      const empty = document.createElement("div");
      empty.className = "sb-item";
      empty.textContent = "Додай .txt/.md через “+” або зачекай автозавантаження";
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
        if(!confirm(`Видалити "${d.title}" з бази?`)) return;
        KB.remove(d.id);
        RAG.rebuildIndexFromKB();
        renderKB();
        addMsg(`✅ Видалено з бази: ${d.title}`, "bot");
      });

      kbList.appendChild(row);
    });
  }

  /***********************
   * RAG in browser (TF-IDF-ish)
   ***********************/
  const RAG = (() => {
    let chunks = [];     // {title, text, id, vec}
    let stats = null;    // {df, N}

    function tokenize(text) {
      return (text || "")
        .toLowerCase()
        .replace(/[^ -~ -￿\s]+/g, " ")
        .replace(/[^À-￿\w\s]+/g, " ")
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
      const { df, N } = stats || { df:{}, N:1 };
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

  /***********************
   * Wikipedia fallback (no API keys)
   ***********************/
  const Wiki = (() => {
    const cache = new Map();

    function detectLang(q){
      const s = (q || "").toLowerCase();
      if (/[іїєґ]/.test(s)) return "uk";
      if (/[ёыэъ]/.test(s)) return "ru";
      return "uk";
    }

    async function searchTitles(query, lang="uk", limit=3){
      const url =
        `https://${lang}.wikipedia.org/w/api.php` +
        `?action=opensearch&search=${encodeURIComponent(query)}` +
        `&limit=${limit}&namespace=0&format=json&origin=*`;
      const res = await fetch(url, { cache: "no-store" });
      if(!res.ok) throw new Error("Wiki search HTTP " + res.status);
      const data = await res.json(); // [q, [titles], [descs], [urls]]
      return {
        titles: Array.isArray(data?.[1]) ? data[1] : [],
        urls:   Array.isArray(data?.[3]) ? data[3] : []
      };
    }

    async function summaryByTitle(title, lang="uk"){
      const key = `${lang}::${title}`;
      if(cache.has(key)) return cache.get(key);

      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(url, { cache: "no-store" });
      if(!res.ok) throw new Error("Wiki summary HTTP " + res.status);
      const data = await res.json();
      const out = {
        title: data?.title || title,
        extract: data?.extract || "",
        page: data?.content_urls?.desktop?.page || ""
      };
      cache.set(key, out);
      return out;
    }

    async function answer(query){
      const lang = detectLang(query);
      const found = await searchTitles(query, lang, 3);
      if(!found.titles.length) return null;

      const bestTitle = found.titles[0];
      const sum = await summaryByTitle(bestTitle, lang);
      if(!sum.extract) return null;

      const text =
        `${sum.extract}\n\n` +
        (sum.page ? `Джерело: Wikipedia — ${sum.page}` : `Джерело: Wikipedia (${lang})`);

      return text;
    }

    return { answer };
  })();

  /***********************
   * OFFLINE Answer from contexts
   * - does NOT show notes
   ***********************/
  function offlineAnswerFromContexts(question, contexts) {
    if (!contexts || !contexts.length) return null;

    const qWords = (question || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4);

    const pick = (txt, max = 5) => {
      const clean = (txt || "")
        .replace(/\s+/g, " ")
        .replace(/[*_`#>-]+/g, "")
        .trim();

      const sents = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);

      const scored = sents.map(s => {
        const sl = s.toLowerCase();
        let score = 0;
        for (const w of qWords) if (sl.includes(w)) score += 1;
        if (sl.includes("це ") || sl.includes("— це") || sl.includes("означає")) score += 1;
        return { s, score };
      }).sort((a,b)=>b.score-a.score);

      const out = [];
      for (const it of scored) {
        if (out.length >= max) break;
        if (!it.s || it.s.length < 35) continue;
        out.push(it.s.length > 210 ? it.s.slice(0, 210) + "…" : it.s);
      }
      return out;
    };

    const ideas = [];
    contexts.slice(0,3).forEach(c => pick(c.text, 3).forEach(x => ideas.push(x)));

    const uniq = [];
    const seen = new Set();
    for (const t of ideas) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(t);
    }

    const p1 = uniq.slice(0,3).join(" ");
    const p2 = uniq.slice(3,6).join(" ");
    let answer = "";
    answer += p1 ? p1 : "";
    if (p2) answer += "\n\n" + p2;

    if(!answer.trim()) return null;

    answer += "\n\n(Офлайн режим: використовую твою базу знань і формую короткий виклад без показу конспектів.)";
    return answer;
  }

  /***********************
   * Seed KB from repo if empty
   * app/index.html -> ../data/raw/biology_basics.txt
   ***********************/
  async function seedKBFromRepoIfEmpty() {
    const docs = KB.getAll();
    if (docs.length > 0) return;

    const url = "../data/raw/biology_basics.txt";
    try {
      setStatus("Завантажую твої записи…");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Не знайдено ${url} (HTTP ${res.status})`);
      const text = await res.text();

      KB.addDoc({ title: "biology_basics.txt", text });
      RAG.rebuildIndexFromKB();
      renderKB();

      addMsg("✅ Я підключив твої записи (biology_basics.txt) у базу знань. Можеш ставити питання.", "bot");
      setStatus("Готово");
    } catch (e) {
      addMsg(
        "⚠️ Не зміг автоматично завантажити твої записи з репо.\n" +
        "Перевір шлях: data/raw/biology_basics.txt\n" +
        "Помилка: " + (e?.message || String(e)),
        "bot"
      );
      setStatus("Потрібні записи");
    }
  }

  /***********************
   * LLM call (OpenAI Responses API) if key exists
   ***********************/
  const LLM = (() => {
    function buildSystem(){
      return [
        "Ти — BioConsult, консультант з біології.",
        "Відповідай українською, просто і точно.",
        "Якщо є RAG-контекст — використовуй його в першу чергу.",
        "Якщо даних недостатньо — скажи, що саме потрібно уточнити.",
        "Додай короткий блок 'Джерела' з позначками [#1], [#2] (тільки якщо використовував контекст)."
      ].join("\n");
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

    async function answer({ apiKey, model, userText, contexts, image }){
      const system = buildSystem();
      const ctx = buildContextBlock(contexts);

      const userParts = [{ type:"text", text: userText }];

      if (image?.url) {
        userParts.push({ type:"text", text: `\n(Додано зображення: ${image.label || "image"})\n` });
        userParts.push({ type:"image_url", image_url: { url: image.url } });
      }

      if (ctx) {
        userParts.push({ type:"text", text: `\n\nКонтекст (RAG):\n${ctx}` });
      }

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

    return { answer };
  })();

  /***********************
   * Helpers
   ***********************/
  function fileToDataURL(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /***********************
   * Send
   ***********************/
  async function send(){
    const text = (promptEl.value || "").trim();
    if(!text || busy) return;

    busy = true;
    setStatus("Пишу відповідь…");
    sendBtn.disabled = true;

    addMsg(text, "user");
    promptEl.value = "";
    autoResize();

    try{
      const apiKey = Settings.getApiKey();
      const model = Settings.getModel() || "gpt-4o-mini";

      // === OFFLINE MODE (NO API KEY) ===
      if(!apiKey){
        const contexts = ragEnabled ? RAG.retrieveTopK(text, 4) : [];
        const fromNotes = offlineAnswerFromContexts(text, contexts);

        if(fromNotes){
          addMsg(fromNotes, "bot");
          setStatus("Офлайн: відповів з твоїх матеріалів");
          return;
        }

        // If notes didn't match -> Wikipedia
        setStatus("Офлайн: шукаю у Wikipedia…");
        const fromWiki = await Wiki.answer(text);

        if(fromWiki){
          addMsg(fromWiki, "bot");
          setStatus("Офлайн: Wikipedia");
          return;
        }

        addMsg(
          "Я не знайшов у твоїх матеріалах достатньо інформації під це питання і не зміг підтягнути довідку.\n" +
          "Спробуй уточнити запит або додай конспект у базу знань.",
          "bot"
        );
        setStatus("Офлайн: мало даних");
        return;
      }

      // === ONLINE MODE (WITH API KEY) ===
      const contexts = ragEnabled ? RAG.retrieveTopK(text, 4) : [];
      const { answer, sources } = await LLM.answer({
        apiKey,
        model,
        userText: text,
        contexts,
        image: pendingImageDataUrl ? { url: pendingImageDataUrl, label: pendingImageLabel } : null
      });

      addMsg(answer || "Немає відповіді", "bot", sources);

      // reset attachments after send
      pendingImageDataUrl = null;
      pendingImageLabel = null;

      setStatus("Готово");
    }catch(err){
      addMsg("❌ Помилка: " + (err?.message || String(err)), "bot");
      setStatus("Помилка");
    }finally{
      busy = false;
      sendBtn.disabled = false;
    }
  }

  /***********************
   * Wire events
   ***********************/
  function wire(){
    promptEl?.addEventListener("input", autoResize);

    plusBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      plusMenu.classList.contains("open") ? closeMenu() : openMenu();
    });

    closePlusMenu?.addEventListener("click", closeMenu);

    document.addEventListener("click", (e) => {
      if (plusMenu && !plusMenu.contains(e.target) && e.target !== plusBtn) closeMenu();
    });

    pmAddImageFile?.addEventListener("click", () => { closeMenu(); imageInput.click(); });
    pmAddTextFile?.addEventListener("click", () => { closeMenu(); textInput.click(); });
    pmAddImageUrl?.addEventListener("click", () => { closeMenu(); openImgModal(); });

    pmClearChat?.addEventListener("click", () => {
      closeMenu();
      chatLog.innerHTML = "";
      addMsg("Чат очищено ✅", "bot");
      setStatus("Готово");
    });

    pmClearKB?.addEventListener("click", () => {
      closeMenu();
      if (!confirm("Очистити базу знань (всі матеріали)?")) return;
      KB.clear();
      RAG.rebuildIndexFromKB();
      renderKB();
      addMsg("Базу знань очищено ✅", "bot");
      setStatus("Готово");
    });

    cancelImgModal?.addEventListener("click", closeImgModal);
    imgModalOverlay?.addEventListener("click", (e) => { if(e.target === imgModalOverlay) closeImgModal(); });

    addUrlBtn?.addEventListener("click", async () => {
      const url = (imgUrlInput.value || "").trim();
      if(!url) return;
      pendingImageDataUrl = url;
      pendingImageLabel = "Зображення (URL)";
      addMsg("✅ Додано зображення з URL. Тепер задай питання про нього.", "bot");
      closeImgModal();
    });

    apiPill?.addEventListener("click", openApiModal);
    apiCancel?.addEventListener("click", closeApiModal);

    apiClear?.addEventListener("click", () => {
      Settings.clear();
      updateApiState();
      addMsg("API налаштування очищено.", "bot");
      closeApiModal();
    });

    apiSave?.addEventListener("click", () => {
      const key = (apiKeyInput.value || "").trim();
      const model = (modelInput.value || "").trim() || "gpt-4o-mini";
      Settings.setApiKey(key);
      Settings.setModel(model);
      updateApiState();
      addMsg("✅ API налаштування збережено. Можна спілкуватись.", "bot");
      closeApiModal();
    });

    ragToggleBtn?.addEventListener("click", () => {
      ragEnabled = !ragEnabled;
      ragToggleBtn.textContent = ragEnabled ? "🧠 RAG: увімкнено" : "🧠 RAG: вимкнено";
      ragToggleBtn.setAttribute("aria-pressed", String(ragEnabled));
      setStatus(ragEnabled ? "RAG увімкнено" : "RAG вимкнено");
    });

    imageInput?.addEventListener("change", async () => {
      const file = imageInput.files?.[0];
      if(!file) return;

      if(!file.type.startsWith("image/")){
        addMsg("❌ Це не зображення.", "bot");
        imageInput.value = "";
        return;
      }

      const dataUrl = await fileToDataURL(file);
      pendingImageDataUrl = dataUrl;
      pendingImageLabel = file.name;

      addImagePreviewMessage({ dataUrl, caption:`Зображення додано: ${file.name}`, who:"user" });
      addMsg("Тепер можеш написати питання про це зображення.", "bot");

      imageInput.value = "";
    });

    textInput?.addEventListener("change", async () => {
      const file = textInput.files?.[0];
      if(!file) return;
      const text = await file.text();

      KB.addDoc({ title: file.name, text });
      RAG.rebuildIndexFromKB();
      renderKB();

      addMsg(`✅ Додано матеріал до бази знань: ${file.name}`, "bot");
      setStatus("Базу оновлено");

      textInput.value = "";
    });

    chips?.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if(!chip) return;
      promptEl.value = chip.textContent.replace(/\s+/g,' ').trim() + ": ";
      promptEl.focus();
      autoResize();
    });

    newChatBtn?.addEventListener("click", () => {
      chatLog.innerHTML = "";
      promptEl.value = "";
      autoResize();
      promptEl.focus();
      setStatus("Готово");
      closeMenu();
    });

    sendBtn?.addEventListener("click", send);
    promptEl?.addEventListener("keydown", (e) => {
      if(e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        send();
      }
    });
  }

  /***********************
   * Init
   ***********************/
  async function init(){
    wire();
    updateApiState();
    renderKB();
    RAG.rebuildIndexFromKB();
    autoResize();
    setStatus("Готово");
    await seedKBFromRepoIfEmpty();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
