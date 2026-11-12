import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { decodeSource, preprocess, type Encoding } from "./source";
import { compile, type Program } from "./compiler";
const readSource=(file:string)=>{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error("소스 파일은 최대 2MB입니다.");return fs.readFileSync(file);};
export class ScriptService {
  sourceFile = "";
  headerRoot = "";
  compiled?: Program;
  compiledText = "";
  worker?: Worker;
  state = "idle";
  lastSend = 0;
  inputId = 0;
  sendTimers = new Set<ReturnType<typeof setTimeout>>();
  pendingInput?: { id: number; workerId: number; prompt: string; max: number };
  constructor(
    public options: {
      workerPath: string;
      canRun: () => boolean;
      send: (s: string) => void;
      sendByte?: (byte:number)=>void;
      event: (e: any) => void;
      logEnd: () => void;
    },
  ) {}
  load(file: string, encoding: Encoding = "auto") {
    if (!["auto", "utf8", "cp949", "johab"].includes(encoding))
      throw Error("지원하지 않는 인코딩");
    this.stop();
    this.compiled = undefined;
    this.compiledText = "";
    const sourceFile = fs.realpathSync(file);
    const bytes = readSource(sourceFile);
    const decoded = decodeSource(bytes);
    if (encoding !== "auto")
      Object.assign(
        decoded,
        decodeSource(bytes, encoding),
      );
    this.sourceFile = sourceFile;
    return { ...decoded, file: sourceFile };
  }
  setHeaderRoot(root: string) {
    this.stop();
    this.headerRoot = fs.realpathSync(root);
    this.compiled = undefined;
    return this.headerRoot;
  }
  translate(text: string) {
    this.stop();
    this.compiled = undefined;
    this.compiledText = "";
    if (typeof text !== "string" || text.length > 1024 * 1024)
      throw Error("소스는 최대 1MB입니다.");
    const source = this.sourceFile || "편집한 소스.scs";
    const resolver = (name: string, from: string) => {
      const roots = [
        this.sourceFile ? path.dirname(this.sourceFile) : "",
        this.headerRoot,
      ]
        .filter(Boolean)
        .map((p) => fs.realpathSync(p));
      const inside = (p: string, r: string) => {
        const rel = path.relative(r, p);
        return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      };
      const dirs = [path.dirname(from), ...roots];
      const candidates:{text:string;file:string;bytes:Buffer}[]=[];
      for (const dir of [...new Set(dirs)]) {
        const candidate = path.join(dir, name);
        if (!fs.existsSync(candidate)) continue;
        const real = fs.realpathSync(candidate);
        if (!roots.some((r) => inside(real, r)))
          throw Error("선택한 소스/헤더 폴더 밖의 파일은 포함할 수 없습니다.");
        const bytes=readSource(real);candidates.push({text:decodeSource(bytes).text,file:real,bytes});
      }
      if(candidates.length){if(candidates.some(c=>!c.bytes.equals(candidates[0].bytes)))throw Error("헤더 여러 버전 충돌: "+candidates.map(c=>c.file).join(" / "));return candidates[0];}
      throw Error(
        "헤더를 찾지 못했습니다: " +
          name +
          " — 해당 버전의 헤더 폴더를 선택하세요.",
      );
    };
    const prepared = preprocess(text, source, resolver);
    const p = compile(prepared);
    this.compiled = p;
    this.compiledText = text;
    return {
      nodes: p.nodeCount,
      functions: Object.keys(p.functions).length,
      includes: p.includes,
      warnings: p.warnings,
    };
  }
  run(text: string) {
    if (!this.compiled || text !== this.compiledText)
      throw Error("현재 소스를 먼저 번역하세요.");
    if (!this.options.canRun())
      throw Error("연결 후 비밀 입력을 끈 상태에서 실행하세요.");
    this.stop();
    const worker = new Worker(this.options.workerPath, {
      workerData: { program: this.compiled },
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    this.worker = worker;
    this.state = "running";
    this.options.event({ type: "state", state: this.state, fileName: path.basename(this.sourceFile) });
    worker.on("message", (m) => {
      if (this.worker !== worker) return;
      if (m.type === "request") {
        if (["send","output","byte","logEnd"].includes(m.action)) {
          if (m.action==="byte" ? (!Number.isInteger(m.payload)||m.payload<0||m.payload>255) : (typeof m.payload !== "string" || m.payload.length > 65536)) {
            this.fail("송신 크기 초과");
            return;
          }
          const deliver = () => {
            if (this.worker !== worker) return;
            if (this.state === "paused") {
              const t = setTimeout(() => {
                this.sendTimers.delete(t);
                deliver();
              }, 20);
              this.sendTimers.add(t);
              return;
            }
            try {
              if (!this.options.canRun())
                throw Error("전송할 수 없는 연결 상태");
              if(m.action==="output")this.options.event({type:"output",text:m.payload.length>4096?m.payload.slice(0,4096)+"\n[출력 일부 생략]":m.payload});else if(m.action==="byte"){if(!this.options.sendByte)throw Error("바이트 송신 기능 없음");this.options.sendByte(m.payload);}else if(m.action==="logEnd")this.options.logEnd();else this.options.send(m.payload);
              this.lastSend = Date.now();
              worker.postMessage({ type: "response", id: m.id, value: 0 });
            } catch (e) {
              this.fail(String(e));
            }
          };
          const t = setTimeout(
            () => {
              this.sendTimers.delete(t);
              deliver();
            },
            Math.max(0, (["output","logEnd"].includes(m.action)?100:20) - (Date.now() - this.lastSend)),
          );
          this.sendTimers.add(t);
        } else if (m.action === "input") {
          if (
            !m.payload ||
            typeof m.payload.prompt !== "string" ||
            m.payload.prompt.length > 1000 ||
            !Number.isInteger(m.payload.max) ||
            m.payload.max < 1 ||
            m.payload.max > 1000
          ) {
            this.fail("잘못된 입력 요청");
            return;
          }
          this.pendingInput = {
            id: ++this.inputId,
            workerId: m.id,
            ...m.payload,
          };
          this.options.event({ type: "input", ...this.pendingInput });
        } else this.fail("지원하지 않는 실행 요청");
      } else if (m.type === "done") {
        this.stop("completed");
      } else if (m.type === "failure") {
        this.fail(m.error);
      }
      else if (m.type === "location")
        this.options.event(m);
    });
    worker.on("error", (e) => {
      if (this.worker === worker)
        this.fail(e instanceof Error ? e.message : String(e));
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.fail("실행 엔진이 종료되었습니다: " + code);
      }
    });
  }
  feed(text: string) {
    this.worker?.postMessage({ type: "data", text: text.slice(-65536) });
  }
  pause() {
    if (this.state !== "running") return;
    this.state = "paused";
    this.worker?.postMessage({ type: "pause" });
    this.options.event({ type: "state", state: this.state });
  }
  resume() {
    if (this.state !== "paused") return;
    if (!this.options.canRun()) {
      this.stop();
      return;
    }
    this.state = "running";
    this.worker?.postMessage({ type: "resume" });
    this.options.event({ type: "state", state: this.state });
  }
  answer(id: number, text: string) {
    if (!this.worker || !this.pendingInput || this.pendingInput.id !== id)
      throw Error("만료된 입력 요청");
    if (typeof text !== "string" || text.length > this.pendingInput.max)
      throw Error("입력 길이 초과");
    this.worker.postMessage({
      type: "response",
      id: this.pendingInput.workerId,
      value: text,
    });
    this.pendingInput = undefined;
  }
  stop(state = "stopped") {
    const worker = this.worker;
    this.worker = undefined;
    this.pendingInput = undefined;
    for (const t of this.sendTimers) clearTimeout(t);
    this.sendTimers.clear();
    if (worker) {
      worker.postMessage({ type: "stop" });
      void worker.terminate();
    }
    this.state = state;
    this.options.event({ type: "state", state });
  }
  fail(error: string) {
    this.stop("error");
    this.options.event({ type: "failure", error });
  }
}
