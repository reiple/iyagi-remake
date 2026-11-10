import {test} from 'node:test';import assert from 'node:assert/strict';import {expandTransmit} from '../src/script/transmit';
test('numeric byte escapes, literal dollars and empty commands',()=>{assert.deepEqual(expandTransmit('|$$$#155=14F||'),[{text:'\r\n$'},{byte:155},{text:'=14F\r\n\r\n'}]);assert.throws(()=>expandTransmit('$#999'),/바이트/);assert.throws(()=>expandTransmit('$Z'),/지원하지/);});

test("raw byte action limit",()=>{assert.throws(()=>expandTransmit("\x9b".repeat(4097)),/한도/);});
