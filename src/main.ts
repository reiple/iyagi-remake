import { ScriptService } from "./script/service";
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import iconv from "iconv-lite";
import { Connection } from "./core/connection";
import { CommandQueue, expand, TriggerEngine } from "./core/commands";
import { defaults, validateSettings } from "./core/settings";
let win: BrowserWindow;
let settings = defaults();
let configPath = "";
const connection = new Connection();
let triggers = new TriggerEngine();
let active = false;
let log: fs.WriteStream | undefined;
let serverSecret = false;
let manualSecret = false;
const queue = new CommandQueue((text) => {
  try {
    connection.send(text);
  } catch (e) {
    notify("error", String(e));
    throw e;
  }
});
const notify = (type: string, value: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send("event", { type, value });
};
const scripts = new ScriptService({
  workerPath: path.join(__dirname, "script-worker.cjs"),
  canRun: () => connection.connected && !serverSecret && !manualSecret,
  send: (text) => connection.sendScript(text),
  sendByte:byte=>connection.sendScriptByte(byte),
  event: (e) => notify("script", e),
  logEnd: () => {
    log?.end();
    log = undefined;
    notify("log", false);
  },
});
function stop() {
  scripts.stop();
  queue.stop();
  active = false;
  notify("triggers", false);
}
connection.on("status", (s) => {
  if (s !== "연결됨") {
    stop();
    triggers.reset();
  }
  notify("status", s);
});
connection.on("echo", (v) => {
  serverSecret = v;
  if (v) stop();
  notify("secret", v);
});
connection.on("data", (text) => {
  notify("data", text);
  if (!serverSecret && !manualSecret) scripts.feed(text);
  if (!serverSecret && !manualSecret) log?.write(text);
  if (active && !serverSecret && !manualSecret) {
    try {
      for (const command of triggers.feed(text))
        queue.enqueue(expand(command, settings.bindings, settings.delay));
    } catch (e) {
      stop();
      notify("error", String(e));
    }
  }
});
app.whenReady().then(() => {
  configPath = path.join(app.getPath("userData"), "settings.json");
  let warning = "";
  try {
    if (fs.existsSync(configPath))
      settings = validateSettings(
        JSON.parse(fs.readFileSync(configPath, "utf8")),
      );
  } catch {
    warning =
      "설정 파일을 읽지 못해 기본값을 사용합니다. 기존 파일은 보존됩니다.";
  }
  queue.interval = settings.interval;
  triggers = new TriggerEngine(settings.rules);
  win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 850,
    minHeight: 600,
    backgroundColor: "#0b1019",
    title: "이야기 · 퇴마요새",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
    cb(false),
  );
  ipcMain.handle("request", async (event, action, payload) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw Error("허용되지 않은 요청입니다.");
    switch (action) {
      case "script-open": {
        const r = await dialog.showOpenDialog(win, {
          properties: ["openFile"],
          filters: [{ name: "혼잣말 소스", extensions: ["scs", "h", "txt"] }],
        });
        if (r.canceled) return null;
        return scripts.load(r.filePaths[0], payload || "auto");
      }
      case "script-header": {
        const r = await dialog.showOpenDialog(win, {
          properties: ["openDirectory"],
        });
        if (r.canceled) return null;
        return scripts.setHeaderRoot(r.filePaths[0]);
      }
      case "script-compile":
        return scripts.translate(payload);
      case "script-run": {
        queue.stop();
        active = false;
        notify("triggers", false);
        scripts.run(payload);
        return true;
      }
      case "script-pause":
        scripts.pause();
        return true;
      case "script-resume":
        scripts.resume();
        return true;
      case "script-stop":
        scripts.stop();
        return true;
      case "script-answer": {
        if (!payload || !Number.isInteger(payload.id))
          throw Error("잘못된 입력 응답");
        scripts.answer(payload.id, payload.text);
        return true;
      }
      case "script-save": {
        if (typeof payload !== "string" || payload.length > 1024 * 1024)
          throw Error("소스 크기 초과");
        const r = await dialog.showSaveDialog(win, {
          defaultPath: "혼잣말.scs",
          filters: [{ name: "UTF-8 소스", extensions: ["scs"] }],
        });
        if (r.canceled || !r.filePath) return null;
        fs.writeFileSync(r.filePath, payload, "utf8");
        return r.filePath;
      }
      case "load":
        return { settings, warning };
      case "save": {
        const next = validateSettings(payload);
        if (fs.existsSync(configPath))
          fs.copyFileSync(configPath, configPath + ".bak");
        fs.writeFileSync(configPath + ".tmp", JSON.stringify(next, null, 2));
        fs.renameSync(configPath + ".tmp", configPath);
        settings = next;
        queue.interval = settings.interval;
        stop();
        triggers = new TriggerEngine(settings.rules);
        return true;
      }
      case "connect": {
        const s = validateSettings(payload);
        stop();
        manualSecret = false;
        connection.connect(s.host, s.port, s.encoding);
        return true;
      }
      case "disconnect":
        connection.disconnect();
        return true;
      case "send": {
        if (
          !payload ||
          typeof payload.text !== "string" ||
          payload.text.length > 16000 ||
          typeof payload.secret !== "boolean" ||
          /[\r\n\x00]/.test(payload.text)
        )
          throw Error("명령 입력이 올바르지 않습니다.");
        if (!connection.connected) throw Error("먼저 서버에 연결하세요.");
        if (payload.secret || serverSecret) {
          stop();
          connection.send(payload.text);
        } else
          queue.enqueue(
            expand(payload.text, settings.bindings, settings.delay),
          );
        return true;
      }
      case "secret":
        manualSecret = payload === true;
        if (manualSecret) stop();
        return true;
      case "stop":
        stop();
        return true;
      case "triggers":
        if (payload === true && scripts.worker)
          throw Error("혼잣말 실행 중에는 자동반응을 켤 수 없습니다.");
        active =
          payload === true &&
          connection.connected &&
          !serverSecret &&
          !manualSecret;
        triggers.reset();
        notify("triggers", active);
        return active;
      case "resize":
        if (
          Array.isArray(payload) &&
          payload.length === 2 &&
          payload.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000)
        )
          connection.resize(payload[0], payload[1]);
        return true;
      case "fullscreen":
        win.setFullScreen(!win.isFullScreen());
        return true;
      case "aliases": {
        const r = await dialog.showOpenDialog(win, {
          properties: ["openFile"],
          filters: [{ name: "문장 목록", extensions: ["txt"] }],
        });
        if (r.canceled) return [];
        if (fs.statSync(r.filePaths[0]).size > 1024 * 1024)
          throw Error("파일이 너무 큽니다.");
        return iconv
          .decode(fs.readFileSync(r.filePaths[0]), "cp949")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("【"))
          .slice(0, 150);
      }
      case "log": {
        if (log) {
          log.end();
          log = undefined;
          return false;
        }
        const r = await dialog.showSaveDialog(win, {
          defaultPath: "iyagi-session.txt",
        });
        if (r.canceled || !r.filePath) return false;
        log = fs.createWriteStream(r.filePath, {
          flags: "a",
          encoding: "utf8",
        });
        log.on("error", (e) => {
          log = undefined;
          notify("log", false);
          notify("error", e.message);
        });
        return true;
      }
      default:
        throw Error("알 수 없는 요청입니다.");
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.on("closed", () => {
    stop();
    connection.disconnect();
    log?.end();
  });
});
app.on("window-all-closed", () => app.quit());
