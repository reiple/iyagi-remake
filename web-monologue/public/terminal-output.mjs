const terminalControl = new RegExp(
  [
    // OSC and other control strings may be incomplete at the end of a snapshot.
    String.raw`(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)`,
    String.raw`(?:\x1b[P_X^]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|$)`,
    String.raw`(?:\x1b\[|\x9b)([0-?]*[ -/]*)([@-~]|$)`,
    String.raw`\x1b[ -/]*[0-~]`,
    String.raw`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]`,
  ].join("|"),
  "g",
);

function sgrForeground(parameters, foreground) {
  const fields = parameters.split(";");
  for (let index = 0; index < fields.length; index++) {
    const code = Number(fields[index]);
    if (code === 0 || code === 39) foreground = null;
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      foreground = code;
    } else if (code === 38 || code === 48 || code === 58) {
      // Indexed and RGB colors can contain numbers that look like SGR commands.
      const mode = Number(fields[index + 1]);
      if (mode === 5) index += 2;
      else if (mode === 2) index += 4;
    }
  }
  return foreground;
}

export function terminalOutputRuns(output) {
  const text = output.replace(/\r\n/g, "\n");
  const runs = [];
  let foreground = null;
  let start = 0;
  function append(end) {
    if (start === end) return;
    const previous = runs.at(-1);
    const content = text.slice(start, end);
    if (previous?.foreground === foreground) previous.text += content;
    else runs.push({ text: content, foreground });
  }
  for (const match of text.matchAll(terminalControl)) {
    append(match.index);
    const [, parameters, final] = match;
    if (final === "m" && /^[\d;:]*$/.test(parameters)) {
      foreground = sgrForeground(parameters, foreground);
    }
    start = match.index + match[0].length;
  }
  append(text.length);
  return runs;
}

export function renderTerminalOutput(container, output) {
  const runs = terminalOutputRuns(output);
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  for (const { text, foreground } of runs) {
    if (foreground === null) {
      fragment.append(document.createTextNode(text));
    } else {
      const span = document.createElement("span");
      span.className = `terminal-fg-${foreground}`;
      span.textContent = text;
      fragment.append(span);
    }
  }
  container.replaceChildren(fragment);
  return runs.length > 0;
}
