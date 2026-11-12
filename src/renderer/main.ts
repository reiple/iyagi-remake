import { setupScriptUi } from "./script-ui";
import { setupProfiles } from "./profiles-ui";
import "./style.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Settings } from "../core/settings";
import type { Profile } from "../core/profiles";
declare global {
  interface Window {
    mud: {
      request: (action: string, payload?: unknown) => Promise<any>;
      subscribe: (cb: (e: { type: string; value: any }) => void) => () => void;
    };
  }
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const message = (s: string) => {
  $("message").textContent = s;
};
async function request(a: string, p?: unknown) {
  try {
    return await window.mud.request(a, p);
  } catch (e) {
    message(String(e));
    throw e;
  }
}
let settings: Settings;
let connected = false;
let connecting = false;
let remoteSecret = false;
let composing = false;
let compositionEnter = false;
let history: string[] = [];
let position = 0;
let draft = "";
let edit: Settings;
const term = new Terminal({
  fontFamily: "Consolas, monospace",
  fontSize: 17,
  theme: {
    background: "#1c1e1c",
    foreground: "#e3e5dc",
    cursor: "#d1e6a6",
    selectionBackground: "#445334",
  },
  scrollback: 10000,
  convertEol: true,
  disableStdin: true,
  allowProposedApi: false,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open($("terminal"));
term.attachCustomKeyEventHandler((e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
    navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    return false;
  }
  return true;
});
const resize = () => {
  fit.fit();
  void request("resize", [term.cols, term.rows]).catch(() => {});
};
new ResizeObserver(resize).observe($("terminal"));
const secret = () => remoteSecret || input("secret").checked;
function updateSecret() {
  input("command").type = secret() ? "password" : "text";
  if (secret()) input("command").removeAttribute("list");
  else input("command").setAttribute("list", "suggestions");
}
function apply() {
  term.options.fontFamily = settings.font;
  term.options.fontSize = settings.fontSize;
  const area = document.querySelector<HTMLElement>(".command-area")!;
  const terminal = $("terminal");
  if (settings.commandPosition === "top") terminal.before(area);
  else terminal.after(area);
  area.classList.toggle("above-terminal", settings.commandPosition === "top");
  resize();
  $("buttons").replaceChildren(
    ...settings.buttons.map((b, i) => {
      const el = document.createElement("button");
      el.textContent = b.label;
      el.title = b.command || "환경 설정에서 명령을 지정하세요";
      el.onclick = () => {
        if (b.command) void send(b.command).catch(() => {});
        else message(`${i + 1}번 버튼의 명령을 설정하세요.`);
      };
      return el;
    }),
  );
  $("suggestions").replaceChildren(
    ...settings.aliases.map((s) => {
      const o = document.createElement("option");
      o.value = s;
      return o;
    }),
  );
}
async function send(text: string) {
  const hidden = secret();
  await request("send", { text, secret: hidden });
  if (!hidden && text) {
    if (history.at(-1) !== text) history.push(text);
    history = history.slice(-200);
    position = history.length;
  }
  message(hidden ? "비밀 입력을 전송했습니다." : "명령을 전송했습니다.");
}
$("command-form").onsubmit = (e) => {
  e.preventDefault();
  if (composing || compositionEnter) return;
  const value = input("command").value;
  void send(value)
    .then(() => {
      if (input("command").value === value) input("command").value = "";
    })
    .catch(() => {});
};
input("command").addEventListener("compositionstart", () => (composing = true));
input("command").addEventListener("compositionend", () => {
  composing = false;
});
input("command").onkeydown = (e) => {
  if (e.key === "Enter") {
    if (e.isComposing || composing) {
      // Let the IME commit the final syllable before sending on keyup.
      compositionEnter = true;
      return;
    }
    e.preventDefault();
    if (!e.repeat && !compositionEnter)
      $<HTMLFormElement>("command-form").requestSubmit();
    return;
  }
  if (e.isComposing || composing) return;
  if (!secret() && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    if (position === history.length) draft = input("command").value;
    position = Math.max(
      0,
      Math.min(history.length, position + (e.key === "ArrowUp" ? -1 : 1)),
    );
    input("command").value =
      position === history.length ? draft : history[position];
  }
};
input("command").onkeyup = (e) => {
  if (e.key !== "Enter" || !compositionEnter) return;
  compositionEnter = false;
  if (!composing) $<HTMLFormElement>("command-form").requestSubmit();
};
input("command").addEventListener("blur", () => {
  compositionEnter = false;
});
input("secret").onchange = () => {
  updateSecret();
  void request("secret", input("secret").checked).catch(() => {});
};
function displayProfile(profile: Profile) {
  $("profile-name").textContent = profile.name;
  $("workspace-name").textContent = profile.name;
  $("address").textContent = `${profile.host}:${profile.port}`;
}
const openProfiles = setupProfiles(
  (profiles) => window.mud.request("save-profiles", profiles),
  (profile) => { if (!connected && !connecting) displayProfile(profile); },
);
$("stop").onclick = () => {
  void request("stop").catch(() => {});
  message("전송 대기열과 자동반응을 중지했습니다.");
};
input("triggers").onchange = () =>
  void request("triggers", input("triggers").checked).catch(() => {});
$("log").onclick = () =>
  void request("log")
    .then((v) => {
      $("log").textContent = v ? "● 갈무리 종료" : "갈무리 시작";
    })
    .catch(() => {});
window.mud.subscribe((e) => {
  if (e.type === "open-profiles") openProfiles(e.value);
  if (e.type === "profile-connected") {
    displayProfile(e.value);
    input("secret").checked = false;
    updateSecret();
  }
  if (e.type === "data") term.write(e.value);
  if (e.type === "error") message(e.value);
  if (e.type === "secret") {
    remoteSecret = e.value;
    updateSecret();
  }
  if (e.type === "triggers") input("triggers").checked = e.value;
  if (e.type === "log") $("log").textContent = "갈무리 시작";
  if (e.type === "status") {
    connected = e.value === "연결됨";
    connecting = e.value === "접속 중";
    $("status").textContent = e.value;
    $("dot").classList.toggle("connected", connected);
    if (e.value === "연결 종료") {
      history = [];
      position = 0;
      input("command").value = "";
    }
    if (connected) {
      term.reset();
      input("command").focus();
      resize();
    }
    if (e.value.startsWith("오류")) message(e.value);
  }
});
const dialog = $<HTMLDialogElement>("dialog");
function field(value: string, cls = "") {
  const el = document.createElement("input");
  el.value = value;
  el.className = cls;
  return el;
}
function keyName(e: KeyboardEvent) {
  return [
    e.ctrlKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
    e.code,
  ]
    .filter(Boolean)
    .join("+");
}
function openSettings() {
  edit = structuredClone(settings);
  ["font", "fontSize", "interval", "delay", "commandPosition"].forEach(
    (k) => (input(k).value = String((edit as any)[k])),
  );
  input("alias-text").value = edit.aliases.join("\n");
  $("settings-message").textContent = "";
  $("macro-rows").replaceChildren();
  for (const group of ["A", "S"])
    for (let i = 1; i <= 10; i++) {
      const key = group + i;
      const row = document.createElement("div");
      row.className = "edit-row";
      const label = document.createElement("span");
      label.textContent = key;
      const shortcut = field(edit.shortcuts[key] || "", "key");
      shortcut.placeholder = (group === "A" ? "Alt" : "Shift") + "+F" + i;
      shortcut.onkeydown = (e) => {
        e.preventDefault();
        shortcut.value = e.key === "Backspace" ? "" : keyName(e);
        edit.shortcuts[key] = shortcut.value;
      };
      const command = field(edit.bindings[key] || "");
      command.placeholder = "전송할 명령";
      command.oninput = () => (edit.bindings[key] = command.value);
      row.append(label, shortcut, command);
      $("macro-rows").append(row);
    }
  $("button-rows").replaceChildren(
    ...edit.buttons.map((b) => {
      const row = document.createElement("div");
      row.className = "edit-row";
      const label = field(b.label, "key");
      const command = field(b.command);
      label.oninput = () => (b.label = label.value);
      command.oninput = () => (b.command = command.value);
      row.append(label, command);
      return row;
    }),
  );
  renderRules();
  dialog.showModal();
}
function renderRules() {
  $("rule-rows").replaceChildren(
    ...edit.rules.map((r, i) => {
      const row = document.createElement("div");
      row.className = "edit-row";
      const enabled = field("");
      enabled.type = "checkbox";
      enabled.checked = r.enabled;
      enabled.onchange = () => (r.enabled = enabled.checked);
      const match = field(r.match);
      match.placeholder = "감지할 문구";
      match.oninput = () => (r.match = match.value);
      const command = field(r.command);
      command.placeholder = "보낼 명령";
      command.oninput = () => (r.command = command.value);
      const cooldown = field(String(r.cooldown), "small");
      cooldown.type = "number";
      cooldown.min = "500";
      cooldown.title = "재실행 대기 (ms)";
      cooldown.oninput = () => (r.cooldown = Number(cooldown.value));
      const remove = document.createElement("button");
      remove.textContent = "삭제";
      remove.onclick = () => {
        edit.rules.splice(i, 1);
        renderRules();
      };
      row.append(enabled, match, command, cooldown, remove);
      return row;
    }),
  );
}
$("settings").onclick = openSettings;
$("close").onclick = () => dialog.close();
$("add-rule").onclick = () => {
  edit.rules.push({ match: "", command: "", enabled: true, cooldown: 2000 });
  renderRules();
};
$("import").onclick = () =>
  void request("aliases")
    .then((a) => {
      if (a.length) input("alias-text").value = a.join("\n");
    })
    .catch(() => {});
$("save").onclick = async () => {
  edit.commandPosition = input("commandPosition").value as Settings["commandPosition"];
  edit.font = input("font").value;
  edit.fontSize = Number(input("fontSize").value);
  edit.interval = Number(input("interval").value);
  edit.delay = Number(input("delay").value);
  edit.aliases = input("alias-text")
    .value.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await request("save", edit);
    settings = edit;
    apply();
    dialog.close();
    message("설정을 저장했습니다. 자동반응은 필요할 때 다시 켜세요.");
  } catch (e) {
    $("settings-message").textContent = String(e);
  }
};
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll<HTMLElement>(".panel")
        .forEach((p) => (p.hidden = p.id !== b.dataset.tab));
      document
        .querySelectorAll("[data-tab]")
        .forEach((t) => t.classList.toggle("selected", t === b));
    }),
);
window.addEventListener("keydown", (e) => {
  if (e.isComposing || composing) return;
  if (e.key === "F11") {
    e.preventDefault();
    void request("fullscreen").catch(() => {});
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "F8" && !e.altKey && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    openSettings();
    return;
  }
  if (!settings || secret()) return;
  for (const group of ["A", "S"])
    for (let i = 1; i <= 10; i++) {
      const key = group + i;
      const combo =
        settings.shortcuts[key] || (group === "A" ? "Alt" : "Shift") + "+F" + i;
      if (keyName(e) === combo) {
        e.preventDefault();
        if (!e.repeat && settings.bindings[key])
          void send("$" + key).catch(() => {});
        return;
      }
    }
});
void request("load")
  .then((r) => {
    settings = r.settings;
    displayProfile(r.profile);
    $("app-version").textContent = `버전 v${r.version}`;
    document.title = `이야기 MUD · v${r.version}`;
    apply();
    if (r.warning) message(r.warning);
    term.writeln("\x1b[38;2;108;219;193m  이야기 · MUD\x1b[0m");
    term.writeln("\r\n  퇴마요새로 이어지는 새로운 창\r\n");
    term.writeln("  접속 → 서버 연결에서 프로필을 선택하세요.");
    term.writeln("  명령은 채팅 입력창에, 자주 쓰는 명령은 단축버튼에.\r\n");
    term.writeln("\x1b[90m  연결 전 안내 화면입니다.\x1b[0m");
  })
  .catch(() => {});

setupScriptUi();

// Keep selection and interactive controls usable while making background clicks ready for chat.
let pointerStart: { x: number; y: number } | undefined;
document.addEventListener("pointerdown", (e) => {
  pointerStart = e.button === 0 ? { x: e.clientX, y: e.clientY } : undefined;
}, true);
document.addEventListener("click", (e) => {
  const start = pointerStart;
  pointerStart = undefined;
  if (!start || e.button !== 0 || e.detail > 1 || composing || document.querySelector("dialog[open]")) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  const inTerminal = !!target.closest("#terminal");
  if (!inTerminal && target.closest('input, textarea, select, button, a, label, [contenteditable], [role="button"]')) return;
  if (window.getSelection()?.toString() || (inTerminal && term.hasSelection())) return;
  input("command").focus({ preventScroll: true });
});
