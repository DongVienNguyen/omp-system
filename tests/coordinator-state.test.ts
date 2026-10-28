import { test,expect } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/state';
import { Coordinator } from '../src/coordinator';
import { digest,type Task } from '../src/contracts';
const task:Task={id:'same',goal:'Keep independent task',acceptance:['separate state'],depends_on:[],read_scope:['x'],write_scope:['x'],difficulty:'medium',state:'PLANNED',attempt:0,snapshot:''};
test('cancel and cold reconcile never overwrite same-named task from another run',()=>{const dir=mkdtempSync(join(import.meta.dir,'../.lab/run-state-'));const store=new Store(dir);try{store.createRun('one',[{...task,goal:'one goal'}],{});store.createRun('two',[{...task,goal:'two goal'}],{});store.transition('two','same','READY');store.transition('two','same','RUNNING');const controller=new Coordinator(store,{} as any);controller.cancel('one');expect(store.get<any>('task','one:same').goal).toBe('one goal');expect(store.get<any>('task','one:same').state).toBe('CANCELLED');expect(store.get<any>('task','two:same').state).toBe('RUNNING');controller.reconcile('two');expect(controller.status('two').tasks.length).toBe(1);expect(store.get<any>('task','two:same').state).toBe('BLOCKED');expect(store.get<any>('task','one:same').state).toBe('CANCELLED')}finally{store.close();rmSync(dir,{recursive:true,force:true})}});
