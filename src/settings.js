export const Settings = {
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
