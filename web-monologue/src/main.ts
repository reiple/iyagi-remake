import path from "node:path";
import { createApp } from "./server";

function port(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw Error("포트는 1~65535여야 합니다.");
  return parsed;
}
const listenPort = port(process.env.PORT, 3000);
const allowedHosts = (process.env.WEB_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const app = createApp({
  allowedHosts,
  dataDir: path.resolve(
    process.env.DATA_DIR || path.join(__dirname, "../data"),
  ),
  workerPath: path.join(__dirname, "script-worker.cjs"),
  publicDir: path.join(__dirname, "public"),
  host: process.env.MUD_HOST || "xmud.ddnsfree.com",
  port: port(process.env.MUD_PORT, 6666),
});
app.server.on("error", (error) => {
  console.error("웹 서버 시작 실패:", error.message);
  app.manager.close();
  process.exitCode = 1;
});
app.server.listen(listenPort, process.env.LISTEN_HOST || "127.0.0.1", () => {
  console.log(`이야기 혼잣말 웹앱: http://localhost:${listenPort}`);
  for (const host of allowedHosts)
    console.log(`LAN 접속 주소: http://${host}:${listenPort}`);
});
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
