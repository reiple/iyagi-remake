export function setupScriptUi() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>("script-dialog");
  const editor = $<HTMLTextAreaElement>("script-editor");
  const diagnostics = $("script-diagnostics");
  let compiled = false;
  let running = false;
  let paused = false;
  let inputId = 0;
  let busy = false;
  const inputDialog = $<HTMLDialogElement>("script-input-dialog");
  editor.value =
    '#포함 <I.H>\n\n여기부터()\n{\n    보내기("보기|");\n    지연(100);\n    글월쓰기("혼잣말 실행을 마쳤습니다.");\n}\n';
  const refresh = () => {
    $<HTMLButtonElement>("script-run").disabled = !compiled || running || busy;
    $<HTMLButtonElement>("script-pause").disabled = !running || paused;
    $<HTMLButtonElement>("script-resume").disabled = !running || !paused;
    for (const id of [
      "script-import",
      "script-header",
      "script-compile",
      "script-save",
    ])
      $<HTMLButtonElement>(id).disabled = busy;
  };
  const log = (text: string) => {
    diagnostics.textContent = (
      (diagnostics.textContent || "") +
      "\n" +
      text
    ).slice(-12000);
    diagnostics.scrollTop = diagnostics.scrollHeight;
  };
  const ask = async (action: string, payload?: unknown) => {
    try {
      return await window.mud.request(action, payload);
    } catch (e) {
      log(String(e));
      throw e;
    }
  };
  const wrap = (fn: () => Promise<void>) => () => {
    if (busy) return;
    busy = true;
    refresh();
    void fn()
      .catch(() => {})
      .finally(() => {
        busy = false;
        refresh();
      });
  };
  $("script-open-panel").onclick = () => dialog.showModal();
  $("script-close").onclick = () => dialog.close();
  editor.oninput = () => {
    compiled = false;
    if (running) void ask("script-stop").catch(() => {});
    $("script-state").textContent = "편집됨 · 재번역 필요";
    refresh();
  };
  $("script-import").onclick = wrap(async () => {
    const result = await ask(
      "script-open",
      $<HTMLSelectElement>("script-encoding").value,
    );
    if (!result) return;
    editor.value = result.text;
    compiled = false;
    $("script-file").textContent = result.file + " · " + result.format;
    diagnostics.textContent =
      "소스를 가져왔습니다. 번역하여 포함 파일과 경고를 확인하세요.";
  });
  $("script-header").onclick = wrap(async () => {
    const root = await ask("script-header");
    if (root) {
      compiled = false;
      $("script-root").textContent = "추가 헤더 폴더: " + root;
    }
  });
  $("script-save").onclick = wrap(async () => {
    const result = await ask("script-save", editor.value);
    if (result) log("UTF-8 소스 저장: " + result);
  });
  $("script-compile").onclick = wrap(async () => {
    compiled = false;
    diagnostics.textContent = "번역 중…";
    const result = await ask("script-compile", editor.value);
    compiled = true;
    diagnostics.textContent = `번역 성공 · 함수 ${result.functions}개 / 구문 ${result.nodes}개\n\n포함 파일\n${result.includes.join("\n")}\n\n${result.warnings.join("\n")}`;
    $("script-state").textContent = "번역 완료";
  });
  $("script-run").onclick = wrap(async () => {
    await ask("script-run", editor.value);
  });
  $("script-pause").onclick = () => void ask("script-pause").catch(() => {});
  $("script-resume").onclick = () => void ask("script-resume").catch(() => {});
  $("script-stop").onclick = () => void ask("script-stop").catch(() => {});
  $("script-input-form").onsubmit = (e) => {
    e.preventDefault();
    void ask("script-answer", {
      id: inputId,
      text: $<HTMLInputElement>("script-input-value").value,
    })
      .then(() => inputDialog.close())
      .catch(() => {});
  };
  $("script-input-cancel").onclick = () =>
    void ask("script-stop").catch(() => {});
  inputDialog.oncancel = () => void ask("script-stop").catch(() => {});
  window.mud.subscribe(({ type, value }) => {
    if (type !== "script") return;
    const m = value;
    if (m.type === "state") {
      running = ["running", "paused"].includes(m.state);
      paused = m.state === "paused";
      const names: Record<string, string> = {
        running: "실행 중",
        paused: "일시정지",
        stopped: "중지",
        completed: "실행 완료",
        error: "오류",
        idle: "준비",
      };
      $("script-state").textContent = names[m.state] || m.state;
      $("script-badge").textContent = names[m.state] || m.state;
      if (!running && inputDialog.open) inputDialog.close();
      refresh();
    }
    if (m.type === "failure") log(m.error);
    if (m.type === "output") log(m.text);
    if (m.type === "location")
      $("script-state").textContent =
        (paused ? "일시정지" : "실행 중") +
        " · " +
        m.loc.file.split(/[\\/]/).at(-1) +
        ":" +
        m.loc.line;
    if (m.type === "input") {
      inputId = m.id;
      $("script-input-prompt").textContent = m.prompt;
      const value = $<HTMLInputElement>("script-input-value");
      value.value = "";
      value.maxLength = m.max;
      if (!inputDialog.open) inputDialog.showModal();
      value.focus();
    }
  });
  refresh();
}
