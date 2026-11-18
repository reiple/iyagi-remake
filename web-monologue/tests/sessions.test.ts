import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { SessionManager } from "../src/sessions";

const until = async (check: () => boolean, message = "상태 변경 시간 초과") => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test(
  "두 캐릭터의 로그인과 Worker를 격리하고 관찰 없이도 계속 실행한다",
  { timeout: 12000 },
  async () => {
    const commands = new Map<string, string[]>();
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffer = "",
        name = "",
        step = 0;
      const write = (text: string) => socket.write(iconv.encode(text, "cp949"));
      write("[엔터를 누르세요. <안되면 X 치고 엔터>]");
      socket.on("data", (bytes) => {
        buffer += iconv.decode(
          Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
          "cp949",
        );
        let end: number;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (step === 0 || step === 1) {
            assert.equal(
              line,
              "",
              "공지사항 전에 캐릭터 정보를 전송하면 안 됩니다.",
            );
            step++;
            write(
              step === 1
                ? "공지사항 통과하려면 [ENTER]를 누르세요."
                : "자신의 캐릭터 이름을 넣으세요.\n이름은? ",
            );
          } else if (step === 2) {
            name = line;
            commands.set(name, []);
            step++;
            write("암");
            setTimeout(() => write("호를 입력하세요: "), 10);
          } else if (step === 3) {
            assert.equal(line, "test-password");
            step++;
            write("퇴마요새에 오신 것을 환영합니다!\r\n> ");
            setTimeout(() => write("[리턴을 누르세요]"), 40);
          } else if (step === 4) {
            assert.equal(line, "", "로그인 후 접속 체크용 리턴이 필요합니다.");
            step++;
            write("접속 확인 완료.\r\n> ");
          } else if (step === 5) {
            assert.equal(
              line,
              "광장",
              "혼잣말 시작 전에 광장으로 이동해야 합니다.",
            );
            step++;
            write("광장에 도착했습니다.\r\n> ");
          } else {
            commands.get(name)!.push(line);
            write(name + ": " + line + "\r\n");
          }
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-web-"));
    const manager = new SessionManager({
      dataDir,
      workerPath: path.resolve(__dirname, "../dist/script-worker.cjs"),
      host: "127.0.0.1",
      port: (server.address() as net.AddressInfo).port,
    });
    try {
      const a = manager.add("첫째", "test-password");
      const b = manager.add("둘째", "test-password");
      assert.throws(() => manager.add("첫째", "other"), /이미/);
      manager.connect(a.id);
      manager.connect(b.id);
      await until(() => manager.list().every((c) => c.loginState === "ready"));
      const script = (word: string) => ({
        name: "loop.scs",
        data: Buffer.from(
          `여기부터(){맴돌이(1){보내기("${word}|");지연(5);}}`,
        ).toString("base64"),
        headers: [],
      });
      manager.configureScript(a.id, script("하나"));
      manager.configureScript(b.id, script("둘"));
      manager.run(a.id);
      manager.run(b.id);
      await until(
        () =>
          (commands.get("첫째")?.length || 0) >= 2 &&
          (commands.get("둘째")?.length || 0) >= 2,
      );
      manager.stop(a.id);
      const stopped = commands.get("첫째")!.length;
      const before = commands.get("둘째")!.length;
      await until(() => commands.get("둘째")!.length >= before + 3);
      assert.equal(commands.get("첫째")!.length, stopped);
      assert.ok(commands.get("첫째")!.every((x) => x === "하나"));
      assert.ok(commands.get("둘째")!.every((x) => x === "둘"));
      assert.throws(
        () => manager.configureScript(b.id, script("새소스")),
        /실행/,
      );
      manager.disconnect(b.id);
      assert.equal(
        manager.list().find((c) => c.id === b.id)!.scriptState,
        "stopped",
      );
      assert.ok(!JSON.stringify(manager.list()).includes("test-password"));
    } finally {
      manager.close();
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test("출력 버퍼가 오래된 암호 에코를 잘라도 암호 일부를 노출하지 않는다", async () => {
  let socket: net.Socket | undefined;
  const server = net.createServer((connected) => {
    socket = connected;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-redact-"));
  const manager = new SessionManager({
    dataDir,
    workerPath: "unused",
    host: "127.0.0.1",
    port: (server.address() as net.AddressInfo).port,
  });
  const password = "synthetic-test-secret";
  try {
    const character = manager.add("암호검증", password);
    manager.connect(character.id);
    await until(() => !!socket && manager.list()[0].connected);
    for (const fragmented of [false, true]) {
      if (fragmented) {
        const revision = manager.list()[0].revision;
        socket!.write(password.slice(0, 8));
        await until(() => manager.list()[0].revision > revision);
        assert.ok(manager.output(character.id).text.endsWith("••••"));
      }
      const revision = manager.list()[0].revision;
      socket!.write(fragmented ? password.slice(8) : password);
      await until(() => manager.list()[0].revision > revision);
      assert.ok(manager.output(character.id).text.endsWith("••••"));
      const end = fragmented ? "[2]" : "[1]";
      socket!.write("x".repeat(128000 - 12) + end);
      await until(() => manager.output(character.id).text.endsWith(end));
      const output = manager.output(character.id).text;
      assert.ok(
        !output.includes("secret"),
        "버퍼 경계에서 암호가 노출됐습니다.",
      );
      assert.match(output, /••••/);
    }
  } finally {
    manager.close();
    socket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("암호를 암호화 저장하고 재시작 후 캐릭터와 소스를 복구한다", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-store-"));
  const options = { dataDir, workerPath: "unused" };
  const manager = new SessionManager(options);
  try {
    assert.throws(() => manager.add("", "password"));
    assert.throws(() => manager.add("bad\nname", "password"));
    assert.throws(() => manager.add("name", "bad\rpassword"));
    const a = manager.add("저장캐릭터", "very-secret-password");
    manager.configureScript(a.id, {
      name: "test.scs",
      data: Buffer.from("여기부터(){}").toString("base64"),
      headers: [],
    });
    assert.ok(
      !fs
        .readFileSync(path.join(dataDir, "characters.json"), "utf8")
        .includes("very-secret-password"),
    );
    manager.close();
    const restored = new SessionManager(options);
    try {
      assert.equal(restored.list()[0].name, "저장캐릭터");
      assert.equal(restored.list()[0].fileName, "test.scs");
      assert.equal(restored.list()[0].connected, false);
      assert.throws(() => restored.run(a.id), /연결|로그인/);
      assert.throws(
        () =>
          restored.configureScript(a.id, {
            name: "../escape.scs",
            data: "",
            headers: [],
          }),
        /이름/,
      );
      assert.throws(
        () =>
          restored.configureScript(a.id, {
            name: "ok.scs",
            data: "",
            headers: [{ name: "../escape.h", data: "" }],
          }),
        /이름/,
      );
      restored.remove(a.id);
      assert.equal(restored.list().length, 0);
    } finally {
      restored.close();
    }
  } finally {
    manager.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("괄호가 있는 소스 이름과 사용자 헤더를 저장하고 재시작 후 복구한다", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-filename-"));
  const options = { dataDir, workerPath: "unused" };
  const manager = new SessionManager(options);
  const name = "(150)묘지_멸겁화.scs";
  const source = '#포함 "USE_SKILL.H"\n여기부터(){보내기(사용기술);}';
  const header = '#정의 사용기술 "테스트|"';
  try {
    const character = manager.add("파일명검증", "test-password");
    const diagnostics = manager.configureScript(character.id, {
      name,
      data: Buffer.from(source).toString("base64"),
      headers: [
        { name: "USE_SKILL.H", data: Buffer.from(header).toString("base64") },
      ],
    });
    assert.equal(diagnostics.functions, 1);
    assert.ok(
      diagnostics.includes.some((file) => file.endsWith("USE_SKILL.H")),
    );
    assert.equal(manager.list()[0].fileName, name);
    assert.equal(manager.list()[0].hasScript, true);
    const directory = path.join(dataDir, "characters", character.id, "script");
    assert.equal(fs.readFileSync(path.join(directory, name), "utf8"), source);
    assert.equal(
      fs.readFileSync(path.join(directory, "USE_SKILL.H"), "utf8"),
      header,
    );
    manager.close();
    const restored = new SessionManager(options);
    try {
      assert.equal(restored.list()[0].fileName, name);
      assert.equal(restored.list()[0].hasScript, true);
      assert.equal(restored.list()[0].error, "");
    } finally {
      restored.close();
    }
  } finally {
    manager.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("소스 저장 실패 시 실행 엔진까지 기존 소스로 복구한다", async () => {
  let received = "";
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (bytes) => {
      received += iconv.decode(
        Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        "cp949",
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-rollback-"));
  const manager = new SessionManager({
    dataDir,
    workerPath: path.resolve(__dirname, "../dist/script-worker.cjs"),
    host: "127.0.0.1",
    port: (server.address() as net.AddressInfo).port,
  });
  try {
    const character = manager.add("복구", "secret");
    manager.configureScript(character.id, {
      name: "old.scs",
      data: Buffer.from('여기부터(){보내기("기존소스|");}').toString("base64"),
      headers: [],
    });
    fs.mkdirSync(path.join(dataDir, "characters.json.tmp"));
    assert.throws(() =>
      manager.configureScript(character.id, {
        name: "new.scs",
        data: Buffer.from('여기부터(){보내기("새소스|");}').toString("base64"),
        headers: [],
      }),
    );
    fs.rmdirSync(path.join(dataDir, "characters.json.tmp"));
    manager.connect(character.id);
    await until(() => manager.list()[0].connected);
    manager.confirmLogin(character.id);
    assert.equal(manager.list()[0].loginState, "waiting-return");
    for (const socket of sockets)
      socket.write(iconv.encode("[리턴을 누르세요]", "cp949"));
    await until(() => manager.list()[0].loginState === "ready");
    assert.doesNotThrow(() => manager.run(character.id));
    await until(() => received.includes("기존소스"));
    assert.ok(!received.includes("새소스"));
    assert.equal(manager.list()[0].fileName, "old.scs");
  } finally {
    manager.close();
    sockets.forEach((s) => s.destroy());
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
