import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ScriptService } from "../src/script/service";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("worker terminates a tight loop; stale source rejected; paused worker cannot send", async () => {
  const sent: string[] = [];
  const svc = new ScriptService({
    workerPath: path.resolve("dist/script-worker.cjs"),
    canRun: () => true,
    send: (s) => sent.push(s),
    event: () => {},
    logEnd: () => {},
  });
  try {
    let source = "여기부터(){맴돌이(1){}}";
    svc.translate(source);
    assert.throws(() => svc.run(source + " "), /먼저 번역/);
    svc.run(source);
    await sleep(60);
    svc.stop();
    assert.equal(svc.worker, undefined);
    source = '여기부터(){맴돌이(1){보내기("a|");지연(1);}}';
    svc.translate(source);
    svc.run(source);
    svc.pause();
    await sleep(80);
    assert.equal(sent.length, 0);
    svc.resume();
    await sleep(120);
    assert.ok(sent.length > 0);
    svc.stop();
    const n = sent.length;
    await sleep(40);
    assert.equal(sent.length, n);
  } finally {
    svc.stop();
  }
});
test("worker error includes source line and disconnected run is rejected", async () => {
  let failure = "";
  const svc = new ScriptService({
    workerPath: path.resolve("dist/script-worker.cjs"),
    canRun: () => true,
    send: () => {},
    event: (e) => {
      if (e.type === "failure") failure = e.error;
    },
    logEnd: () => {},
  });
  try {
    const src = "여기부터(){정수 a[2];a[5]=1;}";
    svc.translate(src);
    svc.run(src);
    await sleep(150);
    assert.match(failure, /배열 인덱스/);
    svc.options.canRun = () => false;
    assert.throws(() => svc.run(src), /연결 후/);
  } finally {
    svc.stop();
  }
});
import fs from 'node:fs';import os from 'node:os';
test('different header versions never silently win',()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),'iyagi-headers-'));const other=path.join(base,'v2');fs.mkdirSync(other);const src=path.join(base,'test.scs');fs.writeFileSync(src,'#포함 <CUSTOM.H>\n여기부터(){foo();}');fs.writeFileSync(path.join(base,'CUSTOM.H'),'foo(){보내기("v1|");}');fs.writeFileSync(path.join(other,'CUSTOM.H'),'foo(){보내기("v2|");}');const svc=new ScriptService({workerPath:'unused',canRun:()=>false,send:()=>{},event:()=>{},logEnd:()=>{}});try{svc.load(src);svc.setHeaderRoot(other);assert.throws(()=>svc.translate(fs.readFileSync(src,'utf8')),/여러 버전|충돌/);}finally{fs.rmSync(base,{recursive:true,force:true});}});
test('worker output is bounded and backpressured',async()=>{const outputs:string[]=[];const svc=new ScriptService({workerPath:path.resolve('dist/script-worker.cjs'),canRun:()=>true,send:()=>{},event:e=>{if(e.type==='output')outputs.push(e.text);},logEnd:()=>{}});try{const src='여기부터(){맴돌이(1){글월쓰기("'+ 'x'.repeat(10000)+'");}}';svc.translate(src);svc.run(src);await sleep(350);svc.stop();assert.ok(outputs.length>0&&outputs.length<=5);assert.ok(outputs.every(s=>s.length<4200));}finally{svc.stop();}});
