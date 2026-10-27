import { test,expect } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/state';
import { authorizeExecution,requireExecution } from '../src/authority';
import { verifiedEvidence } from '../src/evidence';
test('authority is bound to exact run/project/budget and rejects forged persisted signature',()=>{const dir=mkdtempSync(join(import.meta.dir,'../.lab/authority-'));const store=new Store(dir);try{const spec={id:'r',project:dir,budget:{deadline:Date.now()+60000}};expect(()=>authorizeExecution(store,spec,false)).toThrow('confirmation');const authority=authorizeExecution(store,spec,true);expect(requireExecution(store,authority.id,spec).run).toBe('r');expect(()=>requireExecution(store,authority.id,{...spec,id:'different'})).toThrow('mismatch');store.put('sealed-authority',authority.id,{body:{...authority,run:'different'},signature:'0'.repeat(64)});expect(()=>verifiedEvidence(store,'authority',authority.id)).toThrow('Forged')}finally{store.close();rmSync(dir,{recursive:true,force:true})}});
