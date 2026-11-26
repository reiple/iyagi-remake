import iconv from "iconv-lite";

// The Iyagi palette uses DOS color order. Color 7 restores the terminal default.
const foregroundSgr = [
  30, 34, 32, 36, 31, 35, 33, 39, 90, 94, 92, 96, 91, 95, 93, 97,
];

export function legacyForegroundColor(value: string): number | undefined {
  const color = Number(value);
  if (color === 114) return 14;
  if (foregroundSgr[color] !== undefined) return color;
}

export function encodeCommand(text: string, encoding: string): Buffer {
  const parts: Buffer[] = [];
  let start = 0;
  for (const match of text.matchAll(/\x9b=(\d{1,3})F/g)) {
    const color = legacyForegroundColor(match[1]);
    if (color === undefined) continue;
    parts.push(
      iconv.encode(text.slice(start, match.index), encoding),
      Buffer.from(`\x9b=${color}F`, "latin1"),
    );
    start = match.index + match[0].length;
  }
  parts.push(iconv.encode(text.slice(start), encoding));
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}

const sequence = /(\x1b\[|\x9b)=(\d{1,3})F/g;
const partial = /(?:\x1b\[?|\x9b|(?:\x1b\[|\x9b)=\d{0,3})(?![\s\S])/;

export class LegacyAnsiDecoder {
  private readonly decoder: iconv.DecoderStream;
  private pending = Buffer.alloc(0);

  constructor(private readonly encoding: string) {
    this.decoder = iconv.getDecoder(encoding);
  }

  write(chunk: Buffer): string {
    const data = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : chunk;
    const wire = data.toString("latin1");
    const end = partial.exec(wire)?.index ?? wire.length;
    this.pending = Buffer.from(data.subarray(end));
    let output = "";
    let start = 0;
    for (const match of wire.slice(0, end).matchAll(sequence)) {
      const next = match.index + match[0].length;
      const text = this.decoder.write(data.subarray(start, next));
      start = next;
      const color = legacyForegroundColor(match[2]);
      const expected =
        match[1] === "\x9b" ? "\ufffd" + match[0].slice(1) : match[0];
      // A C1 byte used as a valid CP949 or UTF-8 trail decodes as part of its character.
      if (color !== undefined && text.endsWith(expected)) {
        output +=
          text.slice(0, -expected.length) + `\x1b[${foregroundSgr[color]}m`;
      } else {
        output += text;
      }
    }
    output += this.decoder.write(data.subarray(start, end));
    if (
      data[end] === 0x9b &&
      (this.encoding === "cp949" || this.encoding === "utf8")
    ) {
      const csi = this.decoder.write(data.subarray(end, end + 1));
      // Release a complete glyph immediately when the potential CSI is its trailing byte.
      if (this.encoding === "cp949") {
        if (this.decoder.end()) return output + csi;
      } else if (csi.endsWith("\ufffd")) {
        return output + csi.slice(0, -1);
      }
      this.pending = Buffer.alloc(0);
      output += csi + this.decoder.write(data.subarray(end + 1));
    }
    return output;
  }

  end(): string {
    const text = this.decoder.write(this.pending);
    this.pending = Buffer.alloc(0);
    return text + (this.decoder.end() ?? "");
  }
}
