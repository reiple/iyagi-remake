import {expandTransmit} from "./transmit";
import type { Node, Program } from "./compiler";
import type { Origin } from "./source";
type Value = number | string | Value[];
type Cell = { value: Value };
type Env = Map<string, Cell>;
export type Host = {
  send: (text: string) => Promise<void>;
  sendByte?: (byte:number)=>Promise<void>;
  output?: (text: string) => void | Promise<void>;
  input?: (prompt: string, max: number) => Promise<string>;
  logEnd?: () => void | Promise<void>;
  location?: (loc: Origin) => void;
};
class Halt extends Error {}
class Flow {
  constructor(
    public kind: string,
    public value: Value = 0,
  ) {}
}
export class Runtime {
  globals: Env = new Map();
  stopped = false;
  paused = false;
  instructions = 0;
  calls = 0;
  allocated = 0;
  buffer = "";
  patterns: string[] = [];
  patternTail = "";
  found = 0;
  ansi = 0;
  waitTime = 8000;
  loc: Origin = { file: "소스", line: 1 };
  lastLocation = 0;
  program: Program;
  host: Host;
  constructor(program: Program, host: Host) {
    this.program = program;
    this.host = host;
  }
  stop() {
    this.stopped = true;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  async tick(loc?: Origin) {
    if (loc) this.loc = loc;
    if (this.stopped) throw new Halt();
    while (this.paused) {
      await new Promise((r) => setTimeout(r, 10));
      if (this.stopped) throw new Halt();
    }
    if (++this.instructions % 512 === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (this.stopped) throw new Halt();
    }
    if (Date.now() - this.lastLocation > 100) {
      this.lastLocation = Date.now();
      this.host.location?.(this.loc);
    }
  }
  async sleep(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 86400000)
      throw Error("대기 시간 범위 초과");
    let remaining = ms;
    while (remaining > 0) {
      await this.tick();
      const start = Date.now();
      await new Promise((r) => setTimeout(r, Math.min(remaining, 10)));
      if (!this.paused) remaining -= Date.now() - start;
    }
    await this.tick();
  }
  feed(text: string) {
    let s = "";
    for (const c of text) {
      if (!this.ansi) {
        if (c === "\x1b") this.ansi = 1;
        else if (c === "\x9b") this.ansi = 2;
        else s += c;
      } else if (this.ansi === 1) this.ansi = c === "[" ? 2 : c === "]" ? 3 : 0;
      else if (this.ansi === 2) {
        if (c >= "@" && c <= "~") this.ansi = 0;
      } else if (this.ansi === 3) {
        if (c === "\x07") this.ansi = 0;
        else if (c === "\x1b") this.ansi = 4;
      } else this.ansi = c === "\\" ? 0 : 3;
    }
    this.buffer = (this.buffer + s).slice(-65536);
    const old = this.patternTail.length;
    this.patternTail += s;
    if (!this.found) {
      let earliest = Infinity;
      this.patterns.forEach((p, i) => {
        const at = this.patternTail.indexOf(p, Math.max(0, old - p.length + 1));
        if (at >= 0 && at + p.length > old && at < earliest) {
          earliest = at;
          this.found = i + 1;
        }
      });
    }
    this.patternTail = this.patternTail.slice(-4096);
  }
  str(v: Value): string {
    if (Array.isArray(v)) {
      let s = "";
      for (const c of v) {
        if (!c) break;
        s += typeof c === "number" ? String.fromCharCode(c) : String(c);
      }
      return s;
    }
    return String(v);
  }
  num(v: Value) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw Error("유효하지 않은 숫자");
    return Math.trunc(n);
  }
  truth(v: Value) {
    return typeof v === "string" ? v.length > 0 : !!v;
  }
  checked(v: Value): Value {
    if (typeof v === "string" && v.length > 65536)
      throw Error("문자열은 최대 65536자입니다.");
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("수치 범위 초과");
    return v;
  }
  cell(name: string, env: Env): Cell {
    const c = env.get(name) || this.globals.get(name);
    if (!c) throw Error("정의되지 않은 변수: " + name);
    return c;
  }
  async reference(
    n: Node,
    env: Env,
  ): Promise<{ get: () => Value; set: (v: Value) => void }> {
    if (n.kind === "var") {
      const c = this.cell(n.name, env);
      return {
        get: () => c.value,
        set: (v) => {
          c.value = this.checked(v);
        },
      };
    }
    if (n.kind === "index") {
      const base = await this.reference(n.base, env),
        v = base.get();
      const i = this.num(await this.eval(n.index, env));
      if (!Array.isArray(v) || i < 0 || i >= v.length)
        throw Error("배열 인덱스 범위 초과");
      return {
        get: () => v[i],
        set: (x) => {
          v[i] = this.checked(x);
        },
      };
    }
    throw Error("값을 저장할 변수 또는 배열 원소가 필요합니다.");
  }
  async eval(n: Node, env: Env): Promise<Value> {
    await this.tick(n.loc);
    switch (n.kind) {
      case "literal":
        return n.value;
      case "var":
        if (["TRUE", "참"].includes(n.name)) return 1;
        if (["FALSE", "거짓"].includes(n.name)) return 0;
        return this.cell(n.name, env).value;
      case "index":
        return (await this.reference(n, env)).get();
      case "call":
        return this.call(n.name, n.args, env);
      case "unary": {
        const v = await this.eval(n.arg, env);
        return n.op === "!"
          ? +!this.truth(v)
          : n.op === "-"
            ? -this.num(v)
            : this.num(v);
      }
      case "postfix": {
        const r = await this.reference(n.arg, env),
          v = this.num(r.get());
        r.set(v + (n.op === "++" ? 1 : -1));
        return v;
      }
      case "assign": {
        const r = await this.reference(n.left, env);
        const right = await this.eval(n.right, env);
        const v = n.op === "=" ? right : this.binary(n.op[0], r.get(), right);
        r.set(v);
        return v;
      }
      case "binary": {
        const l = await this.eval(n.left, env);
        if (n.op === "&&" && !this.truth(l)) return 0;
        if (n.op === "||" && this.truth(l)) return 1;
        return this.binary(n.op, l, await this.eval(n.right, env));
      }
      default:
        throw Error("지원하지 않는 표현식: " + n.kind);
    }
  }
  binary(op: string, l: Value, r: Value): Value {
    if (op === "==") return +(l === r);
    if (op === "!=") return +(l !== r);
    if (op === "+")
      return this.checked(
        typeof l === "string" || typeof r === "string"
          ? this.str(l) + this.str(r)
          : this.num(l) + this.num(r),
      );
    const a = this.num(l),
      b = this.num(r);
    switch (op) {
      case "-":
        return a - b;
      case "*":
        return this.checked(a * b);
      case "/":
        if (!b) throw Error("0으로 나눌 수 없습니다.");
        return Math.trunc(a / b);
      case "%":
        if (!b) throw Error("0으로 나눌 수 없습니다.");
        return a % b;
      case "<":
        return +(a < b);
      case ">":
        return +(a > b);
      case "<=":
        return +(a <= b);
      case ">=":
        return +(a >= b);
      case "&&":
        return +(this.truth(l) && this.truth(r));
      case "||":
        return +(this.truth(l) || this.truth(r));
      case "&":
        return a & b;
      case "|":
        return a | b;
      default:
        throw Error("지원하지 않는 연산자: " + op);
    }
  }
  async exec(n: Node, env: Env): Promise<void> {
    await this.tick(n.loc);
    switch (n.kind) {
      case "empty":
        return;
      case "block":
        for (const s of n.body) await this.exec(s, env);
        return;
      case "declare":
        for (const v of n.vars) {
          const previous=env.get(v.name)?.value;if(Array.isArray(previous))this.allocated-=previous.length;
          let value: Value = v.type === "str" ? "" : 0;
          if (v.size) {
            const size = this.num(await this.eval(v.size, env));
            if (size < 1 || size > 10000 || this.allocated + size > 100000)
              throw Error("배열 크기 한도 초과");
            this.allocated += size;
            value = Array(size).fill(value);
          }
          if (v.init) value = await this.eval(v.init, env);
          env.set(v.name, { value: this.checked(value) });
        }
        return;
      case "expr":
        await this.eval(n.value, env);
        return;
      case "if":
        if (this.truth(await this.eval(n.condition, env)))
          await this.exec(n.yes, env);
        else if (n.no) await this.exec(n.no, env);
        return;
      case "for":
      case "while":
        if (n.init) {
          if (n.init.kind === "declare") await this.exec(n.init, env);
          else await this.eval(n.init, env);
        }
        while (!n.condition || this.truth(await this.eval(n.condition, env))) {
          try {
            await this.exec(n.body, env);
          } catch (e) {
            if (e instanceof Flow && e.kind === "break") break;
            if (!(e instanceof Flow && e.kind === "continue")) throw e;
          }
          if (n.step) await this.eval(n.step, env);
          await this.tick(n.loc);
        }
        return;
      case "break":
      case "continue":
        throw new Flow(n.kind);
      case "return":
        throw new Flow("return", n.value ? await this.eval(n.value, env) : 0);
      default:
        throw Error("지원하지 않는 문장: " + n.kind);
    }
  }
  async call(name: string, args: Node[], env: Env): Promise<Value> {
    if (++this.calls > 128)
      throw Error("함수 호출 깊이 한도(128)를 초과했습니다.");
    try {
      const fn = this.program.functions[name];
      if (fn) {
        if (fn.params.length !== args.length)
          throw Error(name + ": 인자 수가 다릅니다.");
        const local: Env = new Map();
        const before = this.allocated;
        for (let i = 0; i < args.length; i++) {
          const param = fn.params[i];
          if (param.type === "str" && ["var", "index"].includes(args[i].kind)) {
            const ref = await this.reference(args[i], env);
            const c = {} as Cell;
            Object.defineProperty(c, "value", { get: ref.get, set: ref.set });
            local.set(param.name, c);
          } else
            local.set(param.name, { value: await this.eval(args[i], env) });
        }
        try {
          await this.exec(fn.body, local);
          return 0;
        } catch (e) {
          if (e instanceof Flow && e.kind === "return") return e.value;
          throw e;
        } finally {
          this.allocated = before;
        }
      }
      return await this.builtin(name, args, env);
    } finally {
      this.calls--;
    }
  }
  async waitFor(pattern: string, units: number) {
    if (!pattern || pattern.length > 4096) throw Error("대기 문구 길이 오류");
    let remaining = units * 10;
    if (remaining < 0 || remaining > 86400000)
      throw Error("대기 시간 범위 초과");
    do {
      await this.tick();
      const at = this.buffer.indexOf(pattern);
      if (at >= 0) {
        this.buffer = this.buffer.slice(at + pattern.length);
        return 1;
      }
      await this.sleep(Math.min(10, remaining));
      remaining -= 10;
    } while (remaining > 0);
    return 0;
  }
  async builtin(name: string, args: Node[], env: Env): Promise<Value> {
    const values: Value[] = [];
    for (const a of args) values.push(await this.eval(a, env));
    const s = (i = 0) => this.str(values[i] ?? "");
    const n = (i = 0) => this.num(values[i] ?? 0);
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max)
        throw Error(name + ": 인자 수가 올바르지 않습니다.");
    };
    const set = async (i: number, value: string) => {
      if (!args[i]) throw Error("대상 변수 필요");
      const ref = await this.reference(args[i], env);
      const old = ref.get();
      if (Array.isArray(old)) {
        if (value.length >= old.length) throw Error("문자 배열 용량 초과");
        value.split("").forEach((c, j) => (old[j] = c.charCodeAt(0)));
        old[value.length] = 0;
      } else ref.set(value);
    };
    switch (name) {
      case "보내기":
      case "정수보내기": {
        arity(1);
        const actions=expandTransmit(name === "정수보내기" ? String(n()) : s());
        for(const action of actions){await this.tick();if("text" in action)await this.host.send(action.text);else {if(!this.host.sendByte)throw Error("바이트 송신 기능이 없습니다.");await this.host.sendByte(action.byte);}}
        return 0;
      }
      case "지연":
        arity(1);
        await this.sleep(n() * 10);
        return 0;
      case "중지":
        arity(0);
        throw new Halt();
      case "찾을글":
        arity(1);
        this.patterns = s()
          .split(/\s+/)
          .filter(Boolean)
          .map((x) => x.replace(/`/g, " "));
        if (
          this.patterns.length > 128 ||
          this.patterns.some((p) => p.length > 4096)
        )
          throw Error("감지 문구 한도 초과");
        this.found = 0;
        this.patternTail = "";
        return 0;
      case "찾은글번호":
        arity(0);
        return this.found;
      case "찾은글정리":
        arity(0);
        this.found = 0;
        this.patternTail = "";
        return 0;
      case "글마중제한시간":
        arity(1);
        if (n() < 0 || n() > 8640000) throw Error("시간 범위 초과");
        this.waitTime = n();
        return 0;
      case "글마중":
        arity(1);
        return this.waitFor(s(), this.waitTime);
      case "제한글마중":
        arity(2);
        return this.waitFor(s(), n(1));
      case "strlen":
        arity(1);
        return s().length;
      case "strcat":
        arity(2);
        await set(0, s() + s(1));
        return this.checked(s() + s(1));
      case "strcpy":
        arity(2);
        await set(0, s(1));
        return s(1);
      case "strncpy":
        arity(3);
        await set(0, s(1).slice(0, Math.max(0, n(2))));
        return s(1).slice(0, Math.max(0, n(2)));
      case "strcmp":
        arity(2);
        return s() === s(1) ? 0 : s() < s(1) ? -1 : 1;
      case "strncmp":
        arity(3);
        return s().slice(0, n(2)) === s(1).slice(0, n(2))
          ? 0
          : s().slice(0, n(2)) < s(1).slice(0, n(2))
            ? -1
            : 1;
      case "strstr":
        arity(2);
        {
          const at = s().indexOf(s(1));
          return at < 0 ? "" : s().slice(at);
        }
      case "strchr":
        arity(2);
        {
          const at = s().indexOf(
            typeof values[1] === "number" ? String.fromCharCode(n(1)) : s(1),
          );
          return at < 0 ? "" : s().slice(at);
        }
      case "atoi":
        arity(1);
        return Number.parseInt(s(), 10) || 0;
      case "itoa":
        arity(1);
        return String(n());
      case "abs":
      case "절대값":
        arity(1);
        return Math.abs(n());
      case "최소값":
        arity(2);
        return Math.min(n(), n(1));
      case "최대값":
        arity(2);
        return Math.max(n(), n(1));
      case "random":
        arity(1);
        if (n() < 1) throw Error("난수 범위 오류");
        return Math.floor(Math.random() * n());
      case "srand":
      case "randomize":
        throw Error("지원하지 않는 난수 시드 함수: " + name);
      case "창문글월받기":
      case "글월받기": {
        const idx = name === "창문글월받기" ? 3 : 2;
        arity(name === "창문글월받기" ? 5 : 4);
        if (!this.host.input)
          throw Error("입력 대화상자를 사용할 수 없습니다.");
        const max = n(idx + 1);
        if (max < 1 || max > 1000) throw Error("입력 길이 범위 초과");
        const response = await this.host.input(
          name === "창문글월받기" ? s(2) : "혼잣말 입력",
          max,
        );
        await this.tick();
        await set(idx, response.slice(0, max));
        return response.length;
      }
      case "갈무리끝":
        arity(0);
        await this.host.logEnd?.();
        return 0;
      case "글월쓰기":
      case "글자쓰기":
        arity(1);
        await this.host.output?.(
          name === "글자쓰기" ? String.fromCharCode(n()) : s(),
        );
        return 0;
      case "알림":
      case "중지알리기":
        arity(1);
        await this.host.output?.(s());
        if (name === "중지알리기") throw new Halt();
        return 0;
      case "지연알림":
        arity(2);
        await this.host.output?.(s());
        await this.sleep(n(1) * 10);
        return 0;
      case "날짜알기":
        arity(0);
        return new Date().toLocaleDateString("sv-SE");
      case "시간알기":
        arity(0);
        return new Date().toTimeString().slice(0, 8);
      case "carrier":
        arity(0);
        return 1;
      default:
        throw Error("지원하지 않는 함수: " + name);
    }
  }
  async run() {
    try {
      for (const g of this.program.globals) await this.exec(g, this.globals);
      await this.call("여기부터", [], new Map());
    } catch (e) {
      if (e instanceof Halt) return;
      if (e instanceof Flow)
        throw Error(`${this.loc.file}:${this.loc.line}: 반복문 밖의 ${e.kind}`);
      throw Error(
        `${this.loc.file}:${this.loc.line}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.stopped = true;
    }
  }
}
