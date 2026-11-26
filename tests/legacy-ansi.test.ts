import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import { LegacyAnsiDecoder } from "../src/core/legacy-ansi.ts";

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
