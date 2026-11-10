import { parentPort, workerData } from "node:worker_threads";
import { Runtime } from "./runtime";
const port = parentPort!;
let serial = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
const request = (action: string, payload: any) =>
  new Promise<any>((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    port.postMessage({ type: "request", id, action, payload });
  });
const runtime = new Runtime(workerData.program, {
  send: (text) => request("send", text),
  sendByte:byte=>request("byte",byte),
  output: (text) => request("output", text),
  input: (prompt, max) => request("input", { prompt, max }),
  logEnd: () => request("logEnd", ""),
  location: (loc) => port.postMessage({ type: "location", loc }),
});
port.on("message", (m) => {
  if (m.type === "data") runtime.feed(m.text);
  if (m.type === "pause") runtime.pause();
  if (m.type === "resume") runtime.resume();
  if (m.type === "stop") {
    runtime.stop();
    for (const p of pending.values()) p.reject(Error("실행 중지"));
    pending.clear();
  }
  if (m.type === "response") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p?.reject(Error(m.error));
    else p?.resolve(m.value);
  }
});
runtime
  .run()
  .then(() => port.postMessage({ type: "done" }))
  .catch((e) => port.postMessage({ type: "failure", error: e.message }));
