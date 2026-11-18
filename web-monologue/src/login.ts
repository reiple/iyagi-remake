export type LoginState =
  | "offline"
  | "waiting-name"
  | "waiting-password"
  | "verifying"
  | "waiting-return"
  | "ready"
  | "manual"
  | "failed";

const returnPrompt = /\[\s*리턴을\s+누르세요\s*\]/u;

export class Login {
  state: LoginState = "offline";
  private buffer = "";
  private entered = false;
  constructor(
    private name: string,
    private password: string,
    private send: (text: string) => void,
  ) {}
  start() {
    this.state = "waiting-name";
    this.buffer = "";
    this.entered = false;
  }
  feed(text: string) {
    if (["ready", "offline", "failed"].includes(this.state)) return;
    this.buffer = (this.buffer + text)
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .slice(-6000);
    if (
      /(?:암호|비밀번호|password).{0,30}(?:틀렸|틀립|잘못|맞지|일치하지|incorrect|invalid)|(?:존재하지 않는|없는)\s*(?:캐릭터|이름|계정)|접속.{0,20}거부/iu.test(
        this.buffer,
      )
    ) {
      this.state = "failed";
      this.buffer = "";
      return;
    }
    if (this.state === "waiting-name") {
      if (
        !this.entered &&
        /(?:enter|엔터|리턴|return).{0,40}(?:누르|눌러|치|키|press)|(?:press|hit).{0,20}(?:enter|return)/iu.test(
          this.buffer,
        )
      ) {
        this.entered = true;
        this.buffer = "";
        // The welcome screen and notices each consume one blank line.
        this.send("");
        this.send("");
        return;
      }
      if (
        /(?:이름|성명|아이디|계정|캐릭터|name|login).{0,50}(?:입력|무엇|넣으세요|주십시오|주세요|:|：|\?|？)|(?:입력|알려).{0,20}(?:이름|아이디)/iu.test(
          this.buffer,
        )
      ) {
        this.state = "waiting-password";
        this.buffer = "";
        this.send(this.name);
        return;
      }
    } else if (
      this.state === "waiting-password" &&
      /(?:암호|비밀\s*번호|password).{0,50}(?:입력|:|：|주십시오|주세요)/iu.test(
        this.buffer,
      )
    ) {
      this.state = "verifying";
      this.buffer = "";
      this.send(this.password);
    } else if (
      this.state === "verifying" &&
      (returnPrompt.test(this.buffer) ||
        /환영|어서\s*오|접속(?:이|에)?\s*(?:성공|완료)|로그인\s*(?:성공|완료)|welcome/iu.test(
          this.buffer,
        ))
    ) {
      this.confirm();
    } else if (this.state === "waiting-return") {
      this.finishIfRequested();
    }
  }
  echo(secret: boolean) {
    if (secret && this.state === "waiting-password") {
      this.state = "verifying";
      this.buffer = "";
      this.send(this.password);
    }
  }
  manual() {
    if (this.state === "ready" || this.state === "waiting-return") return;
    this.state = "manual";
    this.buffer = "";
  }
  confirm() {
    if (this.state === "ready") return;
    this.state = "waiting-return";
    this.finishIfRequested();
  }
  private finishIfRequested() {
    if (!returnPrompt.test(this.buffer)) return;
    this.buffer = "";
    // Both writes precede ready so scripts cannot overtake session setup.
    this.send("");
    this.send("광장");
    this.state = "ready";
  }
  offline() {
    this.state = "offline";
    this.buffer = "";
  }
}
