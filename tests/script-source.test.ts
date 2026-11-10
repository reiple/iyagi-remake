import { test } from "node:test";
import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { decodeSource, preprocess } from "../src/script/source";
test("UTF8 CP949 Johab and disguised SCF", () => {
  assert.equal(decodeSource(Buffer.from("여기부터(){}")).text, "여기부터(){}");
  assert.equal(
    decodeSource(iconv.encode("여기부터(){}", "cp949")).text,
    "여기부터(){}",
  );
  assert.equal(decodeSource(Buffer.from([0x88, 0x61]), "johab").text, "가");
  assert.throws(() => decodeSource(Buffer.from(" Script File. Ver 7,0\x1a")));
});
test("Galmuri character words and malformed document", () => {
  const b = Buffer.concat([
    Buffer.from("(c) KSR Galmuri File 1,0"),
    Buffer.alloc(12),
    Buffer.from([4, 0, 35, 0, 0x61, 0x88, 10, 0]),
  ]);
  assert.equal(decodeSource(b).text, "#가\n");
  assert.throws(() =>
    decodeSource(Buffer.from("(c) KSR Galmuri File 1,0garbage")),
  );
});
test("preprocessor preserves macro string contents and expands safe includes", () => {
  const p = preprocess(
    '#포함 <I.H>\n#정의 N 3\n여기부터(){정수 a=N;보내기("N|");}',
    "test.scs",
    () => {
      throw Error("should use built in");
    },
  );
  assert.ok(p.text.includes("a=3"));
  assert.ok(p.text.includes('"N|"'));
  assert.throws(() => preprocess("#포함 <../secret.h>", "test.scs", () => ""));
});
