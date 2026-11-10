import iconv from "iconv-lite";
import table from "./johab.json";
export type Encoding = "auto" | "utf8" | "cp949" | "johab";
export type Origin = { file: string; line: number };
export type Prepared = {
  text: string;
  origins: Origin[];
  includes: string[];
  warnings: string[];
};
const johab = table as Record<string, string>;
export function decodeSource(
  bytes: Buffer,
  encoding: Encoding = "auto",
): { text: string; format: string } {
  if (bytes.length > 2 * 1024 * 1024)
    throw Error("소스 파일은 최대 2MB입니다.");
  const head = bytes.subarray(0, 100).toString("latin1");
  if (head.includes("Script File."))
    throw Error("이미 번역된 SCF 바이너리입니다. SCS 원본 소스가 필요합니다.");
  const decodeJohab = (b: Buffer) => {
    let s = "";
    for (let i = 0; i < b.length; i++) {
      if (b[i] < 128) s += String.fromCharCode(b[i]);
      else {
        if (i + 1 >= b.length) throw Error("불완전한 조합형 문자입니다.");
        const c = johab[String(b[i] * 256 + b[++i])];
        if (!c) {
          if (b[i - 1] === 155) {
            s += "\x9b";
            i--;
          } else s += "\ufffd";
        } else s += c;
      }
    }
    return s;
  };
  if (head.startsWith("(c) KSR Galmuri File")) {
    const raw = bytes.toString("latin1");
    const marks = [...raw.matchAll(/\x00{12}\x04\x00/g)];
    if (!marks.length) throw Error("지원하지 않거나 손상된 갈무리 문서입니다.");
    let text = "";
    for (let j = 0; j < marks.length; j++) {
      const start = marks[j].index! + 14,
        end = j + 1 < marks.length ? marks[j + 1].index! : bytes.length;
      const out: number[] = [];
      if ((end - start) % 2)
        throw Error("갈무리 문서 레코드 길이가 잘못되었습니다.");
      for (let i = start; i + 1 < end; i += 2) {
        const v = bytes.readUInt16LE(i);
        if (!v) continue;
        if (v < 128) out.push(v);
        else out.push(v >> 8, v & 255);
      }
      text += decodeJohab(Buffer.from(out));
    }
    return { text, format: "KSR Galmuri / 조합형" };
  }
  if (encoding === "johab")
    return { text: decodeJohab(bytes), format: "조합형" };
  if (encoding === "cp949")
    return { text: iconv.decode(bytes, "cp949"), format: "CP949" };
  if (encoding === "utf8")
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      format: "UTF-8",
    };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      format: "UTF-8",
    };
  } catch {}
  const candidates = [{ text: iconv.decode(bytes, "cp949"), format: "CP949" }];
  try {
    candidates.push({ text: decodeJohab(bytes), format: "조합형" });
  } catch {}
  const score = (s: string) =>
    (s.match(/여기부터|보내기|정수|글월|만약|포함|정의|지연|맴돌이/g) || [])
      .length *
      10 -
    (s.match(/\ufffd/g) || []).length * 10;
  candidates.sort((a, b) => score(b.text) - score(a.text));
  return candidates[0];
}
export function preprocess(
  source: string,
  file: string,
  resolve: (
    name: string,
    from: string,
  ) => string | { text: string; file: string },
): Prepared {
  const macros = new Map<string, string>();
  const origins: Origin[] = [];
  const includes: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];
  let total = 0;
  let expansionSteps=0,expandedTotal=0,macroTotal=0;
  const expand=(line:string,depth=0):string=>{
    if(depth>15)throw Error("매크로 순환/깊이 한도 초과");
    if(line.length>65536)throw Error("매크로 크기 한도 초과");
    const parts:string[]=[];let length=0,last=0;
    const append=(value:string)=>{length+=value.length;if(length>65536)throw Error("매크로 크기 한도 초과");parts.push(value);};
    for(const m of line.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}_][\p{L}\p{N}_]*/gu)){
      if(++expansionSteps>1000000)throw Error("매크로 처리량 한도 초과");
      append(line.slice(last,m.index));append(macros.has(m[0])?expand(macros.get(m[0])!,depth+1):m[0]);last=m.index!+m[0].length;
    }
    append(line.slice(last));return parts.join("");
  };
  const visit = (text: string, name: string, stack: string[]) => {
    if (stack.length > 16 || stack.includes(name))
      throw Error("헤더 포함이 순환하거나 너무 깊습니다: " + name);
    total += text.length;
    if (total > 2 * 1024 * 1024) throw Error("포함된 소스가 너무 큽니다.");
    let inComment = false;
    for (const [idx, original] of text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .entries()) {
      let clean = "";
      let quote = "";
      for (let i = 0; i < original.length; i++) {
        const c = original[i],
          n = original[i + 1];
        if (inComment) {
          if (c === "*" && n === "/") {
            inComment = false;
            i++;
          }
          continue;
        }
        if (quote) {
          clean += c;
          if (c === "\\" && n) {
            clean += n;
            i++;
          } else if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          clean += c;
        } else if (c === "/" && n === "/") break;
        else if (c === "/" && n === "*") {
          clean += " ";
          inComment = true;
          i++;
        } else clean += c;
      }
      const inc = clean.match(/^\s*#(?:포함|include)\s*[<"]([^>"]+)[>"]\s*$/u);
      if (inc) {
        const h = inc[1];
        if (!/^[\p{L}\p{N}_. -]+\.h$/iu.test(h) || h.includes(".."))
          throw Error(
            `${name}:${idx + 1}: 헤더는 단순 .H 파일 이름이어야 합니다.`,
          );
        if (["i.h", "english.h"].includes(h.toLowerCase())) {
          includes.push("내장 호환 헤더: " + h);
          continue;
        }
        const r = resolve(h, name);
        const item = typeof r === "string" ? { text: r, file: h } : r;
        includes.push(item.file);
        visit(item.text, item.file, [...stack, name]);
        continue;
      }
      const def = clean.match(
        /^\s*#(?:정의|define)\s+([\p{L}_][\p{L}\p{N}_]*)\s*(.*)$/u,
      );
      if (def) {
        const value=expand(def[2]);macroTotal+=value.length-(macros.get(def[1])?.length||0);if(macroTotal>2*1024*1024)throw Error("매크로 저장량 한도 초과");macros.set(def[1], value);
        continue;
      }
      const und = clean.match(/^\s*#(?:해제|undef)\s+(\S+)\s*$/u);
      if (und) {
        macros.delete(und[1]);
        continue;
      }
      if (clean.trimStart().startsWith("#"))
        throw Error(`${name}:${idx + 1}: 지원하지 않는 전처리 지시문`);
      const expanded = expand(clean);
      if (expanded.length > 65536)
        throw Error("매크로 확장 결과가 너무 큽니다.");
      expandedTotal+=expanded.length+1;if(expandedTotal>2*1024*1024)throw Error("번역 소스 크기 한도 초과");lines.push(expanded);
      origins.push({ file: name, line: idx + 1 });
    }
    if (inComment) throw Error(name + ": 닫히지 않은 주석");
  };
  visit(source, file, []);
  return {
    text: lines.join("\n"),
    origins,
    includes: [...new Set(includes)],
    warnings,
  };
}
