"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  characters: [],
  busy: new Set(),
  scriptId: null,
  textId: null,
  deleteId: null,
  polling: false,
  reading: false,
  answerId: null,
  textRevision: -1,
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
  state.textId = id;
  state.textRevision = -1;
  state.answerId = null;
  $("text-title").textContent = getCharacter(id).name + " · 텍스트 화면";
  $("terminal-output").textContent = "출력을 불러오는 중입니다…";
  $("command-input").value = "";
  $("command-secret").checked = false;
  $("command-input").type = "text";
  $("text-error").textContent = "";
  $("answer-form").hidden = true;
  $("login-help").hidden = true;
  $("text-dialog").showModal();
  void readOutput();
}
$("text-dialog").addEventListener("close", () => {
  state.textId = null;
  state.answerId = null;
  $("command-input").value = "";
  $("answer-text").value = "";
  $("terminal-output").textContent = "";
});
function plain(text) {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n");
}
async function readOutput() {
  const id = state.textId;
  if (!id || state.reading) return;
  state.reading = true;
  try {
    const result = await api(route(id, "output"), undefined, "GET");
    if (state.textId !== id || !$("text-dialog").open) return;
    const c = result.character;
    $("text-status").textContent =
      `${c.connectionStatus} · ${loginNames[c.loginState]} · 혼잣말 ${scriptNames[c.scriptState] || c.scriptState}`;
    $("login-help").hidden = !c.connected || c.loginState === "ready";
    $("confirm-login").disabled = c.secret;
    $("command-send").disabled = !c.connected;
    if (state.textRevision !== c.revision) {
      const output = $("terminal-output");
      output.textContent = plain(result.text) || "아직 수신한 출력이 없습니다.";
      state.textRevision = c.revision;
      if ($("auto-scroll").checked) output.scrollTop = output.scrollHeight;
    }
    if (c.secret) {
      $("command-secret").checked = true;
      $("command-input").type = "password";
    }
    $("answer-form").hidden = !c.pendingInput;
    if (c.pendingInput) {
      $("answer-prompt").textContent = c.pendingInput.prompt;
      $("answer-text").maxLength = c.pendingInput.max;
      if (state.answerId !== c.pendingInput.id) {
        $("answer-text").value = "";
        state.answerId = c.pendingInput.id;
      }
    } else state.answerId = null;
  } catch (error) {
    if (state.textId === id) $("text-error").textContent = error.message;
  } finally {
    state.reading = false;
  }
}
$("command-secret").onchange = () => {
  $("command-input").type = $("command-secret").checked ? "password" : "text";
  $("command-input").focus();
};
$("command-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.textId || event.isComposing) return;
  const id = state.textId;
  const text = $("command-input").value;
  const secret = $("command-secret").checked;
  $("text-error").textContent = "";
  $("command-send").disabled = true;
  try {
    await api(route(id, "send"), { text, secret });
    if (state.textId === id) {
      $("command-input").value = "";
      $("command-input").focus();
    }
    await readOutput();
  } catch (error) {
    if (state.textId === id) $("text-error").textContent = error.message;
  } finally {
    $("command-send").disabled = !getCharacter(state.textId)?.connected;
  }
};
$("command-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.isComposing || event.keyCode === 229))
    event.preventDefault();
});
$("answer-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!state.textId || !state.answerId) return;
  const id = state.textId,
    inputId = state.answerId,
    submit = event.submitter;
  submit.disabled = true;
  try {
    await api(route(id, "answer"), {
      id: inputId,
      text: $("answer-text").value,
    });
    if (state.textId === id) $("answer-text").value = "";
    await readOutput();
  } catch (error) {
    if (state.textId === id) $("text-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
$("confirm-login").onclick = async () => {
  if (!state.textId) return;
  try {
    await api(route(state.textId, "confirm-login"), {});
    await readOutput();
    await refresh();
  } catch (error) {
    $("text-error").textContent = error.message;
  }
};
void refresh();
setInterval(() => {
  void refresh();
}, 1500);
setInterval(() => {
  void readOutput();
}, 700);
