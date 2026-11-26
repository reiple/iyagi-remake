import { renderTerminalOutput } from "./terminal-output.mjs";

const $ = (id) => document.getElementById(id);
const historyLimit = 20;
const state = {
  characters: [],
  busy: new Set(),
  scriptId: null,
  textPanel: null,
  commandHistories: new Map(),
  deleteId: null,
  polling: false,
};
const scriptNames = {
  idle: "준비",
  stopped: "중지",
  running: "실행 중",
  paused: "일시정지",
  completed: "실행 완료",
  error: "오류",
};
const loginNames = {
  offline: "연결 안 됨",
  "waiting-name": "이름 입력 중",
  "waiting-password": "암호 입력 중",
  verifying: "로그인 확인 중",
  "waiting-return": "[리턴을 누르세요] 안내 대기",
  ready: "로그인 완료",
  manual: "로그인 확인 필요",
  failed: "로그인 실패",
};
let toastTimer;
function toast(message, error = false) {
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 5000);
}
async function api(route, body, method = "POST") {
  const response = await fetch(route, {
    method,
    headers: { "Content-Type": "application/json", "X-Iyagi-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "요청 처리에 실패했습니다.");
  return result;
}
const route = (id, action) =>
  `/api/characters/${id}${action ? "/" + action : ""}`;
const getCharacter = (id) => state.characters.find((c) => c.id === id);

function openAdd() {
  $("add-form").reset();
  $("add-error").textContent = "";
  $("add-dialog").showModal();
}
$("add-open").onclick = openAdd;
$("empty-add").onclick = openAdd;
document.querySelectorAll("[data-close]").forEach((button) => {
  button.onclick = () => $(button.dataset.close).close();
});
$("add-dialog").addEventListener("close", () => {
  $("character-password").value = "";
});
$("add-form").onsubmit = async (event) => {
  event.preventDefault();
  $("add-submit").disabled = true;
  $("add-error").textContent = "";
  try {
    await api("/api/characters", {
      name: $("character-name").value,
      password: $("character-password").value,
    });
    $("add-dialog").close();
    toast("캐릭터를 추가했습니다.");
    await refresh();
  } catch (error) {
    $("add-error").textContent = error.message;
  } finally {
    $("add-submit").disabled = false;
  }
};

function createRow(character) {
  const row = document.createElement("article");
  row.className = "character-row";
  row.dataset.id = character.id;
  row.innerHTML =
    '<div class="character-name"><span class="avatar" aria-hidden="true"></span><div><strong></strong><small>CHARACTER</small></div></div><div class="connection-cell"><span class="state-badge"><i class="dot"></i><span></span></span><small class="connection-detail"></small></div><div class="script-cell"><span class="script-file"></span><div class="script-bottom"><span class="script-state"></span><button class="text-link" data-action="source">파일 지정</button></div><div class="row-error" hidden></div></div><div class="row-actions"><button class="button secondary" data-action="connect"></button><button class="button run" data-action="run"></button><button class="button ghost" data-action="text">텍스트 화면 <span aria-hidden="true">↗</span></button><button class="icon-button" data-action="delete" title="캐릭터 삭제" aria-label="캐릭터 삭제">×</button></div>';
  row.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button && !button.disabled)
      void action(character.id, button.dataset.action);
  });
  return row;
}
function render() {
  const characters = state.characters;
  $("count-total").textContent = characters.length;
  $("list-count").textContent = characters.length;
  $("count-connected").textContent = characters.filter(
    (c) => c.connected,
  ).length;
  $("count-running").textContent = characters.filter((c) =>
    ["running", "paused"].includes(c.scriptState),
  ).length;
  $("count-waiting").textContent = characters.filter(
    (c) => c.pendingInput,
  ).length;
  $("empty-state").hidden = characters.length !== 0;
  const list = $("character-list");
  for (const row of list.children)
    if (!characters.some((c) => c.id === row.dataset.id)) row.remove();
  for (const c of characters) {
    let row = [...list.children].find((r) => r.dataset.id === c.id);
    if (!row) {
      row = createRow(c);
      list.append(row);
    }
    const running = ["running", "paused"].includes(c.scriptState);
    const busy = state.busy.has(c.id);
    row.querySelector(".avatar").textContent = Array.from(c.name)[0];
    row.querySelector(".character-name strong").textContent = c.name;
    const badge = row.querySelector(".state-badge");
    badge.className =
      "state-badge" +
      (c.connected && c.loginState === "ready"
        ? " active"
        : c.connected || c.connecting
          ? " waiting"
          : "");
    badge.querySelector(".dot").className =
      "dot" + (c.connected ? " green" : c.connecting ? " amber" : "");
    badge.querySelector("span").textContent = c.connected
      ? c.loginState === "ready"
        ? "접속 중"
        : "로그인 중"
      : c.connecting
        ? "접속 중…"
        : "미접속";
    row.querySelector(".connection-detail").textContent = c.connected
      ? loginNames[c.loginState]
      : c.connectionStatus.startsWith("오류")
        ? "접속 오류 · 텍스트 화면 확인"
        : "퇴마요새";
    const file = row.querySelector(".script-file");
    file.textContent = c.fileName || "지정된 파일 없음";
    file.title = c.fileName;
    file.classList.toggle("unset", !c.fileName);
    const scriptState = row.querySelector(".script-state");
    scriptState.textContent = c.pendingInput
      ? "● 입력 대기"
      : scriptNames[c.scriptState] || c.scriptState;
    scriptState.className =
      "script-state" +
      (c.pendingInput ? " waiting" : running ? " running" : "");
    const error = row.querySelector(".row-error");
    error.hidden = !c.error;
    error.textContent = c.error;
    const connect = row.querySelector("[data-action=connect]");
    connect.textContent =
      c.connected || c.connecting ? "접속 종료" : "퇴마요새 접속";
    connect.disabled = busy;
    const run = row.querySelector("[data-action=run]");
    run.textContent = running ? "■ 혼잣말 중지" : "▶ 혼잣말 실행";
    run.className = "button " + (running ? "stop" : "run");
    run.disabled =
      busy ||
      (!running &&
        c.hasScript &&
        (!c.connected || c.loginState !== "ready" || c.secret));
    row.querySelector("[data-action=source]").disabled = busy || running;
    const text = row.querySelector("[data-action=text]");
    text.classList.toggle("text-attention", !!c.pendingInput);
    text.setAttribute(
      "aria-label",
      c.name + " 텍스트 화면" + (c.pendingInput ? " · 입력 대기" : ""),
    );
    row.querySelector("[data-action=delete]").disabled =
      busy || c.connected || c.connecting || running;
  }
}
async function refresh() {
  if (state.polling) return;
  state.polling = true;
  try {
    const result = await api("/api/characters", undefined, "GET");
    state.characters = result.characters;
    render();
    $("server-state").textContent = "백그라운드 서버 연결됨";
    $("server-dot").className = "status-dot online";
    $("loading-state").hidden = true;
  } catch {
    $("server-state").textContent = "서버 연결 끊김 · 재시도 중";
    $("server-dot").className = "status-dot offline";
    $("loading-state").hidden = state.characters.length > 0;
    $("loading-state").textContent =
      "서버에 연결할 수 없습니다. 컨테이너 실행 상태를 확인하세요.";
  } finally {
    state.polling = false;
  }
}
async function action(id, name) {
  const c = getCharacter(id);
  if (!c) return;
  if (name === "source" || (name === "run" && !c.hasScript)) {
    state.scriptId = id;
    $("script-form").reset();
    $("script-error").textContent = "";
    $("script-character").textContent = c.name;
    $("script-dialog").showModal();
    return;
  }
  if (name === "text") {
    openText(id);
    return;
  }
  if (name === "delete") {
    state.deleteId = id;
    $("delete-description").textContent =
      `${c.name} 캐릭터와 저장된 암호·혼잣말 파일을 삭제합니다.`;
    $("delete-error").textContent = "";
    $("delete-dialog").showModal();
    return;
  }
  if (state.busy.has(id)) return;
  state.busy.add(id);
  render();
  try {
    const command =
      name === "connect"
        ? c.connected || c.connecting
          ? "disconnect"
          : "connect"
        : ["running", "paused"].includes(c.scriptState)
          ? "stop"
          : "run";
    await api(route(id, command), {});
    await refresh();
    if (command === "run") toast(c.name + " · 혼잣말을 시작했습니다.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy.delete(id);
    render();
  }
}
async function fileData(file) {
  if (file.size > 2 * 1024 * 1024)
    throw Error("파일 하나의 크기는 최대 2MB입니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { name: file.name, data: btoa(text) };
}
$("script-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.scriptId) return;
  $("script-submit").disabled = true;
  $("script-submit").textContent = "번역 중…";
  $("script-error").textContent = "";
  try {
    const file = $("script-file").files[0],
      headers = [...$("header-files").files];
    if (!file) throw Error("혼잣말 소스를 선택하세요.");
    if (
      headers.length > 50 ||
      [file, ...headers].reduce((n, f) => n + f.size, 0) > 4 * 1024 * 1024
    )
      throw Error("헤더는 최대 50개이며 전체 파일 크기는 최대 4MB입니다.");
    const result = await api(route(state.scriptId, "script"), {
      ...(await fileData(file)),
      headers: await Promise.all(headers.map(fileData)),
    });
    $("script-dialog").close();
    toast(
      "번역하고 저장했습니다." +
        (result.diagnostics.warnings.length
          ? " 경고: " + result.diagnostics.warnings.join(" / ")
          : ""),
    );
    await refresh();
  } catch (error) {
    $("script-error").textContent = error.message;
  } finally {
    $("script-submit").disabled = false;
    $("script-submit").textContent = "번역하고 저장";
  }
};
$("delete-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.deleteId) return;
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await api(route(state.deleteId), undefined, "DELETE");
    state.commandHistories.delete(state.deleteId);
    $("delete-dialog").close();
    toast("캐릭터를 삭제했습니다.");
    await refresh();
  } catch (error) {
    $("delete-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};

function openText(id) {
  const character = getCharacter(id);
  const panel = {
    id,
    character,
    revision: -1,
    reading: false,
    answerId: null,
    reconnectArmed: false,
    reconnectPending: false,
    manualSecret: false,
    recalled: undefined,
    inputRevision: 0,
    composing: false,
    compositionEnter: false,
  };
  state.textPanel = panel;
  $("text-title").textContent = character.name + " · 텍스트 화면";
  $("terminal-output").textContent = "출력을 불러오는 중입니다…";
  $("command-input").value = "";
  $("text-error").textContent = "";
  $("answer-form").hidden = true;
  $("login-help").hidden = true;
  renderCommandControls(panel);
  $("text-dialog").showModal();
  $("command-input").focus();
  void readOutput();
}
$("text-dialog").addEventListener("close", () => {
  state.textPanel = null;
  $("command-input").value = "";
  $("answer-text").value = "";
  $("terminal-output").textContent = "";
});
function renderCommandControls(panel) {
  const { character: c } = panel;
  const secret = $("command-secret");
  secret.checked = panel.manualSecret || c.secret;
  secret.disabled = c.secret;
  const input = $("command-input");
  const inputType = secret.checked ? "password" : "text";
  if (input.type !== inputType) input.type = inputType;
  $("command-send").disabled = !c.connected;
  let hint = "이 창을 닫아도 접속과 혼잣말 실행은 유지됩니다.";
  if (c.connected && c.loginState === "ready" && !secret.checked) {
    hint = `↑·↓ 최근 명령 · ${hint}`;
  } else if (panel.reconnectPending || c.connecting) {
    hint = "퇴마요새에 접속하는 중입니다.";
  } else if (!c.connected && c.connectionGeneration > 0) {
    hint = panel.reconnectArmed
      ? `${c.name} 캐릭터로 재접속하려면 Enter를 한 번 더 누르세요.`
      : "Enter를 두 번 누르면 현재 캐릭터로 다시 접속합니다.";
  }
  const label = $("command-hint");
  if (label.textContent !== hint) label.textContent = hint;
}
function commandHistory(character) {
  const { id, connectionGeneration } = character;
  let history = state.commandHistories.get(id);
  if (!history || history.generation !== connectionGeneration) {
    history = {
      generation: connectionGeneration,
      entries: [],
      pending: undefined,
      queue: Promise.resolve(),
    };
    state.commandHistories.set(id, history);
  }
  return history;
}
async function readOutput() {
  const panel = state.textPanel;
  if (!panel || panel.reading) return;
  panel.reading = true;
  try {
    const result = await api(route(panel.id, "output"), undefined, "GET");
    if (state.textPanel !== panel || !$("text-dialog").open) return;
    const c = result.character;
    const previous = panel.character;
    if (
      previous.connectionGeneration !== c.connectionGeneration ||
      (previous.connected && !c.connected)
    ) {
      state.commandHistories.delete(panel.id);
      panel.reconnectArmed = false;
      panel.recalled = undefined;
      panel.manualSecret = false;
      panel.inputRevision++;
      $("command-input").value = "";
    }
    if (c.secret) panel.manualSecret = true;
    if (c.secret && !previous.secret && panel.recalled) {
      panel.recalled = undefined;
      $("command-input").value = "";
    }
    panel.character = c;
    renderCommandControls(panel);
    $("text-status").textContent =
      `${c.connectionStatus} · ${loginNames[c.loginState]} · 혼잣말 ${scriptNames[c.scriptState] || c.scriptState}`;
    $("login-help").hidden = !c.connected || c.loginState === "ready";
    $("confirm-login").disabled = c.secret;
    if (panel.revision !== c.revision) {
      const output = $("terminal-output");
      if (!renderTerminalOutput(output, result.text))
        output.textContent = "아직 수신한 출력이 없습니다.";
      panel.revision = c.revision;
      if ($("auto-scroll").checked) output.scrollTop = output.scrollHeight;
    }
    $("answer-form").hidden = !c.pendingInput;
    if (c.pendingInput) {
      $("answer-prompt").textContent = c.pendingInput.prompt;
      $("answer-text").maxLength = c.pendingInput.max;
      if (panel.answerId !== c.pendingInput.id) {
        $("answer-text").value = "";
        panel.answerId = c.pendingInput.id;
      }
    } else panel.answerId = null;
  } catch (error) {
    if (state.textPanel === panel) $("text-error").textContent = error.message;
  } finally {
    panel.reading = false;
  }
}
$("command-secret").onchange = () => {
  const panel = state.textPanel;
  if (!panel) return;
  panel.manualSecret = $("command-secret").checked;
  panel.recalled = undefined;
  panel.inputRevision++;
  if (!panel.manualSecret) $("command-input").value = "";
  renderCommandControls(panel);
  $("command-input").focus();
};
$("command-input").oninput = () => {
  const panel = state.textPanel;
  if (!panel) return;
  panel.inputRevision++;
  panel.recalled = undefined;
  if (panel.reconnectArmed) {
    panel.reconnectArmed = false;
    renderCommandControls(panel);
  }
};
$("command-form").onsubmit = (event) => {
  event.preventDefault();
  const panel = state.textPanel;
  if (!panel?.character.connected || panel.composing || panel.compositionEnter)
    return;
  const input = $("command-input");
  const text = input.value;
  const secret = $("command-secret").checked;
  const history = commandHistory(panel.character);
  const source = panel.recalled;
  const entry =
    !secret && text && panel.character.loginState === "ready"
      ? { text, accepted: false }
      : undefined;
  if (entry) history.pending = entry;
  panel.recalled = undefined;
  const revision = ++panel.inputRevision;
  input.value = "";
  $("text-error").textContent = "";
  history.queue = history.queue.then(async () => {
    try {
      if (source && !source.accepted) return;
      const { recordable } = await api(route(panel.id, "send"), {
        text,
        secret,
        connectionGeneration: history.generation,
      });
      if (entry && recordable) {
        entry.accepted = true;
        const newest = history.entries.at(-1);
        if (newest?.text === text) {
          if (state.textPanel?.recalled === entry)
            state.textPanel.recalled = newest;
        } else {
          history.entries.push(entry);
          if (history.entries.length > historyLimit) history.entries.shift();
        }
      }
      if (state.textPanel === panel) void readOutput();
    } catch (error) {
      if (state.textPanel === panel) {
        $("text-error").textContent = error.message;
        if (
          !source &&
          panel.inputRevision === revision &&
          (!secret || $("command-secret").checked)
        )
          input.value = text;
      }
    } finally {
      if (history.pending === entry) history.pending = undefined;
      if (entry && !entry.accepted && state.textPanel?.recalled === entry) {
        state.textPanel.recalled = undefined;
        input.value = "";
      }
    }
  });
};
async function reconnect(panel) {
  const c = panel.character;
  if (!c.connectionGeneration || c.connecting || panel.reconnectPending) return;
  if (!panel.reconnectArmed) {
    panel.reconnectArmed = true;
    renderCommandControls(panel);
    return;
  }
  panel.reconnectArmed = false;
  panel.reconnectPending = true;
  $("text-error").textContent = "";
  renderCommandControls(panel);
  try {
    await api(route(panel.id, "connect"), {});
    if (state.textPanel === panel) await readOutput();
    void refresh();
  } catch (error) {
    if (state.textPanel === panel) $("text-error").textContent = error.message;
  } finally {
    panel.reconnectPending = false;
    if (state.textPanel === panel) renderCommandControls(panel);
  }
}
$("command-input").addEventListener("keydown", (event) => {
  const panel = state.textPanel;
  if (!panel) return;
  const composing =
    panel.composing || event.isComposing || event.keyCode === 229;
  if (event.key === "Enter") {
    if (composing) {
      panel.compositionEnter = true;
      return;
    }
    event.preventDefault();
    if (panel.compositionEnter || event.repeat) return;
    if (panel.character.connected) $("command-form").requestSubmit();
    else void reconnect(panel);
    return;
  }
  if (
    composing ||
    !panel.character.connected ||
    $("command-secret").checked ||
    (event.key !== "ArrowUp" && event.key !== "ArrowDown")
  )
    return;
  event.preventDefault();
  const { entries, pending } = commandHistory(panel.character);
  const choices =
    pending && pending.text !== entries.at(-1)?.text
      ? [...entries, pending].slice(-historyLimit)
      : entries;
  if (!choices.length || (!panel.recalled && event.key === "ArrowDown")) return;
  const current = panel.recalled
    ? choices.indexOf(panel.recalled)
    : choices.length;
  const next = Math.max(0, current + (event.key === "ArrowUp" ? -1 : 1));
  panel.recalled = choices[next];
  panel.inputRevision++;
  $("command-input").value = panel.recalled?.text ?? "";
});
$("command-input").addEventListener("compositionstart", () => {
  if (state.textPanel) state.textPanel.composing = true;
});
$("command-input").addEventListener("compositionend", () => {
  if (state.textPanel) state.textPanel.composing = false;
});
$("command-input").addEventListener("keyup", (event) => {
  const panel = state.textPanel;
  if (!panel?.compositionEnter || event.key !== "Enter") return;
  panel.compositionEnter = false;
  if (!panel.composing && panel.character.connected)
    $("command-form").requestSubmit();
});
$("command-input").addEventListener("blur", () => {
  if (!state.textPanel) return;
  state.textPanel.composing = false;
  state.textPanel.compositionEnter = false;
});
$("terminal-output").addEventListener("keydown", (event) => {
  const panel = state.textPanel;
  if (
    !panel ||
    panel.character.connected ||
    event.key !== "Enter" ||
    event.isComposing
  )
    return;
  event.preventDefault();
  if (!event.repeat) void reconnect(panel);
});
$("answer-form").onsubmit = async (event) => {
  event.preventDefault();
  const panel = state.textPanel;
  if (!panel?.answerId) return;
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await api(route(panel.id, "answer"), {
      id: panel.answerId,
      text: $("answer-text").value,
    });
    if (state.textPanel === panel) {
      $("answer-text").value = "";
      await readOutput();
    }
  } catch (error) {
    if (state.textPanel === panel) $("text-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
$("confirm-login").onclick = async () => {
  const panel = state.textPanel;
  if (!panel) return;
  try {
    await api(route(panel.id, "confirm-login"), {});
    if (state.textPanel === panel) await readOutput();
    await refresh();
  } catch (error) {
    if (state.textPanel === panel) $("text-error").textContent = error.message;
  }
};
void refresh();
setInterval(() => {
  void refresh();
}, 1500);
setInterval(() => {
  void readOutput();
}, 700);
