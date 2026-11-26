import { _electron } from "playwright";
import net from "node:net";
import iconv from "iconv-lite";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { clickMenu, connectLocal } from "./menu-test-helpers.mjs";
const received = [];
const receivedBytes = [];
let socket;
let connections = 0;
const server = net.createServer((s) => {
  connections++;
  socket = s;
  s.write(iconv.encode("\x1b[32m퇴마요새 모의 서버\x1b[0m\r\n명령> ", "cp949"));
  s.on("data", (bytes) => {
    received.push(iconv.decode(bytes, "cp949"));
    receivedBytes.push(bytes);
  });
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
  await connectLocal(app, page, server.address().port);
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

  await test("chat remembers only 20 entries and down from the newest clears the input", async () => {
    await page.evaluate(async () => {
      const { settings } = await window.mud.request("load");
      await window.mud.request("save", { ...settings, interval: 50 });
    });
    const command = page.locator("#command");
    for (let i = 1; i <= 21; i++) {
      await command.fill(`기록 ${i}`);
      await command.press("Enter");
      await page.waitForFunction(() => document.querySelector("#command").value === "");
    }
    for (let i = 0; i < 100 && !received.join("").includes("기록 21\r\n"); i++) await delay(25);
    assert.ok(received.join("").includes("기록 21\r\n"));
    await command.fill("초안");
    await command.press("ArrowUp");
    assert.equal(await command.inputValue(), "기록 21");
    await command.press("ArrowDown");
    const afterNewest = await command.inputValue();
    for (let i = 0; i < 21; i++) await command.press("ArrowUp");
    assert.deepEqual([afterNewest, await command.inputValue()], ["", "기록 2"]);
  });

  await test("rapid up and enter repeats the most recent sent command", async () => {
    const command = page.locator("#command");
    await command.fill("반복 전송");
    await command.evaluate((element) => {
      const press = (key) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      press("Enter");
      for (let i = 0; i < 5; i++) {
        press("ArrowUp");
        press("Enter");
      }
    });
    const repetitions = () => received.join("").split("반복 전송\r\n").length - 1;
    for (let i = 0; i < 100 && repetitions() < 6; i++) await delay(25);
    assert.equal(repetitions(), 6);
    assert.equal(await command.inputValue(), "");
  });

  await test("after disconnect, only a second non-repeat Enter reconnects to the last server", async () => {
    await page.evaluate(async () => {
      const { profile } = await window.mud.request("load");
      await window.mud.request("save-profiles", [{ ...profile, name: "새 기본 서버", port: 1 }]);
    });
    await clickMenu(app, "disconnect-profile");
    const status = page.locator("#status");
    await status.filter({ hasText: "연결 종료" }).waitFor();
    const command = page.locator("#command");
    await command.press("Enter");
    await command.dispatchEvent("keydown", { key: "Enter", repeat: true });
    assert.equal(await status.textContent(), "연결 종료");
    assert.equal(connections, 1);
    assert.match(await page.locator("#message").textContent(), /Enter를 한 번 더/);
    await command.press("Enter");
    await status.filter({ hasText: "연결됨" }).waitFor({ timeout: 5000 }).catch(async (error) => {
      throw new Error(`Reconnect status: ${await status.textContent()}. ${await page.locator("#message").textContent()}`, { cause: error });
    });
    assert.equal(connections, 2);
    await command.press("ArrowUp");
    assert.equal(await command.inputValue(), "");

    await clickMenu(app, "disconnect-profile");
    await status.filter({ hasText: "연결 종료" }).waitFor();
    await page.locator("#terminal .xterm-helper-textarea").focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#message").textContent(), /Enter를 한 번 더/);
    assert.equal(connections, 2);
    await page.keyboard.press("Enter");
    await status.filter({ hasText: "연결됨" }).waitFor({ timeout: 5000 });
    assert.equal(connections, 3);
  });

  await test("legacy chat colors round-trip through TCP and render in the terminal", async () => {
    const command = page.locator("#command");
    await command.fill("$#155=114F안녕하세요$#155=7F기본색");
    await command.press("Enter");
    const expected = Buffer.concat([
      Buffer.from([0x9b]), iconv.encode("=14F안녕하세요", "cp949"),
      Buffer.from([0x9b]), iconv.encode("=7F기본색\r\n", "cp949"),
    ]);
    let sent = Buffer.concat(receivedBytes);
    for (let i = 0; i < 100 && !sent.includes(expected); i++) {
      await delay(25);
      sent = Buffer.concat(receivedBytes);
    }
    const start = sent.indexOf(expected);
    assert.notEqual(start, -1, "The chat shorthand is sent as legacy color bytes");
    socket.write(sent.subarray(start, start + expected.length));
    await page.locator("#terminal .xterm-fg-11").filter({ hasText: "안녕하세요" }).waitFor({ timeout: 5000 });
    const defaultText = page.locator("#terminal .xterm-rows span").filter({ hasText: "기본색" });
    assert.equal(await defaultText.evaluate((span) => [...span.classList].some((name) => name.startsWith("xterm-fg-"))), false);
  });
  assert.deepEqual(errors, []);
  console.log(
    "Baseline UI checks passed: TCP, CP949 commands, macro order, IME composition guard, secret history",
  );
} finally {
  await app.close();
  socket?.destroy();
  server.close();
}
