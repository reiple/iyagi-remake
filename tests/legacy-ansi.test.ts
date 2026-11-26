import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import {
  expandLegacyForeground,
  LegacyAnsiDecoder,
  legacyForegroundToSgr,
} from "../src/core/legacy-ansi.ts";

test("manual foreground escapes expand alongside literal command syntax", () => {
  assert.equal(
    expandLegacyForeground("말 $A1|$#155=114F노랑$#155=7F기본|$,|$$일반"),
    "말 $A1|\x9b=14F노랑\x9b=7F기본|$,|$$일반",
  );
});

test("escaped foreground tokens stay literal and invalid values pass through", () => {
  assert.equal(
    expandLegacyForeground("$$#155=114F|$#155=16F|$$#155=999F|$#155=14 F"),
    "$#155=114F|$#155=16F|$$#155=999F|$#155=14 F",
  );
});

test("local echo uses SGR for foreground bytes while preserving literal tokens", () => {
  assert.equal(
    legacyForegroundToSgr("\x9b=14F노랑\x9b=7F기본|$#155=14F"),
    "\x1b[93m노랑\x1b[39m기본|$#155=14F",
  );
});

test("a glyph ending in the C1 byte appears immediately in CP949 and UTF-8", () => {
  for (const [encoding, glyph] of [
    ["cp949", "븲"],
    ["utf8", "▛"],
  ]) {
    const decoder = new LegacyAnsiDecoder(encoding);
    assert.equal(decoder.write(iconv.encode(glyph, encoding)), glyph, encoding);
    assert.equal(decoder.write(Buffer.from("=14F")), "=14F", encoding);
  }
});

test("foreground codes can arrive one byte at a time", () => {
  for (const encoding of ["cp949", "utf8"]) {
    const decoder = new LegacyAnsiDecoder(encoding);
    const input = Buffer.concat([
      Buffer.from("\x9b=12F", "latin1"),
      iconv.encode("위험", encoding),
      Buffer.from("\x1b[=7F!"),
    ]);
    const output = [...input]
      .map((byte) => decoder.write(Buffer.from([byte])))
      .join("");
    assert.equal(output + decoder.end(), "\x1b[91m위험\x1b[39m!", encoding);
  }
});
