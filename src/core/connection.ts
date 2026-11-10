import net from "node:net";
import { EventEmitter } from "node:events";
import iconv from "iconv-lite";
import { TelnetParser, escapeIac } from "./telnet";
export class Connection extends EventEmitter {
  socket?: net.Socket;
  parser = new TelnetParser();
  encoding = "cp949";
  connected = false;
  generation = 0;
  connect(host: string, port: number, encoding: string) {
    if (this.socket) this.disconnect();
    const id = ++this.generation;
    this.encoding = encoding;
    this.parser = new TelnetParser();
    const decoder = iconv.getDecoder(encoding);
    const s = net.createConnection({ host, port });
    this.socket = s;
    this.emit("status", "접속 중");
    s.setTimeout(10000);
    s.on("connect", () => {
      if (id !== this.generation) return;
      s.setTimeout(0);
      this.connected = true;
      this.emit("status", "연결됨");
    });
    s.on("timeout", () => s.destroy(Error("접속 시간이 초과되었습니다.")));
    s.on("data", (b) => {
      if (id !== this.generation) return;
      try {
        const old = this.parser.echo;
        const r = this.parser.feed(Buffer.isBuffer(b) ? b : Buffer.from(b));
        for (const reply of r.replies) s.write(reply);
        if (old !== this.parser.echo) this.emit("echo", this.parser.echo);
        const text = decoder.write(r.data);
        if (text) this.emit("data", text);
      } catch (e) {
        s.destroy(e as Error);
      }
    });
    s.on("error", (e) => {
      if (id === this.generation) this.emit("status", "오류: " + e.message);
    });
    s.on("close", () => {
      if (id !== this.generation) return;
      this.connected = false;
      this.socket = undefined;
      const tail = decoder.end();
      if (tail) this.emit("data", tail);
      this.emit("echo", false);
      this.emit("status", "연결 종료");
    });
  }
  send(text: string) {
    if (!this.connected || !this.socket) throw Error("먼저 서버에 연결하세요.");
    if (this.socket.writableLength > 1024 * 1024)
      throw Error("서버 전송 대기량이 너무 큽니다.");
    this.socket.write(escapeIac(iconv.encode(text + "\r\n", this.encoding)));
  }
  sendScriptByte(byte:number){
    if(!this.connected||!this.socket)throw Error("서버에 연결되어 있지 않습니다.");
    if(!Number.isInteger(byte)||byte<0||byte>255||this.socket.writableLength>1024*1024)throw Error("바이트 송신 제한");
    this.socket.write(escapeIac(Buffer.from([byte])));
  }
  sendScript(text: string) {
    if (!this.connected || !this.socket)
      throw Error("서버에 연결되어 있지 않습니다.");
    if (text.length > 65536 || this.socket.writableLength > 1024 * 1024)
      throw Error("송신 대기량 초과");
    this.socket.write(escapeIac(iconv.encode(text, this.encoding)));
  }
  resize(cols: number, rows: number) {
    const b = this.parser.resize(cols, rows);
    if (this.connected && b.length) this.socket?.write(b);
  }
  disconnect() {
    this.generation++;
    this.socket?.destroy();
    this.socket = undefined;
    this.connected = false;
    this.emit("echo", false);
    this.emit("status", "연결 종료");
  }
}
