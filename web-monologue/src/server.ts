import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  SessionManager,
  type ManagerOptions,
  type ScriptUpload,
} from "./sessions";

type AppOptions = ManagerOptions & {
  publicDir: string;
  allowedHosts?: string[];
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: http.IncomingMessage) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "JSON 요청만 허용합니다.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024)
      throw new HttpError(413, "요청 파일이 너무 큽니다.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON 요청이 올바르지 않습니다.");
  }
}

export function createApp(options: AppOptions) {
  const publicHosts = new Set(
    (options.allowedHosts || []).map((host) => host.trim().toLowerCase()),
  );
  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...publicHosts,
  ]);
  const manager = new SessionManager(options);
  const server = http.createServer(async (request, response) => {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(value));
    };
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const host = request.headers.host;
      const hostname = host
        ?.match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d+)?$/i)?.[1]
        .toLowerCase();
      if (!hostname || !allowedHosts.has(hostname))
        throw new HttpError(403, "허용된 서버 주소로 접속하세요.");
      if (
        request.headers.origin &&
        request.headers.origin !== `http://${host}` &&
        !(publicHosts.has(hostname) && request.headers.origin === `https://${host}`)
      )
        throw new HttpError(403, "허용되지 않은 요청 출처입니다.");
      const url = new URL(request.url || "/", `http://${host}`);
      const method = request.method || "GET";
      if (method === "GET" && url.pathname === "/health")
        return json(200, { ok: true });
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST", "DELETE"].includes(method))
          throw new HttpError(405, "지원하지 않는 요청 방식입니다.");
        if (method !== "GET" && request.headers["x-iyagi-request"] !== "1")
          throw new HttpError(403, "웹앱에서 요청하세요.");
        if (url.pathname === "/api/characters") {
          if (method === "GET")
            return json(200, { characters: manager.list() });
          if (method === "POST") {
            const body = await readJson(request);
            return json(201, {
              character: manager.add(body.name, body.password),
            });
          }
        }
        const match = url.pathname.match(
          /^\/api\/characters\/([a-f0-9-]{36})(?:\/([a-z-]+))?$/,
        );
        if (!match) throw new HttpError(404, "요청 경로를 찾을 수 없습니다.");
        const [, id, action] = match;
        if (method === "DELETE" && !action) {
          manager.remove(id);
          return json(200, { ok: true });
        }
        if (method === "GET" && action === "output")
          return json(200, manager.output(id));
        if (method !== "POST")
          throw new HttpError(404, "요청 경로를 찾을 수 없습니다.");
        const body = await readJson(request);
        switch (action) {
          case "connect":
            manager.connect(id);
            break;
          case "disconnect":
            manager.disconnect(id);
            break;
          case "confirm-login":
            manager.confirmLogin(id);
            break;
          case "run":
            manager.run(id);
            break;
          case "stop":
            manager.stop(id);
            break;
          case "script":
            return json(200, {
              diagnostics: manager.configureScript(id, body as ScriptUpload),
            });
          case "send":
            manager.send(id, body.text, body.secret);
            break;
          case "answer":
            manager.answer(id, body.id, body.text);
            break;
          default:
            throw new HttpError(404, "요청 경로를 찾을 수 없습니다.");
        }
        return json(200, { ok: true });
      }
      const staticFiles: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
      };
      const file = staticFiles[url.pathname];
      if (method !== "GET" || !file)
        throw new HttpError(404, "페이지를 찾을 수 없습니다.");
      const bytes = await fs.promises.readFile(
        path.join(options.publicDir, file[0]),
      );
      response.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8" });
      response.end(bytes);
    } catch (error) {
      if (!response.headersSent)
        json(error instanceof HttpError ? error.status : 400, {
          error:
            error instanceof Error
              ? error.message
              : "요청 처리에 실패했습니다.",
        });
      else response.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    manager,
    close: async () => {
      manager.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve(),
        ),
      );
    },
  };
}
