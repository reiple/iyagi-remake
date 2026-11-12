import { _electron } from "playwright";
import net from "node:net";
import iconv from "iconv-lite";
import assert from "node:assert/strict";
const received = [];
let socket;
const server = net.createServer((s) => {
  socket = s;
  s.write(iconv.encode("\x1b[32m퇴마요새 모의 서버\x1b[0m\r\n명령> ", "cp949"));
  s.on("data", (b) => received.push(iconv.decode(b, "cp949")));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const app = await _electron.launch({
  executablePath: process.env.APP_EXECUTABLE || "node_modules/electron/dist/electron.exe",
  args: [...(process.env.APP_EXECUTABLE ? [] : ["."]), "--user-data-dir=" + process.cwd() + "/.ui-test-profile"],
  env: Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE"),
  ),
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#command");
  await page.waitForTimeout(500);
  await page.fill("#host", "127.0.0.1");
  await page.fill("#port", String(server.address().port));
  await page.click("#connect");
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "연결됨",
  );
  await page.fill("#command", "보기|상태");
  await page.locator("#command").press("Enter");
  await page.waitForTimeout(400);
  assert.ok(received.join("").includes("보기\r\n상태\r\n"));
  await page.fill("#command", "미완성");
  await page.locator("#command").dispatchEvent("compositionstart");
  await page.locator("#command").press("Enter");
  await page.waitForTimeout(100);
  assert.ok(!received.join("").includes("미완성"));
  await page.locator("#command").dispatchEvent("compositionend");
  await page.waitForTimeout(50);
  // One Enter commits the last Korean syllable and sends the completed line.
  await page.fill("#command", "한글입력");
  await page.evaluate(() => {
    const input = document.querySelector("#command");
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", isComposing: true, bubbles: true,
    }));
    input.dispatchEvent(new CompositionEvent("compositionend", { data: "력" }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter", code: "Enter", bubbles: true,
    }));
  });
  await page.waitForTimeout(300);
  assert.equal(received.join("").split("한글입력\r\n").length - 1, 1);
  assert.equal(await page.inputValue("#command"), "");
  await page.check("#secret");
  await page.fill("#command", "비밀값");
  await page.locator("#command").press("Enter");
  await page.waitForTimeout(100);
  await page.uncheck("#secret");
  await page.locator("#command").press("ArrowUp");
  assert.equal(await page.inputValue("#command"), "한글입력");
  await page.click("#disconnect");
  assert.deepEqual(errors, []);
  console.log(
    "UI integration passed: TCP, CP949 commands, macro order, IME composition guard, secret history",
  );
} finally {
  await app.close();
  socket?.destroy();
  server.close();
}
