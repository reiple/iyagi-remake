import assert from "node:assert/strict";
import { test } from "node:test";

const rendererModule = "../public/terminal-output.mjs";

test("terminal snapshots preserve ANSI foregrounds and reset to default", async () => {
  const { terminalOutputRuns } = await import(rendererModule);
  const colors = [
    30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97,
  ];
  assert.deepEqual(
    terminalOutputRuns(colors.map((code) => `\x1b[${code}m${code}`).join("")),
    colors.map((code) => ({ text: String(code), foreground: code })),
  );
  assert.deepEqual(
    terminalOutputRuns(
      "\x1b[1;93m노랑\r\n노랑\x1b[39m기본\x9b93m색\x1b[0m기본\x1b[93m색\x1b[m기본",
    ),
    [
      { text: "노랑\n노랑", foreground: 93 },
      { text: "기본", foreground: null },
      { text: "색", foreground: 93 },
      { text: "기본", foreground: null },
      { text: "색", foreground: 93 },
      { text: "기본", foreground: null },
    ],
  );
});

test("terminal snapshots strip command controls and keep markup as literal text", async () => {
  const { terminalOutputRuns } = await import(rendererModule);
  assert.deepEqual(
    terminalOutputRuns(
      "\x1b]0;window title\x07\x1b]8;;https://example.test\x1b\\" +
        "<b>&\r\n\t한글</b>\x00\x1b[2J\x1b[?25l\x1bPdiscard\x1b\\\x1b[3",
    ),
    [{ text: "<b>&\n\t한글</b>", foreground: null }],
  );
});

test("extended color parameters do not override the supported foreground", async () => {
  const { terminalOutputRuns } = await import(rendererModule);
  assert.deepEqual(
    terminalOutputRuns(
      "\x1b[93m노랑\x1b[38;05;91;48;2;0;39;94m유지\x1b[38:5:91m유지",
    ),
    [{ text: "노랑유지유지", foreground: 93 }],
  );
});
