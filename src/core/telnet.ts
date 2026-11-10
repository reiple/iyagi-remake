export class TelnetParser {
  state = 0;
  verb = 0;
  sub: number[] = [];
  echo = false;
  naws = false;
  cols = 100;
  rows = 30;
  local = new Set<number>();
  remote = new Set<number>();
  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    if (!this.naws) return Buffer.alloc(0);
    return Buffer.from([
      255,
      250,
      31,
      ...[cols >> 8, cols & 255, rows >> 8, rows & 255].flatMap((x) =>
        x === 255 ? [255, 255] : [x],
      ),
      255,
      240,
    ]);
  }
  feed(input: Buffer) {
    const out: number[] = [];
    const replies: Buffer[] = [];
    for (const b of input) {
      if (this.state === 0) {
        if (b === 255) this.state = 1;
        else out.push(b);
      } else if (this.state === 1) {
        if (b === 255) {
          out.push(b);
          this.state = 0;
        } else if ([251, 252, 253, 254].includes(b)) {
          this.verb = b;
          this.state = 2;
        } else if (b === 250) {
          this.sub = [];
          this.state = 3;
        } else this.state = 0;
      } else if (this.state === 2) {
        const accept =
          this.verb === 251 ? [1, 3].includes(b) : [3, 24, 31].includes(b);
        const set =
          this.verb === 251 || this.verb === 252 ? this.remote : this.local;
        if (this.verb === 251 || this.verb === 253) {
          if (!set.has(b)) {
            replies.push(
              Buffer.from([
                255,
                this.verb === 251 ? (accept ? 253 : 254) : accept ? 251 : 252,
                b,
              ]),
            );
            if (accept) set.add(b);
          }
          if (this.verb === 251 && b === 1) this.echo = true;
          if (this.verb === 253 && b === 31) {
            this.naws = true;
            replies.push(this.resize(this.cols, this.rows));
          }
        } else {
          if (set.delete(b))
            replies.push(Buffer.from([255, this.verb === 252 ? 254 : 252, b]));
          if (this.verb === 252 && b === 1) this.echo = false;
          if (this.verb === 254 && b === 31) this.naws = false;
        }
        this.state = 0;
      } else if (this.state === 3) {
        if (b === 255) this.state = 4;
        else if (this.sub.length < 8192) this.sub.push(b);
        else throw Error("Telnet 협상 데이터가 너무 큽니다.");
      } else if (this.state === 4) {
        if (b === 240) {
          if (this.sub[0] === 24 && this.sub[1] === 1 && this.local.has(24))
            replies.push(
              Buffer.from([255, 250, 24, 0, ...Buffer.from("XTERM"), 255, 240]),
            );
          this.state = 0;
        } else {
          if (b === 255) {
            if (this.sub.length >= 8192)
              throw Error("Telnet 협상 데이터가 너무 큽니다.");
            this.sub.push(255);
          }
          this.state = 3;
        }
      }
    }
    return { data: Buffer.from(out), replies };
  }
}
export const escapeIac = (b: Buffer) =>
  Buffer.from([...b].flatMap((x) => (x === 255 ? [255, 255] : [x])));
