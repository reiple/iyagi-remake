import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import iconv from "iconv-lite";
import { createApp } from "../src/server";

const requestWithHost = (
  url: string,
  host: string,
  body?: unknown,
  origin?: string,
) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Host: host,
          "Content-Type": "application/json",
          "X-Iyagi-Request": "1",
          ...(origin ? { Origin: origin } : {}),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode!, text }),
        );
      },
    );
    request.on("error", reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });

test("HTTP API는 암호를 반환하지 않고 외부 Origin과 잘못된 요청을 거부한다", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-http-"));
  const app = createApp({
    dataDir,
    workerPath: "unused",
    publicDir: path.resolve(__dirname, "../public"),
  });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as net.AddressInfo).port}`;
  const post = (
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Iyagi-Request": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post(
          "/api/characters",
          { name: "테스트", password: "super-secret" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/api/characters", {
          name: "테스트",
          password: "super-secret",
        })
      ).status,
      201,
    );
    const list = await (await fetch(base + "/api/characters")).text();
    assert.ok(!list.includes("super-secret"));
    assert.ok(!list.includes('"password"'));
    const character = JSON.parse(list).characters[0];
    assert.equal(character.name, "테스트");
    assert.equal(
      (await post("/api/characters", { name: "테스트", password: "duplicate" }))
        .status,
      400,
    );
    assert.equal(
      (await post(`/api/characters/${character.id}/run`, {})).status,
      400,
    );
    assert.equal(
      (await post(`/api/characters/${character.id}/unknown`, {})).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + "/api/characters", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Iyagi-Request": "1",
          },
          body: "{broken",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/characters", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("LAN 주소는 명시적으로 허용하고 같은 Origin의 API 요청만 처리한다", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-lan-"));
  const app = createApp({
    dataDir,
    workerPath: "unused",
    publicDir: path.resolve(__dirname, "../public"),
    allowedHosts: ["192.168.50.7", "MUD-PC", "iyagi.ondigitalocean.app"],
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (app.server.address() as net.AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const lanHost = `192.168.50.7:${port}`;
  const request = (host: string, origin?: string) =>
    requestWithHost(
      base + "/api/characters",
      host,
      { name: "LAN검증", password: "synthetic-password" },
      origin,
    );
  try {
    assert.equal((await requestWithHost(base + "/", lanHost)).status, 200);
    assert.equal(
      (await requestWithHost(base + "/health", `mud-pc:${port}`)).status,
      200,
    );
    assert.equal(
      (await request(lanHost, "http://outside.example")).status,
      403,
    );
    assert.equal((await request(`192.168.50.8:${port}`)).status, 403);
    assert.equal((await request(`outside.example:${port}`)).status, 403);
    assert.equal(
      (await request(`192.168.50.7.outside.example:${port}`)).status,
      403,
    );
    assert.equal((await request(lanHost, `http://${lanHost}`)).status, 201);
    assert.equal(
      (
        await requestWithHost(base + "/", lanHost, undefined, `https://${lanHost}`)
      ).status,
      200,
    );
    assert.equal(
      (
        await requestWithHost(
          base + "/api/characters",
          "iyagi.ondigitalocean.app",
          { name: "HTTPS검증", password: "synthetic-password" },
          "https://iyagi.ondigitalocean.app",
        )
      ).status,
      201,
    );
    assert.equal(
      (await request(lanHost, "https://outside.example")).status,
      403,
    );
    assert.equal(
      (
        await requestWithHost(
          base + "/api/characters",
          "localhost",
          undefined,
          "https://localhost",
        )
      ).status,
      403,
    );
    const response = await requestWithHost(base + "/api/characters", lanHost);
    const { characters } = JSON.parse(response.text);
    assert.equal(characters[0].name, "LAN검증");
    assert.equal(characters[1].name, "HTTPS검증");
    assert.ok(!JSON.stringify(characters).includes("synthetic-password"));
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("기본 설정은 LAN Host와 비정상 Host를 거부한다", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-local-host-"));
  const app = createApp({
    dataDir,
    workerPath: "unused",
    publicDir: path.resolve(__dirname, "../public"),
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as net.AddressInfo).port}`;
  try {
    for (const host of [
      "192.168.50.7:3000",
      "localhost.outside.example",
      "user@localhost",
      "localhost/path",
    ]) {
      assert.equal((await requestWithHost(base + "/health", host)).status, 403);
    }
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test(
  "HTTP 관찰 없이 Worker가 계속 실행되고 재접속 후 출력과 입력 대기를 복구한다",
  { timeout: 12000 },
  async () => {
    let sent = 0;
    const sockets = new Set<net.Socket>();
    const mud = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const decoder = iconv.getDecoder("cp949");
      let buffer = "";
      socket.on("data", (bytes) => {
        buffer += decoder.write(
          Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        );
        let end: number;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (line === "계속") sent++;
        }
        socket.write(iconv.encode("응답\r\n", "cp949"));
      });
    });
    await new Promise<void>((r) => mud.listen(0, "127.0.0.1", r));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-detach-"));
    const app = createApp({
      dataDir,
      workerPath: path.resolve(__dirname, "../dist/script-worker.cjs"),
      publicDir: path.resolve(__dirname, "../public"),
      host: "127.0.0.1",
      port: (mud.address() as net.AddressInfo).port,
    });
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(app.server.address() as net.AddressInfo).port}`;
    const request = async (url: string, body: unknown) => {
      const response = await fetch(base + url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Iyagi-Request": "1" },
        body: JSON.stringify(body),
      });
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline) throw Error("상태 변경 시간 초과");
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    try {
      const { character } = await request("/api/characters", {
        name: "계속실행",
        password: "private-pass",
      });
      const route = `/api/characters/${character.id}`;
      await request(route + "/connect", {});
      await until(() => app.manager.list()[0].connected);
      await request(route + "/confirm-login", {});
      const source = '여기부터(){맴돌이(1){보내기("계속|");지연(5);}}';
      await request(route + "/script", {
        name: "loop.scs",
        data: Buffer.from(source).toString("base64"),
        headers: [],
      });
      assert.equal(app.manager.list()[0].loginState, "waiting-return");
      assert.throws(() => app.manager.run(character.id), /로그인/);
      for (const socket of sockets)
        socket.write(iconv.encode("[리턴을 누르세요]", "cp949"));
      await until(() => app.manager.list()[0].loginState === "ready");
      await request(route + "/run", {});
      await until(() => sent >= 2);
      const before = sent;
      // No HTTP requests or subscriptions during these three transmissions.
      await until(() => sent >= before + 3);
      const output = await (await fetch(base + route + "/output")).json();
      assert.equal(output.character.scriptState, "running");
      await request(route + "/stop", {});
      assert.ok(output.text.length > 0);
      const inputSource = "여기부터(){글월 a;글월받기(0,0,a,20);글월쓰기(a);}";
      await request(route + "/script", {
        name: "input.scs",
        data: Buffer.from(inputSource).toString("base64"),
        headers: [],
      });
      await request(route + "/run", {});
      await until(() => !!app.manager.list()[0].pendingInput);
      const waiting = await (await fetch(base + route + "/output")).json();
      assert.equal(waiting.character.pendingInput.prompt, "혼잣말 입력");
      await request(route + "/answer", {
        id: waiting.character.pendingInput.id,
        text: "입력완료",
      });
      await until(() => app.manager.list()[0].scriptState === "completed");
      assert.match(
        (await (await fetch(base + route + "/output")).json()).text,
        /입력완료/,
      );
    } finally {
      await app.close();
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((r) => mud.close(() => r()));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
