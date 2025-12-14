export const KB = {
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
