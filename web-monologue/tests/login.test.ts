import { test } from "node:test";
import assert from "node:assert/strict";
import { Login } from "../src/login";

test("암호 오류 안내와 일반 명령 프롬프트를 로그인 성공으로 판단하지 않는다", () => {
  for (const message of [
    "암호가 맞지 않습니다. 다시 입력하세요 > ",
    "비밀번호가 일치하지 않습니다. > ",
    "추가 인증 정보를 입력하세요 > ",
  ]) {
    const sent: string[] = [];
    const login = new Login("캐릭터", "secret", (text) => sent.push(text));
    login.start();
    login.feed("이름을 입력하세요: ");
    login.feed("암호를 입력하세요: ");
    login.feed(message);
    assert.notEqual(login.state, "ready", message);
    assert.deepEqual(sent, ["캐릭터", "secret"]);
  }
});

test("공지사항을 넘기는 엔터 두 번 이후 이름과 암호를 한 번씩 전송한다", () => {
  const sent: string[] = [];
  const login = new Login("캐릭터", "secret", (text) => sent.push(text));
  login.start();
  login.feed("[엔터를 누르");
  login.feed("세요. <안되면 X 치고 엔터>]");
  login.feed("자신의 캐릭터 이름을 넣으세요.\n이름은? ");
  login.feed("암");
  login.feed("호를 입력하세요: ");
  login.echo(true);
  login.feed("퇴마요새에 오신 것을 환영합니다!");
  assert.deepEqual(sent, ["", "", "캐릭터", "secret"]);
  assert.notEqual(login.state, "ready");
  login.feed("[리턴을 누르세요]");
  assert.deepEqual(sent, ["", "", "캐릭터", "secret", "", "광장"]);
  assert.equal(login.state, "ready");
});

test("공지 안내에 이름과 암호라는 단어가 있어도 먼저 엔터 두 번을 전송한다", () => {
  const sent: string[] = [];
  const login = new Login("캐릭터", "secret", (text) => sent.push(text));
  login.start();
  login.feed(
    "공지: 캐릭터 이름과 암호를 입력하기 전 공지를 확인하세요.\n[엔터를 누르세요.]",
  );
  assert.deepEqual(sent, ["", ""]);
  login.feed("공지사항\n[엔터를 누르세요.]");
  assert.deepEqual(sent, ["", ""]);
  login.feed("이름을 입력하세요: ");
  login.feed("암호를 입력하세요: ");
  assert.deepEqual(sent, ["", "", "캐릭터", "secret"]);
});

test("로그인 후 정확한 리턴 안내가 도착해야 리턴과 광장을 한 번씩 전송한다", () => {
  const sent: string[] = [];
  const login = new Login("캐릭터", "secret", (text) => {
    assert.notEqual(
      login.state,
      "ready",
      "초기 명령을 보내기 전에는 실행을 허용하지 않습니다.",
    );
    sent.push(text);
  });
  login.start();
  login.feed("이름은? ");
  login.feed("암호를 입력하세요: ");
  assert.deepEqual(sent, ["캐릭터", "secret"]);
  login.feed("로그인 완료. 접속 체크를 위해 리턴을 누르세요.");
  assert.deepEqual(sent, ["캐릭터", "secret"]);
  assert.equal(login.state, "waiting-return");
  login.confirm();
  assert.deepEqual(sent, ["캐릭터", "secret"]);
  login.feed("[리턴을 누");
  assert.deepEqual(sent, ["캐릭터", "secret"]);
  login.feed("르세요]");
  assert.deepEqual(sent, ["캐릭터", "secret", "", "광장"]);
  assert.equal(login.state, "ready");
  login.feed("환영합니다! 광장에 도착했습니다.");
  login.confirm();
  assert.deepEqual(sent, ["캐릭터", "secret", "", "광장"]);
});

test("수동 로그인 완료 확인도 리턴 안내를 기다리며 확인 버튼으로 대기를 건너뛰지 않는다", () => {
  const sent: string[] = [];
  const login = new Login("캐릭터", "secret", (text) => sent.push(text));
  login.start();
  login.manual();
  login.confirm();
  login.confirm();
  assert.deepEqual(sent, []);
  assert.equal(login.state, "waiting-return");
  login.feed("[리턴을 누르세요]");
  assert.deepEqual(sent, ["", "광장"]);
  assert.equal(login.state, "ready");
});

test("암호 전송 후 환영 문구 없이 리턴 안내가 오거나 같은 청크에 도착해도 처리한다", () => {
  for (const message of [
    "[리턴을 누르세요]",
    "환영합니다!\n[리턴을 누르세요]",
  ]) {
    const sent: string[] = [];
    const login = new Login("캐릭터", "secret", (text) => sent.push(text));
    login.start();
    login.feed("이름은? ");
    login.feed("암호를 입력하세요: ");
    login.feed(message);
    assert.deepEqual(sent, ["캐릭터", "secret", "", "광장"]);
    assert.equal(login.state, "ready");
  }
});

test("수동 로그인 중 먼저 받은 안내는 확인 시 사용하고 이전 접속의 안내는 재사용하지 않는다", () => {
  const sent: string[] = [];
  const login = new Login("캐릭터", "secret", (text) => sent.push(text));
  login.start();
  login.manual();
  login.feed("[리턴을 누르세요]");
  assert.deepEqual(sent, []);
  login.confirm();
  assert.deepEqual(sent, ["", "광장"]);
  login.offline();
  login.start();
  login.manual();
  login.confirm();
  assert.deepEqual(sent, ["", "광장"]);
  assert.equal(login.state, "waiting-return");
  login.feed("[리턴을 누르세요]");
  assert.deepEqual(sent, ["", "광장", "", "광장"]);
});
