import type { Origin, Prepared } from "./source";
export type Node = { kind: string; loc: Origin; [key: string]: any };
export type Fn = {
  name: string;
  params: { name: string; type: string }[];
  body: Node;
  loc: Origin;
};
export type Program = {
  globals: Node[];
  functions: Record<string, Fn>;
  warnings: string[];
  includes: string[];
  nodeCount: number;
};
const aliases: Record<string, string> = {
  여기부터: "여기부터",
  main: "여기부터",
  정수: "int",
  문자: "char",
  글월: "str",
  만약: "if",
  아니면: "else",
  맴돌이: "while",
  여러번: "for",
  빠지기: "break",
  되돌리기: "return",
  계속: "continue",
  보내기: "보내기",
  asyncputs: "보내기",
  delay: "지연",
  strget: "글월받기",
  window_strget: "창문글월받기",
  puts: "글월쓰기",
  putchar: "글자쓰기",
  clrscr: "화면지우기",
};
export const builtinNames = new Set([
  "보내기",
  "정수보내기",
  "지연",
  "중지",
  "찾을글",
  "찾은글번호",
  "찾은글정리",
  "글마중",
  "제한글마중",
  "글마중제한시간",
  "strlen",
  "strcat",
  "strcpy",
  "strcmp",
  "strstr",
  "strchr",
  "strncmp",
  "strncpy",
  "atoi",
  "itoa",
  "abs",
  "절대값",
  "최소값",
  "최대값",
  "random",
  "창문글월받기",
  "글월받기",
  "갈무리끝",
  "글월쓰기",
  "글자쓰기",
  "지연알림",
  "알림",
  "중지알리기",
  "시간알기",
  "날짜알기",
  "carrier",
]);
type Token = { value: string; type: string; loc: Origin };
function lex(p: Prepared): Token[] {
  const out: Token[] = [];
  const s = p.text;
  let i = 0,
    line = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (c === "\n") line++;
      i++;
      continue;
    }
    const loc = p.origins[line] || { file: "소스", line: line + 1 };
    if (c === '"' || c === "'") {
      const q = c;
      let v = "";
      i++;
      let closed = false;
      while (i < s.length) {
        const ch = s[i++];
        if (ch === q) {
          closed = true;
          break;
        }
        if (ch === "\n")
          throw Error(`${loc.file}:${loc.line}: 문자열 안의 줄바꿈`);
        if (ch === "\\") {
          const e = s[i++];
          const escapes: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            "0": "\0",
            "\\": "\\",
            '"': '"',
            "'": "'",
          };
          if (e in escapes) v += escapes[e];
          else
            throw Error(
              `${loc.file}:${loc.line}: 지원하지 않는 이스케이프 \\${e}`,
            );
        } else v += ch;
      }
      if (v.includes("\ufffd"))
        throw Error(
          `${loc.file}:${loc.line}: 해독하지 못한 문자가 있습니다. 인코딩 또는 원본을 확인하세요.`,
        );
      if (!closed) throw Error(`${loc.file}:${loc.line}: 닫히지 않은 문자열`);
      out.push({
        value: q === "'" ? String(v.charCodeAt(0) || 0) : v,
        type: q === "'" ? "number" : "string",
        loc,
      });
      continue;
    }
    const num = s.slice(i).match(/^(?:0x[\da-f]+|\d+)/i);
    if (num) {
      out.push({ value: num[0], type: "number", loc });
      i += num[0].length;
      continue;
    }
    const id = s.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
    if (id) {
      out.push({ value: aliases[id[0]] || id[0], type: "id", loc });
      i += id[0].length;
      continue;
    }
    const op = s
      .slice(i)
      .match(
        /^(?:==|!=|<=|>=|&&|\|\||\+=|-=|\*=|\/=|%=|\+\+|--|[{}()[\];,+\-*\/%=<>!&|])/,
      );
    if (!op) throw Error(`${loc.file}:${loc.line}: 지원하지 않는 문자 ${c}`);
    out.push({ value: op[0], type: "op", loc });
    i += op[0].length;
    if (out.length > 300000) throw Error("소스 토큰 한도를 초과했습니다.");
  }
  out.push({
    value: "<eof>",
    type: "eof",
    loc: p.origins.at(-1) || { file: "소스", line: 1 },
  });
  return out;
}
export function compile(prepared: Prepared): Program {
  const tokens = lex(prepared);
  let at = 0,
    count = 0,
    depth = 0;
  const functions: Record<string, Fn> = Object.create(null);
  const globals: Node[] = [];
  const calls: Node[] = [];
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const err = (message: string, t = peek()): never => {
    throw Error(`${t.loc.file}:${t.loc.line}: ${message} (${t.value})`);
  };
  const accept = (s: string) => (peek().value === s ? (take(), true) : false);
  const need = (s: string) => {
    if (!accept(s)) err(`${s} 필요`);
  };
  const id = () => {
    if (peek().type !== "id") err("이름 필요");
    return take().value;
  };
  const node = (kind: string, loc: Origin, rest: any = {}): Node => {
    if (++count > 100000) err("구문 크기 한도 초과");
    return { kind, loc, ...rest };
  };
  const precedence: Record<string, number> = {
    "=": 1,
    "+=": 1,
    "-=": 1,
    "*=": 1,
    "/=": 1,
    "%=": 1,
    "||": 2,
    "&&": 3,
    "|": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "+": 8,
    "-": 8,
    "*": 9,
    "/": 9,
    "%": 9,
  };
  function expression(min = 1): Node {
    if (++depth > 200) err("표현식 중첩 한도 초과");
    const t = take();
    let left: Node;
    if (t.type === "number")
      left = node("literal", t.loc, { value: Number(t.value) });
    else if (t.type === "string")
      left = node("literal", t.loc, { value: t.value });
    else if (["!", "-", "+"].includes(t.value))
      left = node("unary", t.loc, { op: t.value, arg: expression(10) });
    else if (t.value === "(") {
      left = expression();
      need(")");
    } else if (t.type === "id") left = node("var", t.loc, { name: t.value });
    else err("표현식 필요", t);
    while (true) {
      if (accept("[")) {
        const index = expression();
        need("]");
        left = node("index", left!.loc, { base: left!, index });
        continue;
      }
      if (accept("(")) {
        if (left!.kind !== "var") err("함수 이름 필요");
        const args: Node[] = [];
        if (!accept(")")) {
          do {
            args.push(expression());
          } while (accept(","));
          need(")");
        }
        left = node("call", left!.loc, { name: left!.name, args });
        calls.push(left);
        continue;
      }
      if (["++", "--"].includes(peek().value)) {
        const op = take().value;
        left = node("postfix", left!.loc, { op, arg: left! });
        continue;
      }
      const op = peek().value,
        prec = precedence[op];
      if (!prec || prec < min) break;
      take();
      const right = expression(prec + (prec === 1 ? 0 : 1));
      left = node(prec === 1 ? "assign" : "binary", left!.loc, {
        op,
        left: left!,
        right,
      });
    }
    depth--;
    return left!;
  }
  function declaration(type: string, name?: string, semi = true): Node {
    const loc = peek().loc;
    const vars: any[] = [];
    do {
      const n = name || id();
      name = undefined;
      let size: Node | undefined, init: Node | undefined;
      if (accept("[")) {
        size = expression();
        need("]");
      }
      if (accept("=")) init = expression(2);
      vars.push({ name: n, type, size, init });
    } while (accept(","));
    if (semi) need(";");
    return node("declare", loc, { vars });
  }
  function statement(): Node {
    if (++depth > 200) err("문장 중첩 한도 초과");
    const n = statementInner();
    depth--;
    return n;
  }
  function statementInner(): Node {
    const t = peek();
    if (accept("{")) {
      const body: Node[] = [];
      while (!accept("}")) {
        if (peek().type === "eof") err("닫는 중괄호 필요");
        body.push(statement());
      }
      return node("block", t.loc, { body });
    }
    if (accept(";")) return node("empty", t.loc);
    if (["int", "str", "char"].includes(t.value)) {
      take();
      return declaration(t.value);
    }
    if (accept("if")) {
      need("(");
      const condition = expression();
      need(")");
      const yes = statement();
      const no = accept("else") ? statement() : undefined;
      return node("if", t.loc, { condition, yes, no });
    }
    if (accept("while")) {
      need("(");
      const condition = expression();
      need(")");
      return node("while", t.loc, { condition, body: statement() });
    }
    if (accept("for")) {
      need("(");
      let init: Node | undefined;
      if (peek().value !== ";") {
        if (["int", "str", "char"].includes(peek().value))
          init = declaration(take().value, undefined, false);
        else init = expression();
      }
      need(";");
      const condition = peek().value === ";" ? undefined : expression();
      need(";");
      const step = peek().value === ")" ? undefined : expression();
      need(")");
      return node("for", t.loc, { init, condition, step, body: statement() });
    }
    if (accept("break")) {
      need(";");
      return node("break", t.loc);
    }
    if (accept("continue")) {
      need(";");
      return node("continue", t.loc);
    }
    if (accept("return")) {
      const value = peek().value === ";" ? undefined : expression();
      need(";");
      return node("return", t.loc, { value });
    }
    const value = expression();
    need(";");
    return node("expr", t.loc, { value });
  }
  while (peek().type !== "eof") {
    if (accept(";")) continue;
    const loc = peek().loc;
    let type = "int";
    if (["int", "str", "char", "void"].includes(peek().value))
      type = take().value;
    const name = id();
    if (accept("(")) {
      const params: { name: string; type: string }[] = [];
      if (!accept(")")) {
        do {
          let pt = "str";
          if (["int", "str", "char", "void"].includes(peek().value))
            pt = take().value;
          if (pt === "void" && peek().value === ")") break;
          const pn = id();
          if (accept("[")) need("]");
          params.push({ name: pn, type: pt });
        } while (accept(","));
        need(")");
      }
      if (accept(";")) continue;
      if (functions[name]) err("중복 함수: " + name);
      const body = statement();
      if (body.kind !== "block") err("함수 본문 필요");
      functions[name] = { name, params, body, loc };
    } else globals.push(declaration(type, name));
  }
  if (!functions["여기부터"]) err("여기부터/main 진입 함수가 없습니다.");
  for (const c of calls) {
    if (!functions[c.name] && !builtinNames.has(c.name))
      throw Error(
        `${c.loc.file}:${c.loc.line}: 지원하지 않거나 정의되지 않은 함수 ${c.name}`,
      );
  }
  return {
    globals,
    functions,
    nodeCount: count,
    includes: prepared.includes,
    warnings: [
      ...prepared.warnings,
      "호환 프로필 v1: 시간 10ms 단위, 문구 목록 공백 구분/백틱 공백 치환. 원본 실행과 완전 동등성 미검증.",
    ],
  };
}
