import {test,expect} from 'bun:test';
import {assertSnapshotCommand} from '../src/command-identity';
import type {Command} from '../src/contracts';
test('snapshot check rejects live-tree paths and cwd redirects while retaining relative candidate tests',()=>{
 const c:Command={id:'regression',executable:process.execPath,args:['test','tests/app.test.ts'],cwd:import.meta.dir,timeoutMs:1000};assertSnapshotCommand(c);
 for(const args of [['test','C:/live/tests/app.test.ts'],['test','/live/tests/app.test.ts'],['test','../live/app.test.ts'],['test','--cwd=C:/live'],['test','--preload','live.ts'],['-e','import("C:/live/app.ts")']])expect(()=>assertSnapshotCommand({...c,args})).toThrow('Snapshot');
});
