import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/script/compiler";
import { preprocess } from "../src/script/source";
const c = (s: string) => compile(preprocess(s, "test.scs", () => ""));
test("C and Korean functions arrays condition loops and assignment", () => {
  const p = c(
    '정수 n; 글월 a[3]; f(정수 x){되돌리기 x+1;} 여기부터(){for(n=0;n<3;n+=1){a[n]="가";} 만약(n==3 && f(1)==2) 보내기(a[0]+"|"); 아니면 중지();}',
  );
  assert.ok(p.functions["여기부터"]);
  assert.equal(p.globals.length, 2);
});
test("compiler rejects unknown calls and source-located syntax errors", () => {
  assert.throws(() => c('여기부터(){도스명령("x");}'), /도스명령/);
  assert.throws(() => c("여기부터(){\n 정수 a = ;\n}"), /test.scs:2/);
});
test("references and prototypes compile", () => {
  assert.ok(
    c('foo(); 여기부터(){글월 a;strcat(a,"가");foo();} foo(){중지();}'),
  );
});
test("unreadable characters and runaway macro expansion are rejected", () => {
  assert.throws(() => c('여기부터(){보내기("�|");}'), /문자/);
  assert.throws(
    () =>
      preprocess(
        "#정의 A " + "x ".repeat(40000) + "\n여기부터(){}",
        "test.scs",
        () => "",
      ),
    /크기|크거나|한도/,
  );
});
