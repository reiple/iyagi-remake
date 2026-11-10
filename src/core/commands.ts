export type Action = { text: string } | { delay: number };
export function expand(
  input: string,
  bindings: Record<string, string>,
  delay: number,
  stack: string[] = [],
): Action[] {
  if (input.length > 16000 || stack.length > 10)
    throw Error("매크로가 너무 큽니다.");
  const result: Action[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      result.push({ text });
      text = "";
    }
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "|") {
      flush();
      continue;
    }
    if (c !== "$") {
      text += c;
      continue;
    }
    if (input[i + 1] === "$") {
      text += "$";
      i++;
    } else if (input[i + 1] === ",") {
      flush();
      result.push({ delay });
      i++;
    } else {
      const m = input.slice(i).match(/^\$([AS](?:10|[1-9]))(?!\d)/);
      if (!m) {
        text += "$";
        continue;
      }
      flush();
      const key = m[1];
      if (stack.includes(key)) throw Error("매크로 순환 참조: " + key);
      result.push(
        ...expand(bindings[key] || "", bindings, delay, [...stack, key]),
      );
      i += m[0].length - 1;
    }
    if (result.length > 1000) throw Error("명령은 최대 1000개입니다.");
  }
  flush();
  if (result.length > 1000) throw Error("명령은 최대 1000개입니다.");
  if (!input) result.push({ text: "" });
  return result;
}
export class CommandQueue {
  pending: Action[] = [];
  timer: ReturnType<typeof setTimeout> | undefined;
  running = false;
  send: (s: string) => void;
  interval: number;
  constructor(send: (s: string) => void, interval = 150) {
    this.send = send;
    this.interval = interval;
  }
  enqueue(items: Action[]) {
    if (items.length + this.pending.length > 1000)
      throw Error("전송 대기열이 가득 찼습니다.");
    this.pending.push(...items);
    if (!this.running) this.next();
  }
  next = () => {
    const item = this.pending.shift();
    if (!item) {
      this.running = false;
      return;
    }
    this.running = true;
    try {
      if ("text" in item) this.send(item.text);
    } catch {
      this.stop();
      return;
    }
    this.timer = setTimeout(
      this.next,
      "delay" in item ? item.delay : this.interval,
    );
  };
  stop() {
    clearTimeout(this.timer);
    this.pending = [];
    this.running = false;
  }
}
export type Rule = {
  match: string;
  command: string;
  enabled: boolean;
  cooldown: number;
};
export class TriggerEngine {
  rules: Rule[];
  buffer = "";
  offset = 0;
  last = new Map<number, number>();
  ansi = 0;
  constructor(rules: Rule[] = []) {
    this.rules = rules;
  }
  reset() {
    this.buffer = "";
    this.offset = 0;
    this.last.clear();
    this.ansi = 0;
  }
  feed(chunk: string, now = Date.now()) {
    let plain = "";
    for (const c of chunk) {
      if (this.ansi === 0) {
        if (c === "\x1b") this.ansi = 1;
        else plain += c;
      } else if (this.ansi === 1) {
        this.ansi = c === "[" ? 2 : c === "]" ? 3 : 0;
      } else if (this.ansi === 2) {
        if (c >= "@" && c <= "~") this.ansi = 0;
      } else if (this.ansi === 3) {
        if (c === "\x07") this.ansi = 0;
        else if (c === "\x1b") this.ansi = 4;
      } else this.ansi = c === "\\" ? 0 : 3;
    }
    const boundary = this.buffer.length;
    this.buffer += plain;
    const commands: string[] = [];
    this.rules.forEach((r, i) => {
      if (!r.enabled || !r.match) return;
      let p = this.buffer.indexOf(
        r.match,
        Math.max(0, boundary - r.match.length + 1),
      );
      if (
        p >= 0 &&
        p + r.match.length > boundary &&
        now - (this.last.get(i) ?? -Infinity) >= r.cooldown
      ) {
        this.last.set(i, now);
        commands.push(r.command);
      }
    });
    this.buffer = this.buffer.slice(-8192);
    return commands;
  }
}
