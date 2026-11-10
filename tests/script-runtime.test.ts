import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/script/compiler";
import { preprocess } from "../src/script/source";
import { Runtime } from "../src/script/runtime";
const program = (s: string) => compile(preprocess(s, "test.scs", () => ""));
test("reference mutation, globals arrays and partial transmit", async () => {
  const sent: string[] = [];
  const r = new Runtime(
    program(
      '글월 a[2]; f(글월 s){strcat(s,"나");} 여기부터(){글월 x="가"; f(x); a[0]=x;보내기("|");보내기(a[0]);정수보내기(3);보내기("||");}',
    ),
    {
      send: async (s) => {
        sent.push(s);
      },
    },
  );
  await r.run();
  assert.equal(sent.join(""), "\r\n가나3\r\n\r\n");
});
test("pattern states chunked receive and waits", async () => {
  const sent: string[] = [];
  const r = new Runtime(
    program(
      '여기부터(){찾을글("혼이`쓰러졌다 싸움이`끝났습니다");지연(5);정수보내기(찾은글번호());찾은글정리();정수보내기(찾은글번호());만약(제한글마중("준비",50))보내기("완료|");}',
    ),
    {
      send: async (s) => {
        sent.push(s);
      },
    },
  );
  const work = r.run();
  setTimeout(() => {
    r.feed("혼이 쓰");
    r.feed("\x1b[31m러졌다");
  }, 10);
  setTimeout(() => r.feed("준비"), 100);
  await work;
  assert.equal(sent.join(""), "10완료\r\n");
});
test("stop interrupts tight loop and delay; pause prevents transmission", async () => {
  const sent: string[] = [];
  const r = new Runtime(
    program('여기부터(){맴돌이(1){지연(1);보내기("a|");}}'),
    {
      send: async (s) => {
        sent.push(s);
      },
    },
  );
  const work = r.run();
  r.pause();
  await new Promise((x) => setTimeout(x, 40));
  assert.equal(sent.length, 0);
  r.resume();
  await new Promise((x) => setTimeout(x, 40));
  r.stop();
  await work;
  const n = sent.length;
  await new Promise((x) => setTimeout(x, 30));
  assert.equal(sent.length, n);
  assert.ok(n > 0);
});
test("unsupported send escapes fail instead of silent transmission", async () => {
  const r = new Runtime(program('여기부터(){보내기("$Z|");}'), {
    send: async () => {
      throw Error("should not send");
    },
  });
  await assert.rejects(r.run(), /지원하지 않는/);
});

test("escaped dollar is literal", async () => {
  let s = "";
  const r = new Runtime(program('여기부터(){보내기("$$");}'), {
    send: async (x) => {
      s += x;
    },
  });
  await r.run();
  assert.equal(s, "$");
});
test("undefined vars, memory and divide zero fail with locations", async () => {
  for (const s of [
    "여기부터(){보내기(x);}",
    "여기부터(){정수 a[10001];}",
    "여기부터(){정수 a=1/0;}",
  ]) {
    await assert.rejects(
      new Runtime(program(s), { send: async () => {} }).run(),
      /test.scs:1/,
    );
  }
});
test("tight loop stop yields to event loop", async () => {
  const r = new Runtime(program("여기부터(){맴돌이(1){}}"), {
    send: async () => {},
  });
  const work = r.run();
  setTimeout(() => r.stop(), 20);
  await work;
  assert.equal(r.stopped, true);
});
test('loop local arrays reuse bounded memory',async()=>{const r=new Runtime(program('여기부터(){정수 i;for(i=0;i<15;i++){정수 a[10000];a[0]=i;}}'),{send:async()=>{}});await r.run();});
