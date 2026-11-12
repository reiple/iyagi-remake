import {_electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const executablePath=process.env.APP_EXECUTABLE||'node_modules/electron/dist/electron.exe';
const profile=path.resolve('.test-profile','chat-layout-'+Date.now());
const launch=()=>_electron.launch({executablePath,args:[...(process.env.APP_EXECUTABLE?[]:['.']),'--user-data-dir='+profile],env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k!=='ELECTRON_RUN_AS_NODE'))});
let app=await launch();
const errors=[];
try {
 let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector('#host').value.length>0);
 const focused=()=>page.evaluate(()=>document.activeElement?.id);
 const isAbove=()=>page.evaluate(()=>document.querySelector('#command').getBoundingClientRect().bottom<document.querySelector('#terminal').getBoundingClientRect().top);
 assert.equal(await isAbove(),false);
 await page.click('#terminal',{position:{x:100,y:100}});
 assert.equal(await focused(),'command');
 await page.keyboard.type('hello');assert.equal(await page.inputValue('#command'),'hello');
 await page.click('#host');assert.equal(await focused(),'host');
 await page.click('.brand strong');assert.equal(await focused(),'command');
 // Dragging terminal text keeps the terminal focused for copy.
 const box=await page.locator('#terminal').boundingBox();
 await page.mouse.move(box.x+35,box.y+27);await page.mouse.down();await page.mouse.move(box.x+180,box.y+27,{steps:10});await page.mouse.up();
 assert.notEqual(await focused(),'command');
 await page.click('#settings');await page.click('#font');assert.equal(await focused(),'font');
 await page.selectOption('#commandPosition','top');await page.click('#save');
 await page.waitForFunction(()=>!document.querySelector('#dialog').open);
 assert.equal(await isAbove(),true);assert.equal(await page.inputValue('#command'),'hello');
 await page.screenshot({path:'docs/chat-layout-preview.png'});
 await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector('#host').value.length>0);
 assert.equal(await isAbove(),true);
 await page.click('#terminal',{position:{x:100,y:100}});assert.equal(await focused(),'command');
 await page.click('#settings');await page.selectOption('#commandPosition','bottom');await page.click('#save');
 await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.equal(await isAbove(),false);
 await page.click('#script-open-panel');await page.click('#script-editor');assert.equal(await focused(),'script-editor');
 assert.deepEqual(errors,[]);
 console.log('Chat UI passed: click-to-type, control/modal focus, drag selection, top/bottom layout, draft preservation, restart persistence');
} finally {await app.close();}
