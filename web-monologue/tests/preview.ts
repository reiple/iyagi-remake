// Disposable UI fixture. Connects only to the loopback mock game server.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { createApp } from "../src/server";

const sockets = new Set<net.Socket>();
const mud = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let step = 0,
    buffer = "",
    name = "";
  const decoder = iconv.getDecoder("cp949");
  const send = (text: string) => socket.write(iconv.encode(text, "cp949"));
  send("[엔터를 누르세요. <안되면 X 치고 엔터>]");
  socket.on("data", (bytes) => {
    buffer += decoder.write(
      Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    );
    let end: number;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (step === 0 || step === 1) {
        if (line !== "") {
          socket.destroy();
          return;
        }
        step++;
        send(
          step === 1
            ? "공지사항 통과하려면 [ENTER]를 누르세요."
            : "자신의 캐릭터 이름을 넣으세요.\n이름은? ",
        );
      } else if (step === 2) {
        name = line;
        step++;
        send("암호를 입력하세요: ");
      } else if (step === 3) {
        step++;
        send(
          `\r\n${name}님, 퇴마요새에 오신 것을 환영합니다!\r\n[모의 서버] 실제 게임에는 연결되지 않습니다.\r\n[리턴을 누르세요]`,
        );
      } else if (step === 4) {
        if (line !== "") {
          socket.destroy();
          return;
        }
        step++;
        send("접속 체크 완료.\r\n> ");
      } else if (step === 5) {
        if (line !== "광장") {
          socket.destroy();
          return;
        }
        step++;
        send("광장에 도착했습니다.\r\n> ");
      } else
        send(
          `[${new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}] ${name} > ${line}\r\n기운이 고요하게 흐릅니다.\r\n`,
        );
    }
  });
});
mud.listen(0, "127.0.0.1", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iyagi-ui-preview-"));
  const app = createApp({
    dataDir,
    workerPath: path.resolve(__dirname, "../dist/script-worker.cjs"),
    publicDir: path.resolve(__dirname, "../public"),
    host: "127.0.0.1",
    port: (mud.address() as net.AddressInfo).port,
  });
  const a = app.manager.add("연무", "preview-only");
  const b = app.manager.add("청월", "preview-only");
  app.manager.add("별하", "preview-only");
  for (const [character, source, name] of [
    [a, '여기부터(){맴돌이(1){보내기("상태|");지연(100);}}', "고요한_수련.scs"],
    [b, "여기부터(){글월 a;글월받기(0,0,a,20);글월쓰기(a);}", "수련_준비.scs"],
  ] as const) {
    app.manager.configureScript(character.id, {
      name,
      data: Buffer.from(source).toString("base64"),
      headers: [],
    });
    app.manager.connect(character.id);
  }
  const wait = setInterval(() => {
    const characters = app.manager.list().filter((c) => c.connected);
    if (
      characters.length !== 2 ||
      characters.some((c) => c.loginState !== "ready")
    )
      return;
    clearInterval(wait);
    app.manager.run(a.id);
    app.manager.run(b.id);
  }, 50);
  app.server.listen(3000, "127.0.0.1", () =>
    console.log("UI 모의 서버: http://localhost:3000"),
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      clearInterval(wait);
      void app.close().then(() => {
        sockets.forEach((s) => s.destroy());
        mud.close(() => {
          fs.rmSync(dataDir, { recursive: true, force: true });
          process.exit(0);
        });
      });
    });
});
