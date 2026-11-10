// Gives the FreeTV web app a few Mac-only abilities (recording, downloads, folders).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ftvDesktop", {
  config: () => ipcRenderer.invoke("ftv:config"),
  chooseFolder: () => ipcRenderer.invoke("ftv:chooseFolder"),
  record: (o) => ipcRenderer.invoke("ftv:record", o),
  download: (o) => ipcRenderer.invoke("ftv:download", o),
  stop: (id) => ipcRenderer.invoke("ftv:stop", id),
  resume: (id) => ipcRenderer.invoke("ftv:resume", id),
  remove: (id, deleteFile) => ipcRenderer.invoke("ftv:remove", { id, deleteFile }),
  show: (file) => ipcRenderer.invoke("ftv:show", file),
  open: (file) => ipcRenderer.invoke("ftv:open", file),
  onJobs: (cb) => ipcRenderer.on("ftv:jobs", (_, jobs) => cb(jobs)),
});
