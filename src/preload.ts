import { contextBridge, ipcRenderer } from "electron";
const allowed = [
  "script-open",
  "script-header",
  "script-compile",
  "script-run",
  "script-pause",
  "script-resume",
  "script-stop",
  "script-answer",
  "script-save",
  "load",
  "save",
  "connect",
  "disconnect",
  "send",
  "secret",
  "stop",
  "triggers",
  "resize",
  "fullscreen",
  "aliases",
  "log",
];
contextBridge.exposeInMainWorld("mud", {
  request: (action: string, payload?: unknown) => {
    if (!allowed.includes(action))
      return Promise.reject(Error("Invalid action"));
    return ipcRenderer.invoke("request", action, payload);
  },
  subscribe: (callback: (event: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => callback(data);
    ipcRenderer.on("event", listener);
    return () => ipcRenderer.removeListener("event", listener);
  },
});
