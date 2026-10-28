import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {withProjectExecution,reconcileProjectExecution,reconcileProjectGuard} from '../src/project-execution';
import {Store} from '../src/state';
import {recoverInterrupted} from '../src/recovery';

test('canonical project barrier excludes other profiles and rejected resume cannot mutate live state',async()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/execution-')),project=join(dir,'project'),one=join(dir,'profile-one'),two=join(dir,'profile-two');for(const path of [project,one,two])mkdirSync(path);
 const store=new Store(one),lock=join(project,'.omp-system-execution.lock');
 const {promise:barrier,resolve:release}=Promise.withResolvers<void>(),{promise:admitted,resolve:entered}=Promise.withResolvers<void>();
 store.put('run','active',{id:'active',generation:'g',cancelled:false});store.put('task','active:task',{run:'active',id:'task',state:'RUNNING'});store.put('dispatch','active:worker',{run:'active',id:'worker',state:'running'});
 const before={run:store.get('run','active'),task:store.get('task','active:task'),dispatch:store.get('dispatch','active:worker')};let secondEntered=false;
 const active=withProjectExecution(one,project,async()=>{entered();await barrier;return 'settled'});
 try{
  await Promise.race([admitted,active.then(()=>{throw Error('First admission never reached barrier')})]);
  const token=readFileSync(lock,'utf8');expect(()=>reconcileProjectExecution(project,token,true)).toThrow('still exists');expect(readFileSync(lock,'utf8')).toBe(token);
  await expect(withProjectExecution(two,realpathSync(project),async()=>{secondEntered=true;return recoverInterrupted(store,'active')})).rejects.toThrow('already active');
  expect(secondEntered).toBe(false);expect({run:store.get('run','active'),task:store.get('task','active:task'),dispatch:store.get('dispatch','active:worker')}).toEqual(before);
  release();expect(await active).toBe('settled');expect(existsSync(lock)).toBe(false);
 }finally{release();await active.catch(()=>undefined);store.close();rmSync(dir,{recursive:true,force:true})}
},45000);

test('cold lease reconciliation needs exact token, explicit approval and OS-proven dead owner; run states remain unchanged',()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/reconcile-')),project=join(dir,'project');mkdirSync(project);const store=new Store(join(dir,'state')),lock=join(project,'.omp-system-execution.lock');
 try{
  const child=spawnSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8',timeout:10000,env:{...process.env,BUN_BE_BUN:'1'}});if(child.status!==0)throw Error('Real child PID probe failed');const pid=Number(child.stdout.trim());expect(Number.isSafeInteger(pid)&&pid>0&&pid!==process.pid).toBe(true);
  const token=JSON.stringify({pid,id:randomUUID()});writeFileSync(lock,token,{flag:'wx'});store.put('dispatch','interrupted:worker',{run:'interrupted',state:'unknown',status:'BLOCKED'});const before=store.get('dispatch','interrupted:worker');
  const guard=lock+'.reconciling',liveGuard=JSON.stringify({pid:process.pid,id:randomUUID()});writeFileSync(guard,liveGuard,{flag:'wx'});expect(()=>reconcileProjectGuard(project,liveGuard,true)).toThrow('still exists');expect(readFileSync(guard,'utf8')).toBe(liveGuard);
  const deadGuard=JSON.stringify({pid,id:randomUUID()});writeFileSync(guard,deadGuard);expect(()=>reconcileProjectExecution(project,token,true)).toThrow('already active');expect(()=>reconcileProjectGuard(project,deadGuard,false)).toThrow('operator confirmation');expect(()=>reconcileProjectGuard(project,deadGuard+' ',true)).toThrow('token changed');
  const cleared=reconcileProjectGuard(project,deadGuard,true);expect(cleared.state).toBe('GUARD_RECONCILED');expect(cleared.executionLease).toBe('UNCHANGED');expect(existsSync(guard)).toBe(false);expect(readFileSync(lock,'utf8')).toBe(token);expect(store.get('dispatch','interrupted:worker')).toEqual(before);
  expect(()=>reconcileProjectExecution(project,token,false)).toThrow('operator confirmation');expect(()=>reconcileProjectExecution(project,token+' ',true)).toThrow('token changed');expect(readFileSync(lock,'utf8')).toBe(token);
  const result=reconcileProjectExecution(project,token,true);expect(result.state).toBe('RECONCILED');expect(result.runState).toBe('UNCHANGED');expect(result.previousOwner.pid).toBe(pid);expect(existsSync(lock)).toBe(false);expect(existsSync(lock+'.reconciling')).toBe(false);expect(store.get('dispatch','interrupted:worker')).toEqual(before);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
},45000);
