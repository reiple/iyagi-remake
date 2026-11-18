import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Connection } from "../../src/core/connection";
import { ScriptService } from "../../src/script/service";
import { decodeSource } from "../../src/script/source";
import { CharacterStore, type CharacterRecord } from "./store";
import { Login } from "./login";

type Upload = { name: string; data: string };
export type ScriptUpload = Upload & { headers: Upload[] };
export type ManagerOptions = {
  dataDir: string;
  workerPath: string;
  host?: string;
  port?: number;
};
type Session = {
  record: CharacterRecord;
  connection: Connection;
  script: ScriptService;
  login: Login;
  text: string;
  status: string;
  error: string;
  source: string;
  secret: boolean;
  secrets: string[];
  revision: number;
  timer?: ReturnType<typeof setTimeout>;
};

const input = (
  value: unknown,
  label: string,
  max: number,
  trim = false,
): string => {
  if (typeof value !== "string") throw Error(`${label}을 입력하세요.`);
  const text = trim ? value.trim().normalize("NFC") : value;
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text))
    throw Error(`${label}이 올바르지 않습니다.`);
  return text;
};
function fileName(value: unknown, header = false): string {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !(header ? /^[\p{L}\p{N}_. -]+$/u : /^[\p{L}\p{N}_. ()-]+$/u).test(value) ||
    value.includes("..") ||
    !(header ? /\.h$/i : /\.(scs|txt)$/i).test(value)
  )
    throw Error("파일 이름이 올바르지 않습니다.");
  return value;
}
function uploadBytes(upload: Upload): Buffer {
  if (
    typeof upload.data !== "string" ||
    upload.data.length > 2800000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      upload.data,
    )
  )
    throw Error("파일은 최대 2MB이며 올바른 Base64여야 합니다.");
  const data = Buffer.from(upload.data, "base64");
  if (data.length > 2 * 1024 * 1024) throw Error("파일은 최대 2MB입니다.");
  return data;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private store: CharacterStore;
  constructor(public options: ManagerOptions) {
    this.store = new CharacterStore(options.dataDir);
    for (const record of this.store.load())
      this.sessions.set(record.id, this.create(record));
  }
  private get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw Error("캐릭터를 찾을 수 없습니다.");
    return session;
  }
  private persist() {
    this.store.save([...this.sessions.values()].map((s) => s.record));
  }
  private directory(id: string) {
    return path.join(this.options.dataDir, "characters", id);
  }
  private append(s: Session, text: string) {
    // Mask complete echoes before eviction, retaining partial tails for the next packet.
    s.text = this.redact(s, s.text + text, false).slice(-128000);
    s.revision++;
  }
  private create(record: CharacterRecord): Session {
    const connection = new Connection();
    const login = new Login(record.name, record.password, (text) =>
      connection.send(text),
    );
    const s: Session = {
      record,
      connection,
      login,
      script: undefined!,
      text: "",
      status: "연결 안 됨",
      error: "",
      source: "",
      secret: false,
      secrets: [record.password],
      revision: 0,
    };
    s.script = new ScriptService({
      workerPath: this.options.workerPath,
      canRun: () =>
        connection.connected && login.state === "ready" && !s.secret,
      send: (text) => connection.sendScript(text),
      sendByte: (byte) => connection.sendScriptByte(byte),
      logEnd: () => this.append(s, "\n[갈무리 종료 요청]\n"),
      event: (event) => {
        s.revision++;
        if (event.type === "output")
          this.append(s, "\n[혼잣말] " + event.text + "\n");
        if (event.type === "failure") {
          s.error = event.error;
          this.append(s, "\n[오류] " + event.error + "\n");
        }
      },
    });
    connection.on("status", (status: string) => {
      s.status = status;
      s.revision++;
      if (status === "연결됨") {
        login.start();
        s.timer = setTimeout(() => {
          login.manual();
          s.revision++;
        }, 20000);
        s.timer.unref();
      } else if (status !== "접속 중") {
        clearTimeout(s.timer);
        login.offline();
        s.script.stop();
        s.secret = false;
        if (status.startsWith("오류:")) s.error = status;
      }
    });
    connection.on("echo", (secret: boolean) => {
      s.secret = secret;
      if (secret) s.script.stop();
      login.echo(secret);
      s.revision++;
    });
    connection.on("data", (text: string) => {
      this.append(s, text);
      try {
        login.feed(text);
      } catch {
        s.error = "자동 로그인 전송에 실패했습니다.";
        login.manual();
      }
      if (login.state === "ready") clearTimeout(s.timer);
      if (login.state === "ready" && !s.secret) s.script.feed(text);
    });
    if (record.fileName) {
      try {
        fileName(record.fileName);
        const file = path.join(
          this.directory(record.id),
          "script",
          record.fileName,
        );
        s.source = s.script.load(file).text;
        s.script.setHeaderRoot(path.dirname(file));
        s.script.translate(s.source);
      } catch {
        s.error =
          "저장된 혼잣말을 읽거나 번역하지 못했습니다. 파일을 다시 지정하세요.";
      }
    }
    return s;
  }
  private view(s: Session) {
    return {
      id: s.record.id,
      name: s.record.name,
      fileName: s.record.fileName,
      connected: s.connection.connected,
      connecting: !!s.connection.socket && !s.connection.connected,
      connectionStatus: s.status,
      loginState: s.login.state,
      scriptState: s.script.state,
      hasScript: !!s.script.compiled,
      secret: s.secret,
      error: this.redact(s, s.error),
      revision: s.revision,
      pendingInput: s.script.pendingInput
        ? {
            id: s.script.pendingInput.id,
            prompt: this.redact(s, s.script.pendingInput.prompt),
            max: s.script.pendingInput.max,
          }
        : null,
    };
  }
  private redact(s: Session, text: string, maskPartial = true) {
    for (const secret of s.secrets) {
      text = text.split(secret).join("••••");
      if (!maskPartial) continue;
      // Mask a secret split between TCP packets, before its suffix arrives.
      for (let n = Math.min(secret.length - 1, text.length); n > 0; n--) {
        if (text.endsWith(secret.slice(0, n))) {
          text = text.slice(0, -n) + "••••";
          break;
        }
      }
    }
    return text;
  }
  list() {
    return [...this.sessions.values()].map((s) => this.view(s));
  }
  add(name: unknown, password: unknown) {
    const checkedName = input(name, "캐릭터 이름", 40, true);
    const checkedPassword = input(password, "암호", 200);
    if (this.sessions.size >= 100) throw Error("캐릭터는 최대 100개입니다.");
    if ([...this.sessions.values()].some((s) => s.record.name === checkedName))
      throw Error("이미 추가된 캐릭터입니다.");
    const record = {
      id: randomUUID(),
      name: checkedName,
      password: checkedPassword,
      fileName: "",
    };
    const session = this.create(record);
    this.sessions.set(record.id, session);
    try {
      this.persist();
    } catch (error) {
      this.sessions.delete(record.id);
      throw error;
    }
    return this.view(session);
  }
  connect(id: string) {
    const s = this.get(id);
    if (s.connection.socket)
      throw Error("이미 접속 중이거나 연결되어 있습니다.");
    s.error = "";
    s.secret = false;
    this.append(s, "\n[퇴마요새에 접속합니다.]\n");
    s.connection.connect(
      this.options.host || "xmud.ddnsfree.com",
      this.options.port || 6666,
      "cp949",
    );
  }
  confirmLogin(id: string) {
    const s = this.get(id);
    if (!s.connection.connected || s.secret)
      throw Error("서버에 연결하고 비밀 입력을 종료하세요.");
    s.login.confirm();
    clearTimeout(s.timer);
    s.revision++;
  }
  disconnect(id: string) {
    const s = this.get(id);
    s.script.stop();
    clearTimeout(s.timer);
    s.connection.disconnect();
  }
  configureScript(id: string, upload: ScriptUpload) {
    const s = this.get(id);
    if (s.script.worker)
      throw Error("혼잣말 실행을 중지한 뒤 파일을 변경하세요.");
    if (!upload || !Array.isArray(upload.headers) || upload.headers.length > 50)
      throw Error("헤더는 최대 50개입니다.");
    const name = fileName(upload.name);
    const files = [
      { name, bytes: uploadBytes(upload) },
      ...upload.headers.map((h) => ({
        name: fileName(h.name, true),
        bytes: uploadBytes(h),
      })),
    ];
    if (new Set(files.map((f) => f.name.toLowerCase())).size !== files.length)
      throw Error("동일한 이름의 파일이 여러 개 있습니다.");
    if (files.reduce((size, f) => size + f.bytes.length, 0) > 4 * 1024 * 1024)
      throw Error("전체 파일 크기는 최대 4MB입니다.");
    // Decode every file before changing the saved source.
    for (const file of files) decodeSource(file.bytes);
    const base = this.directory(id);
    const staged = path.join(base, "upload-" + randomUUID());
    fs.mkdirSync(staged, { recursive: true, mode: 0o700 });
    const candidate = new ScriptService({
      ...s.script.options,
      event: () => {},
    });
    try {
      for (const file of files)
        fs.writeFileSync(path.join(staged, file.name), file.bytes, {
          mode: 0o600,
        });
      const source = candidate.load(path.join(staged, name)).text;
      candidate.setHeaderRoot(staged);
      const diagnostics = candidate.translate(source);
      const previousEngine = {
        compiled: s.script.compiled,
        compiledText: s.script.compiledText,
        sourceFile: s.script.sourceFile,
        headerRoot: s.script.headerRoot,
        state: s.script.state,
      };
      const target = path.join(base, "script");
      const backup = path.join(base, "previous");
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(target)) fs.renameSync(target, backup);
      fs.renameSync(staged, target);
      try {
        s.script.load(path.join(target, name));
        s.script.setHeaderRoot(target);
        s.script.translate(source);
        const previous = s.record.fileName;
        s.record.fileName = name;
        try {
          this.persist();
        } catch (e) {
          s.record.fileName = previous;
          throw e;
        }
        s.source = source;
        s.error = "";
        s.revision++;
      } catch (e) {
        fs.rmSync(target, { recursive: true, force: true });
        if (fs.existsSync(backup)) fs.renameSync(backup, target);
        Object.assign(s.script, previousEngine);
        s.revision++;
        throw e;
      }
      fs.rmSync(backup, { recursive: true, force: true });
      return diagnostics;
    } finally {
      candidate.stop();
      fs.rmSync(staged, { recursive: true, force: true });
    }
  }
  run(id: string) {
    const s = this.get(id);
    if (!s.connection.connected || s.login.state !== "ready")
      throw Error("먼저 서버에 연결하고 로그인을 완료하세요.");
    if (s.script.worker) throw Error("이미 혼잣말을 실행 중입니다.");
    if (!s.script.compiled) throw Error("혼잣말 파일을 먼저 지정하세요.");
    s.error = "";
    s.script.run(s.source);
  }
  stop(id: string) {
    this.get(id).script.stop();
  }
  send(id: string, text: unknown, secret: unknown = false) {
    const s = this.get(id);
    if (
      typeof text !== "string" ||
      text.length > 16000 ||
      /[\r\n\x00]/.test(text) ||
      typeof secret !== "boolean"
    )
      throw Error("명령 입력이 올바르지 않습니다.");
    if (secret || s.secret) {
      s.script.stop();
      if (text && !s.secrets.includes(text)) s.secrets.push(text);
    }
    if (s.login.state !== "ready") {
      s.login.manual();
      clearTimeout(s.timer);
    }
    s.connection.send(text);
    if (!secret && !s.secret) this.append(s, "\n> " + text + "\n");
  }
  answer(id: string, requestId: unknown, text: unknown) {
    const s = this.get(id);
    if (!Number.isInteger(requestId) || typeof text !== "string")
      throw Error("입력 응답이 올바르지 않습니다.");
    s.script.answer(requestId as number, text);
    s.revision++;
  }
  output(id: string) {
    const s = this.get(id);
    return { character: this.view(s), text: this.redact(s, s.text) };
  }
  remove(id: string) {
    const s = this.get(id);
    if (s.connection.socket || s.script.worker)
      throw Error("연결과 혼잣말을 종료한 뒤 삭제하세요.");
    this.sessions.delete(id);
    try {
      this.persist();
    } catch (e) {
      this.sessions.set(id, s);
      throw e;
    }
    fs.rmSync(this.directory(id), { recursive: true, force: true });
  }
  close() {
    for (const s of this.sessions.values()) {
      clearTimeout(s.timer);
      s.script.stop();
      s.connection.disconnect();
    }
  }
}
