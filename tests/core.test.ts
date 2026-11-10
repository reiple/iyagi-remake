import { test } from "node:test";
import assert from "node:assert/strict";
import { TelnetParser } from "../src/core/telnet.ts";
import { expand, CommandQueue, TriggerEngine } from "../src/core/commands.ts";
import { defaults, validateSettings } from "../src/core/settings.ts";
test("Telnet fragmented negotiations and escaped bytes", () => {
  const bytes = Buffer.from([
    65, 255, 251, 1, 255, 253, 24, 255, 250, 24, 1, 255, 240, 255, 255, 66,
  ]);
  const a = new TelnetParser(),
    b = new TelnetParser();
  const all = a.feed(bytes);
  const parts = [...bytes].map((x) => b.feed(Buffer.from([x])));
  assert.deepEqual(Buffer.concat(parts.map((x) => x.data)), all.data);
  assert.deepEqual(
    Buffer.concat(parts.flatMap((x) => x.replies)),
    Buffer.concat(all.replies),
  );
  assert.deepEqual([...all.data], [65, 255, 66]);
  assert.equal(b.echo, true);
});
test("unknown options refused and NAWS escapes 255", () => {
  const p = new TelnetParser();
  assert.deepEqual(
    [...p.feed(Buffer.from([255, 253, 99])).replies[0]],
    [255, 252, 99],
  );
  p.feed(Buffer.from([255, 253, 31]));
  assert.ok(p.resize(255, 24).includes(Buffer.from([255, 255])));
});
test("macro expansion, escaping, delay and cycle bound", () => {
  assert.deepEqual(expand("a|$$|$A1", { A1: "b|$,c" }, 500), [
    { text: "a" },
    { text: "$" },
    { text: "b" },
    { delay: 500 },
    { text: "c" },
  ]);
  assert.throws(() => expand("$A1", { A1: "$A1" }, 500));
  assert.throws(() => expand("x|".repeat(1001), {}, 500));
});
test("queue stop cancels pending commands", async () => {
  const sent: string[] = [];
  const q = new CommandQueue((x) => sent.push(x), 20);
  q.enqueue([{ text: "a" }, { delay: 80 }, { text: "b" }]);
  q.stop();
  await new Promise((r) => setTimeout(r, 110));
  assert.deepEqual(sent, ["a"]);
});
test("trigger chunks, ANSI and cooldown", () => {
  const t = new TriggerEngine([
    { match: "위험", command: "회복", enabled: true, cooldown: 100 },
  ]);
  assert.deepEqual(t.feed("\x1b[31m위", 0), []);
  assert.deepEqual(t.feed("험", 1), ["회복"]);
  assert.deepEqual(t.feed("!", 2), []);
  assert.deepEqual(t.feed("위험", 5), []);
  assert.deepEqual(t.feed("위험", 102), ["회복"]);
  t.reset();
  assert.deepEqual(t.feed("험", 200), []);
});
test("settings reject dangerous values", () => {
  assert.equal(validateSettings(defaults()).port, 6666);
  assert.throws(() => validateSettings({ ...defaults(), port: 0 }));
  assert.throws(() => validateSettings({ ...defaults(), encoding: "bad" }));
});
test("escaped subnegotiation is bounded", () => {
  const p = new TelnetParser();
  assert.throws(() =>
    p.feed(Buffer.from([255, 250, 24, ...Array(18000).fill(255)])),
  );
});
