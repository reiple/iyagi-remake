import { test } from "node:test";
import assert from "node:assert/strict";
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
