import { Settings } from "../src/settings.js";
import { KB } from "../src/kb.js";
import { RAG } from "../src/rag.js";
import { LLM } from "../src/llm.js";

/***********************
 * UI refs
 ***********************/
const promptEl = document.getElementById('prompt');
const sendBtn  = document.getElementById('sendBtn');
const chatLog  = document.getElementById('chatLog');
const chips    = document.getElementById('chips');
const newChatBtn = document.getElementById('newChatBtn');
const statusText = document.getElementById('statusText');

const ragToggleBtn = document.getElementById('ragToggleBtn');
const apiPill = document.getElementById('apiPill');
const apiState = document.getElementById('apiState');

const plusBtn = document.getElementById('plusBtn');
const plusMenu = document.getElementById('plusMenu');
const closePlusMenu = document.getElementById('closePlusMenu');

const pmAddImageFile = document.getElementById('pmAddImageFile');
const pmAddImageUrl  = document.getElementById('pmAddImageUrl');
const pmAddTextFile  = document.getElementById('pmAddTextFile');
const pmClearChat    = document.getElementById('pmClearChat');
const pmClearKB      = document.getElementById('pmClearKB');

const imageInput = document.getElementById('imageInput');
const textInput  = document.getElementById('textInput');

const imgModalOverlay = document.getElementById('imgModalOverlay');
const imgUrlInput = document.getElementById('imgUrlInput');
const cancelImgModal = document.getElementById('cancelImgModal');
const addUrlBtn = document.getElementById('addUrlBtn');

const apiModalOverlay = document.getElementById('apiModalOverlay');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const apiCancel = document.getElementById('apiCancel');
const apiClear = document.getElementById('apiClear');
const apiSave = document.getElementById('apiSave');

const kbList = document.getElementById('kbList');
const kbCount = document.getElementById('kbCount');

let ragEnabled = true;
let busy = false;

// attachments for current message
let pendingImageDataUrl = null;
let pendingImageLabel = null;

function setStatus(t){ statusText.textContent = t; }

function autoResize() {
  promptEl.style.height = "24px";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + "px";
}
promptEl.addEventListener('input', autoResize);

/***********************
 * Chat render
 ***********************/
function addMsg(text, who="user", sources=[]) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;

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
function openMenu(){ plusMenu.classList.add("open"); }
function closeMenu(){ plusMenu.classList.remove("open"); }

plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  plusMenu.classList.contains("open") ? closeMenu() : openMenu();
});
closePlusMenu.addEventListener('click', closeMenu);

document.addEventListener('click', (e) => {
  if (!plusMenu.contains(e.target) && e.target !== plusBtn) closeMenu();
});

pmAddImageFile.addEventListener('click', () => { closeMenu(); imageInput.click(); });
pmAddTextFile.addEventListener('click', () => { closeMenu(); textInput.click(); });
pmAddImageUrl.addEventListener('click', () => { closeMenu(); openImgModal(); });

pmClearChat.addEventListener('click', () => {
  closeMenu();
  chatLog.innerHTML = "";
  addMsg("Чат очищено ✅", "bot");
  setStatus("Готово");
});

pmClearKB.addEventListener('click', () => {
  closeMenu();
  if (!confirm("Очистити базу знань (всі матеріали)?")) return;
  KB.clear();
  RAG.rebuildIndexFromKB();
  renderKB();
  addMsg("Базу знань очищено ✅", "bot");
  setStatus("Готово");
});

/***********************
 * Image modal
 ***********************/
function openImgModal(){
  imgModalOverlay.classList.add("open");
  imgModalOverlay.setAttribute("aria-hidden","false");
  imgUrlInput.value = "";
  setTimeout(() => imgUrlInput.focus(), 0);
}
function closeImgModal(){
  imgModalOverlay.classList.remove("open");
  imgModalOverlay.setAttribute("aria-hidden","true");
}
cancelImgModal.addEventListener('click', closeImgModal);
imgModalOverlay.addEventListener('click', (e) => { if(e.target === imgModalOverlay) closeImgModal(); });

addUrlBtn.addEventListener('click', async () => {
  const url = (imgUrlInput.value || "").trim();
  if(!url) return;

  pendingImageDataUrl = url;
  pendingImageLabel = "Зображення (URL)";
  addMsg("✅ Додано зображення з URL. Тепер задай питання про нього.", "bot");
  closeImgModal();
});

/***********************
 * API modal
 ***********************/
function openApiModal(){
  apiModalOverlay.classList.add("open");
  apiModalOverlay.setAttribute("aria-hidden","false");
  apiKeyInput.value = Settings.getApiKey() || "";
  modelInput.value = Settings.getModel() || "gpt-4o-mini";
  setTimeout(() => apiKeyInput.focus(), 0);
}
function closeApiModal(){
  apiModalOverlay.classList.remove("open");
  apiModalOverlay.setAttribute("aria-hidden","true");
}
apiPill.addEventListener('click', openApiModal);
apiCancel.addEventListener('click', closeApiModal);

apiClear.addEventListener('click', () => {
  Settings.clear();
  updateApiState();
  addMsg("API налаштування очищено.", "bot");
  closeApiModal();
});

apiSave.addEventListener('click', () => {
  const key = (apiKeyInput.value || "").trim();
  const model = (modelInput.value || "").trim() || "gpt-4o-mini";
  Settings.setApiKey(key);
  Settings.setModel(model);
  updateApiState();
  addMsg("✅ API налаштування збережено. Можна спілкуватись.", "bot");
  closeApiModal();
});

/***********************
 * RAG toggle
 ***********************/
ragToggleBtn.addEventListener('click', () => {
  ragEnabled = !ragEnabled;
  ragToggleBtn.textContent = ragEnabled ? "🧠 RAG: увімкнено" : "🧠 RAG: вимкнено";
  ragToggleBtn.setAttribute("aria-pressed", String(ragEnabled));
  setStatus(ragEnabled ? "RAG увімкнено" : "RAG вимкнено");
});

/***********************
 * Inputs
 ***********************/
imageInput.addEventListener('change', async () => {
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

textInput.addEventListener('change', async () => {
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

/***********************
 * Chips & new chat
 ***********************/
chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if(!chip) return;
  promptEl.value = chip.textContent.replace(/\s+/g,' ').trim() + ": ";
  promptEl.focus();
  autoResize();
});

newChatBtn.addEventListener('click', () => {
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
sendBtn.addEventListener('click', send);
promptEl.addEventListener('keydown', (e) => {
  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    send();
  }
});

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

    if(!apiKey){
      addMsg("⚠️ API не налаштовано. Натисни “⚙ API” і встав ключ.", "bot");
      setStatus("Потрібен API key");
      return;
    }

    const contexts = ragEnabled ? RAG.retrieveTopK(text, 4) : [];
    const { answer, sources } = await LLM.answer({
      apiKey,
      model,
      userText: text,
      contexts,
      image: pendingImageDataUrl ? { url: pendingImageDataUrl, label: pendingImageLabel } : null
    });

    addMsg(answer || "Немає відповіді", "bot", sources);

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
 * KB sidebar render
 ***********************/
function renderKB(){
  const docs = KB.getAll();
  kbCount.textContent = `${docs.length} файлів`;
  kbList.innerHTML = "";

  if(docs.length === 0){
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
 * Helpers
 ***********************/
function updateApiState(){
  const hasKey = !!Settings.getApiKey();
  apiState.textContent = hasKey ? "налаштовано" : "не налаштовано";
}

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/***********************
 * Init
 ***********************/
function init(){
  updateApiState();
  renderKB();
  RAG.rebuildIndexFromKB();
  autoResize();
  setStatus("Готово");
}
init();
