import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import iconv from "iconv-lite";
import { _electron } from "playwright";
import { connectLocal } from "./menu-test-helpers.mjs";

const received = [];
let socket;
const server = net.createServer((connection) => {
  socket = connection;
  socket.on("data", (bytes) => {
    const text = iconv.decode(bytes, "cp949");
    received.push(text);
    if (text.includes("시작")) {
      setTimeout(() => socket.write(iconv.encode("혼이 쓰러졌다", "cp949")), 40);
    }
  });
});
let app;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  app = await _electron.launch({
    executablePath: process.env.APP_EXECUTABLE || "node_modules/electron/dist/electron.exe",
    args: [
      ...(process.env.APP_EXECUTABLE ? [] : ["."]),
      "--user-data-dir=" + path.resolve(".script-ui-profile"),
    ],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE")),
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const editorDialog = page.locator("#script-dialog");
  const runningFile = page.locator("#script-running-file");
  const run = page.locator("#script-run");
  const waitForBadge = (label) =>
    page.waitForFunction((label) => document.querySelector("#script-badge").textContent === label, label);

  await page.locator("#app-version").filter({ hasText: "버전 v" }).waitFor();
  await page.click("#script-open-panel");
  await page.fill("#script-editor", '여기부터(){글월 a;strcat(a,"시작");찾을글("혼이`쓰러졌다");보내기(a+"|");맴돌이(찾은글번호()==0){지연(1);}정수보내기(찾은글번호());보내기("완료|");}');
  await page.click("#script-compile");
  await run.click();
  await page.locator("#script-diagnostics").filter({ hasText: "연결 후 비밀 입력을 끈 상태에서 실행하세요." }).waitFor();
  assert.equal(await editorDialog.isVisible(), true, "Rejected runs leave the editor open");
  assert.equal(await runningFile.isVisible(), false);
  await page.click("#script-close");

  await connectLocal(app, page, server.address().port);
  await page.waitForFunction(() => document.querySelector("#status").textContent === "연결됨");
  await page.click("#script-open-panel");
  await run.click();
  await waitForBadge("실행 완료");
  assert.equal(await editorDialog.isVisible(), false, "Successful runs close the editor");
  assert.equal(received.join(""), "시작\r\n1완료\r\n");

  await page.click("#script-open-panel");
  await page.fill("#script-editor", '여기부터(){글월 a;창문글월받기(0,0,"이름",a,20);보내기(a+"|");}');
  await page.click("#script-compile");
  await run.click();
  await page.locator("#script-input-dialog[open]").waitFor();
  assert.equal(await editorDialog.isVisible(), false, "A script prompt leaves the editor closed");
  await page.fill("#script-input-value", "테스트");
  await page.click("#script-input-form button[type=submit]");
  await waitForBadge("실행 완료");
  assert.ok(received.join("").includes("테스트\r\n"));

  const fixtureDir = fs.mkdtempSync(path.resolve(".script-ui-profile", "running-"));
  const file = path.join(fixtureDir, "반복 테스트.scs");
  fs.writeFileSync(file, '여기부터(){맴돌이(1){보내기("반복|");지연(1);}}');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.click("#script-open-panel");
  await page.click("#script-import");
  await page.locator("#script-file").filter({ hasText: "반복 테스트.scs" }).waitFor();
  await page.click("#script-compile");
  await run.click();
  await editorDialog.waitFor({ state: "hidden", timeout: 5000 });
  await runningFile.filter({ hasText: "반복 테스트.scs" }).waitFor();
  await waitForBadge("실행 중");
  await page.click("#script-open-panel");
  await page.click("#script-pause");
  await waitForBadge("일시정지");
  assert.equal(await runningFile.textContent(), "반복 테스트.scs");
  await page.waitForTimeout(40);
  const count = received.length;
  await page.waitForTimeout(100);
  assert.equal(received.length, count);
  await page.click("#script-resume");
  await page.waitForTimeout(100);
  assert.ok(received.length > count);
  await page.click("#script-stop");
  await runningFile.waitFor({ state: "hidden" });
  await page.waitForTimeout(50);
  const stopped = received.length;
  await page.waitForTimeout(100);
  assert.equal(received.length, stopped);
  await page.screenshot({ path: process.env.SCRIPT_SCREENSHOT || "docs/monologue-preview.png" });

  await page.fill("#script-editor", "여기부터(){잘못된함수();}");
  assert.equal(await run.isDisabled(), true);
  await page.click("#script-compile");
  await page.locator("#script-diagnostics").filter({ hasText: "정의되지 않은 함수" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Script UI passed: compile, run, dialog dismissal, CP949, pattern events, reference input, pause/resume/stop, invalidation and error display");
} finally {
  await app?.close();
  socket?.destroy();
  server.close();
}
