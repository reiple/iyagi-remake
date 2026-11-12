import type { Rule } from "./commands";
export type Settings = {
  host: string;
  port: number;
  encoding: "cp949" | "utf8";
  commandPosition: "top" | "bottom";
  font: string;
  fontSize: number;
  interval: number;
  delay: number;
  bindings: Record<string, string>;
  buttons: { label: string; command: string }[];
  rules: Rule[];
  aliases: string[];
  shortcuts: Record<string, string>;
};
export function defaults(): Settings {
  return {
    host: "xmud.ddnsfree.com",
    port: 6666,
    encoding: "cp949",
    font: "D2Coding, Consolas, monospace",
    fontSize: 17,
    commandPosition: "bottom",
    interval: 150,
    delay: 500,
    bindings: {},
    buttons: Array.from({ length: 10 }, (_, i) => ({
      label: `단축 ${i + 1}`,
      command: "",
    })),
    rules: [],
    aliases: [],
    shortcuts: {},
  };
}
export function validateSettings(x: any): Settings {
  const fail = () => {
    throw Error("설정 값이 올바르지 않습니다.");
  };
  const str = (v: any, n: number) => typeof v === "string" && v.length <= n;
  const num = (v: any, a: number, b: number) =>
    Number.isInteger(v) && v >= a && v <= b;
  if (
    !x ||
    !str(x.host, 253) ||
    !x.host.trim() ||
    /[\s/\\]/.test(x.host) ||
    !num(x.port, 1, 65535) ||
    !["cp949", "utf8"].includes(x.encoding) ||
    !str(x.font, 200) ||
    !num(x.fontSize, 10, 40) ||
    !num(x.interval, 50, 10000) ||
    !num(x.delay, 50, 60000)
  )
    fail();
  if (
    !Array.isArray(x.buttons) ||
    x.buttons.length !== 10 ||
    x.buttons.some(
      (b: any) => !b || !str(b.label, 40) || !str(b.command, 16000),
    )
  )
    fail();
  if (
    !x.bindings ||
    Array.isArray(x.bindings) ||
    Object.keys(x.bindings).some(
      (k) => !/^([AS](10|[1-9]))$/.test(k) || !str(x.bindings[k], 16000),
    )
  )
    fail();
  if (
    !Array.isArray(x.rules) ||
    x.rules.length > 100 ||
    x.rules.some(
      (r: any) =>
        !r ||
        !str(r.match, 500) ||
        !r.match ||
        !str(r.command, 16000) ||
        typeof r.enabled !== "boolean" ||
        !num(r.cooldown, 500, 3600000),
    )
  )
    fail();
  if (
    !Array.isArray(x.aliases) ||
    x.aliases.length > 150 ||
    x.aliases.some((s: any) => !str(s, 1000))
  )
    fail();
  if (
    !x.shortcuts ||
    Object.entries(x.shortcuts).some(
      ([k, v]) => !/^([AS](10|[1-9]))$/.test(k) || !str(v, 60),
    )
  )
    fail();
  if (x.commandPosition !== undefined && !["top", "bottom"].includes(x.commandPosition)) fail();
  return JSON.parse(JSON.stringify({...x, commandPosition: x.commandPosition ?? "bottom"}));
}
