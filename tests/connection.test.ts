import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import iconv from "iconv-lite";
import { Connection } from "../src/core/connection.ts";
test("real TCP CP949 streaming and reconnect isolation", async () => {
  const server = net.createServer((s) => {
    const b = iconv.encode("퇴마요새", "cp949");
    s.write(b.subarray(0, 1));
    setTimeout(() => s.end(b.subarray(1)), 15);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const c = new Connection();
  let data = "";
  c.on("data", (s) => (data += s));
  try {
    const done = new Promise<void>((r) =>
      c.on("status", (s) => {
        if (s === "연결 종료") r();
      }),
    );
    c.connect("127.0.0.1", (server.address() as net.AddressInfo).port, "cp949");
    await done;
    assert.equal(data, "퇴마요새");
    c.disconnect();
  } finally {
    server.close();
  }
});
test("old socket close cannot disconnect replacement", async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((s) => sockets.push(s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const c = new Connection();
  const port = (server.address() as net.AddressInfo).port;
  const ready = () =>
    new Promise<void>((resolve) => {
      const f = (s: string) => {
        if (s === "연결됨") {
          c.off("status", f);
          resolve();
        }
      };
      c.on("status", f);
    });
  try {
    let r = ready();
    c.connect("127.0.0.1", port, "cp949");
    await r;
    const old = c.socket!;
    r = ready();
    c.connect("127.0.0.1", port, "cp949");
    await r;
    old.emit("close");
    assert.equal(c.connected, true);
  } finally {
    c.disconnect();
    sockets.forEach((s) => s.destroy());
    server.close();
  }
});
test(
  "real TCP renders Iyagi foreground codes alongside CP949 and standard ANSI",
  { timeout: 3000 },
  async () => {
    const server = net.createServer((socket) => {
      socket.write(Buffer.from([0x95, 0x9b]));
      socket.write(Buffer.from("=14F\x1b[31m\x9b", "latin1"));
      setTimeout(
        () =>
          socket.end(
            Buffer.concat([
              Buffer.from("=114F"),
              iconv.encode("쌙안녕하세요", "cp949"),
              Buffer.from("\x1b[=7F!"),
            ]),
          ),
        15,
      );
    });
    const connection = new Connection();
    let output = "";
    connection.on("data", (text) => {
      output += text;
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const closed = new Promise<void>((resolve) => {
        connection.on("status", (status) => {
          if (status === "연결 종료") resolve();
        });
      });
      connection.connect(
        "127.0.0.1",
        (server.address() as net.AddressInfo).port,
        "cp949",
      );
      await closed;
      assert.equal(output, "븲=14F\x1b[31m\x1b[93m쌙안녕하세요\x1b[39m!");
    } finally {
      connection.disconnect();
      server.close();
    }
  },
);
test(
  "ordinary commands send Iyagi color commands as raw Telnet bytes",
  { timeout: 3000 },
  async () => {
    const server = net.createServer();
    const connection = new Connection();
    let socket: net.Socket | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const accepted = once(server, "connection");
      const ready = new Promise<void>((resolve) => {
        connection.on("status", (status) => {
          if (status === "연결됨") resolve();
        });
      });
      connection.connect(
        "127.0.0.1",
        (server.address() as net.AddressInfo).port,
        "cp949",
      );
      [socket] = (await accepted) as [net.Socket];
      await ready;
      const expected = Buffer.concat([
        Buffer.from([0x9b]),
        Buffer.from("=14F"),
        iconv.encode("안녕하세요", "cp949"),
        Buffer.from([0x9b]),
        Buffer.from("=7F $#155=12F\r\n"),
      ]);
      const outbound = socket;
      const received = new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        outbound.on("data", (chunk) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(bytes);
          if (bytes.includes(0x0a)) resolve(Buffer.concat(chunks));
        });
      });
      connection.send("\x9b=14F안녕하세요\x9b=7F $#155=12F");
      assert.deepEqual(await received, expected);
    } finally {
      connection.disconnect();
      socket?.destroy();
      server.close();
    }
  },
);
