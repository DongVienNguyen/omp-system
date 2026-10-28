import { test,expect } from 'bun:test';
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/state';
import { snapshot,materialize,fsTools } from '../src/workspaces';
import { supervised } from '../src/processes';
import { canonical } from '../src/contracts';
test('snapshot includes untracked/config bytes and scoped tools cannot escape',async()=>{const dir=mkdtempSync(join(import.meta.dir,'../.lab/workspace-'));const store=new Store(join(dir,'state'));try{const input=join(dir,'input');mkdirSync(input);writeFileSync(join(input,'app.ts'),'old');writeFileSync(join(input,'config.json'),'{"v":1}');const first=snapshot(store,input,['app.ts','config.json']);writeFileSync(join(input,'config.json'),'{"v":2}');expect(snapshot(store,input,['app.ts','config.json']).id).not.toBe(first.id);const output=join(dir,'candidate');materialize(store,first,output);const tools=fsTools(output,['config.json'],['app.ts']);await expect(tools[1].execute('w',{path:'../input/app.ts',content:'attack'})).rejects.toThrow();await expect(tools[1].execute('w',{path:'config.json',content:'attack'})).rejects.toThrow();expect(readFileSync(join(output,'config.json'),'utf8')).toBe('{"v":1}')}finally{store.close();rmSync(dir,{recursive:true,force:true})}});
test('optional receipt fields serialize deterministically without losing null/false',()=>{expect(canonical({z:undefined,b:false,a:null})).toBe('{"a":null,"b":false}')});
// Real platform deadline integration: fake timers cannot drive Windows taskkill or child-process lifetime.
test('supervised native process timeout terminates owned child tree',async()=>{const result=await supervised(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:import.meta.dir,env:{...process.env,BUN_BE_BUN:'1'},timeoutMs:300});expect(result.status).toBe('timed_out');expect(result.exitCode).not.toBe(0);expect(()=>process.kill(result.pid,0)).toThrow()});
