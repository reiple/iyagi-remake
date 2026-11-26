import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import iconv from "iconv-lite";
import { chromium } from "playwright";
import serverModule from "../src/server.ts";

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
const until = async (condition) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for mock server state");
    await delay(20);
  }
};

test("Monologue browser commands, legacy ANSI colors and script controls", async (t) => {
  const sockets = new Set();
  const clients = new Map();
  const counts = new Map();
  const mud = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const prompts = [
      "공지사항 통과하려면 [ENTER]를 누르세요.",
      "자신의 캐릭터 이름을 넣으세요.\n이름은? ",
      "암호를 입력하세요: ",
      "퇴마요새에 오신 것을 환영합니다!\r\n[리턴을 누르세요]",
      "접속 확인 완료.\r\n> ",
      "광장에 도착했습니다.\r\n> ",
    ];
    const write = (text) => socket.write(iconv.encode(text, "cp949"));
    let buffered = Buffer.alloc(0);
    let step = 0;
    const lines = [];
    write("[엔터를 누르세요. <안되면 X 치고 엔터>]");
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      let end;
      while ((end = buffered.indexOf("\r\n")) >= 0) {
        const line = buffered.subarray(0, end);
        buffered = buffered.subarray(end + 2);
        if (step < prompts.length) {
          if (step === 2) {
            const name = iconv.decode(line, "cp949");
            clients.set(name, { socket, lines });
            counts.set(name, (counts.get(name) ?? 0) + 1);
          }
          write(prompts[step++]);
        } else lines.push(line);
      }
    });
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-web-ui-"));
  let app, browser;
  try {
    await listen(mud);
    app = serverModule.createApp({
      dataDir: temporary,
      workerPath: path.resolve(
        import.meta.dirname,
        "../dist/script-worker.cjs",
      ),
      publicDir: path.resolve(import.meta.dirname, "../public"),
      host: "127.0.0.1",
      port: mud.address().port,
    });
    await listen(app.server);
    for (const name of ["첫째", "둘째"]) {
      const character = app.manager.add(name, "fixture-password");
      app.manager.connect(character.id);
    }
    await until(() =>
      app.manager.list().every((c) => c.loginState === "ready"),
    );
    browser = await chromium.launch({
      channel: process.env.MONOLOGUE_BROWSER || "chrome",
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    const row = (name) =>
      page.locator(".character-row").filter({ hasText: name });
    const text = (name) => row(name).locator("[data-action=text]");
    const command = page.locator("#command-input");
    const terminal = page.locator("#terminal-output");
    const status = (message) =>
      page
        .locator("#text-status")
        .filter({ hasText: message })
        .waitFor({ timeout: 5000 });
    const openText = async (name) => {
      if (await page.locator("#text-dialog").isVisible()) {
        if ((await page.locator("#text-title").textContent()).startsWith(name))
          return;
        await page.locator('[data-close="text-dialog"]').click();
      }
      await text(name).click();
      await status("로그인 완료");
    };
    const received = (name) =>
      clients.get(name).lines.map((line) => iconv.decode(line, "cp949"));
    const send = async (value) => {
      await command.fill(value);
      const response = page.waitForResponse((r) => r.url().endsWith("/send"));
      await command.press("Enter");
      assert.equal((await response).ok(), true);
    };

    await t.test(
      "saving a script closes its dialog, and running it keeps the filename visible",
      async () => {
        await row("첫째").locator("[data-action=source]").click();
        await page.locator("#script-file").setInputFiles({
          name: "수련 (테스트).scs",
          mimeType: "text/plain",
          buffer: Buffer.from("여기부터(){맴돌이(1){지연(10);}}"),
        });
        await page.locator("#script-submit").click();
        await page
          .locator("#script-dialog")
          .waitFor({ state: "hidden", timeout: 5000 });
        await row("첫째").locator("[data-action=run]").click();
        await row("첫째")
          .locator(".script-state")
          .filter({ hasText: "실행 중" })
          .waitFor({ timeout: 5000 });
        assert.equal(
          await row("첫째").locator(".script-file").textContent(),
          "수련 (테스트).scs",
        );
        await row("첫째").locator("[data-action=run]").click();
        await row("첫째")
          .locator(".script-state")
          .filter({ hasText: "중지" })
          .waitFor({ timeout: 5000 });
      },
    );

    await t.test(
      "keeps 20 commands per character, leaves secrets out, and repeats immediately",
      async () => {
        await text("첫째").click();
        await status("로그인 완료");
        for (let i = 1; i <= 21; i++) await send(`기록 ${i}`);
        await page.locator("#command-secret").check();
        await send("비밀값");
        await page.locator("#command-secret").uncheck();
        await command.press("ArrowUp");
        assert.equal(await command.inputValue(), "기록 21");
        await command.press("ArrowDown");
        assert.equal(await command.inputValue(), "");
        for (let i = 0; i < 21; i++) await command.press("ArrowUp");
        assert.equal(await command.inputValue(), "기록 2");
        await command.fill("반복 전송");
        let repetitions = 0;
        const finalRepeat = page.waitForResponse(
          (r) => r.url().endsWith("/send") && ++repetitions === 5,
        );
        await command.evaluate((el) => {
          const key = (key) =>
            el.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
              }),
            );
          key("Enter");
          for (let i = 0; i < 4; i++) {
            key("ArrowUp");
            key("Enter");
          }
          key("ArrowUp");
        });
        await until(
          () =>
            received("첫째").filter((line) => line === "반복 전송").length ===
            5,
        );
        await (await finalRepeat).json();
        assert.equal(await command.inputValue(), "반복 전송");
        await command.press("ArrowDown");
        assert.equal(await command.inputValue(), "");
        await page.locator('[data-close="text-dialog"]').click();
        await text("둘째").click();
        await status("로그인 완료");
        await command.press("ArrowUp");
        assert.equal(await command.inputValue(), "");
      },
    );

    await t.test(
      "one Enter commits Korean IME input and submits the completed command",
      async () => {
        await openText("둘째");
        await command.fill("한글입력");
        await command.evaluate((el) => {
          el.dispatchEvent(new CompositionEvent("compositionstart"));
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              isComposing: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          el.dispatchEvent(
            new CompositionEvent("compositionend", { data: "력" }),
          );
          el.dispatchEvent(
            new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
          );
        });
        await until(() => received("둘째").includes("한글입력"));
        assert.equal(await command.inputValue(), "");
      },
    );

    await t.test(
      "an unsent password stays hidden when the remote secret prompt ends",
      async () => {
        await openText("둘째");
        const remote = clients.get("둘째").socket;
        remote.write(Buffer.from([255, 251, 1]));
        await page.waitForFunction(
          () => document.querySelector("#command-input").type === "password",
        );
        const character = app.manager.list().find((c) => c.name === "둘째");
        const staleSend = await page.evaluate(
          async ({ id, connectionGeneration }) => {
            const response = await fetch(`/api/characters/${id}/send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Iyagi-Request": "1",
              },
              body: JSON.stringify({
                text: "대기 중인 일반 명령",
                secret: false,
                connectionGeneration,
              }),
            });
            return response.status;
          },
          character,
        );
        await command.fill("작성 중인 암호");
        remote.write(Buffer.from([255, 252, 1]));
        await until(
          () => !app.manager.list().find((c) => c.name === "둘째").secret,
        );
        await page.waitForFunction(
          () => !document.querySelector("#command-secret").disabled,
        );
        assert.equal(await command.getAttribute("type"), "password");
        await page.locator("#command-secret").uncheck();
        assert.equal(await command.inputValue(), "");
        assert.ok(!received("둘째").includes("작성 중인 암호"));
        assert.equal(staleSend, 400);

        const endpoint = `**/api/characters/${character.id}/send`;
        let blocked;
        await page.route(endpoint, (route) => {
          blocked = route;
        });
        try {
          await page.locator("#command-secret").check();
          await command.fill("전송에 실패한 암호");
          await command.press("Enter");
          await until(() => blocked !== undefined);
          await page.locator("#command-secret").uncheck();
          await blocked.fulfill({
            status: 400,
            json: { error: "전송 실패 테스트" },
          });
          await page
            .locator("#text-error")
            .filter({ hasText: "전송 실패 테스트" })
            .waitFor({ timeout: 5000 });
          assert.equal(await command.inputValue(), "");
        } finally {
          await page.unroute(endpoint);
        }
      },
    );

    await t.test(
      "reconnects only the selected character after two Enter presses",
      async () => {
        if (
          !(await page.locator("#text-title").textContent()).startsWith("둘째")
        ) {
          await page.locator('[data-close="text-dialog"]').click();
          await text("둘째").click();
        }
        clients.get("둘째").socket.end();
        await status("연결 종료");
        await terminal.focus();
        await page.keyboard.press("Enter");
        assert.match(
          await page.locator("#command-hint").textContent(),
          /Enter를 한 번 더/,
        );
        await terminal.dispatchEvent("keydown", { key: "Enter", repeat: true });
        assert.equal(counts.get("둘째"), 1);
        await page.keyboard.press("Enter");
        await status("로그인 완료");
        assert.equal(counts.get("둘째"), 2);
        assert.equal(counts.get("첫째"), 1);
        await command.press("ArrowUp");
        assert.equal(await command.inputValue(), "");
      },
    );

    await t.test(
      "sends typed color notation and renders legacy colors from the server",
      async () => {
        if (await page.locator("#text-dialog").isVisible())
          await page.locator('[data-close="text-dialog"]').click();
        await text("첫째").click();
        await status("로그인 완료");
        await send("$#155=114F안녕하세요$#155=7F");
        const wire = Buffer.concat([
          Buffer.from([155]),
          iconv.encode("=14F안녕하세요", "cp949"),
          Buffer.from([155]),
          Buffer.from("=7F"),
        ]);
        await until(() =>
          clients.get("첫째").lines.some((line) => line.equals(wire)),
        );
        clients
          .get("첫째")
          .socket.write(
            Buffer.concat([
              Buffer.from([155]),
              iconv.encode("=14F서버 노란색", "cp949"),
              Buffer.from([155]),
              iconv.encode("=7F서버 기본색\r\n", "cp949"),
            ]),
          );
        const colored = terminal
          .locator("span")
          .filter({ hasText: "서버 노란색" });
        await colored.waitFor({ timeout: 5000 });
        const [yellow, normal] = await Promise.all([
          colored.evaluate((el) => getComputedStyle(el).color),
          terminal.evaluate((el) => getComputedStyle(el).color),
        ]);
        assert.notEqual(yellow, normal);
        assert.match(await terminal.textContent(), /서버 노란색서버 기본색/);
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await app?.close();
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => mud.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
