import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/state';
import {deliveryCommand} from '../src/delivery-command';

test('local forge frontier preserves patch verdict across rebase but requires current head CI and one writer',async()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/frontier-')),project=join(dir,'project');mkdirSync(project);const store=new Store(join(dir,'state'));
 const git=(args:string[])=>{const r=spawnSync('git',['-C',project,'-c','core.autocrlf=false',...args],{encoding:'utf8',timeout:10000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()};
 const command=async(spec:unknown)=>{const file=join(dir,'command.json');writeFileSync(file,JSON.stringify(spec));return deliveryCommand(store,project,file)};
 const assess=async(spec:unknown)=>{const result=await command(spec);if(!('status' in result)||!('blocked' in result)||!Array.isArray(result.blocked))throw Error('Expected frontier assessment');return {status:result.status,blocked:result.blocked as {id:string;reason:string}[]}};
 try{
  git(['init','-b','main']);git(['config','user.name','Local Frontier']);git(['config','user.email','local@invalid']);writeFileSync(join(project,'app.ts'),'export const value=1;\n');git(['add','.']);git(['commit','-m','base']);const base=git(['rev-parse','HEAD']);
  git(['checkout','-b','change']);writeFileSync(join(project,'app.ts'),'export const value=2;\n');git(['commit','-am','change']);const head=git(['rev-parse','HEAD']);
  for(const identities of [{id:' ',producer:' ',reviewer:'  '},{id:'bad',producer:1,reviewer:2},{id:'same',producer:'producer',reviewer:' producer '}])await expect(command({operation:'round',base,head,verdict:'PASS',...identities})).rejects.toThrow('Independent');
  await command({operation:'round',id:'round',base,head,producer:'producer',reviewer:'independent',verdict:'PASS'});
  git(['checkout','main']);writeFileSync(join(project,'unrelated.txt'),'trunk\n');git(['add','.']);git(['commit','-m','unrelated trunk']);const trunk=git(['rev-parse','HEAD']);git(['checkout','change']);git(['rebase','main']);const rebased=git(['rev-parse','HEAD']);expect(rebased).not.toBe(head);
  const item={id:'7',branch:'change',base:trunk,head:rebased,round:'round',operatorOwned:false};
  await command({operation:'frontier',id:'stack',writer:'stacker',generation:1,expectedGeneration:0,items:[item]});
  const request={operation:'frontier-check',frontier:'stack',generation:1,writer:'stacker',trunk,observations:[{id:'7',head:rebased,checks:'PASS',threads:'RESOLVED',mergeable:true}]};
  expect((await assess(request)).status).toBe('LOCAL_READY');
  expect((await assess({...request,observations:[{...request.observations[0],head}]})).status).toBe('BLOCKED');
  expect((await assess({...request,observations:[{...request.observations[0],threads:'UNRESOLVED'}]})).status).toBe('BLOCKED');
  expect((await assess({...request,observations:[{...request.observations[0],mergeable:null}]})).status).toBe('BLOCKED');
  await expect(command({...request,writer:'other'})).rejects.toThrow('writer');
  await expect(command({operation:'frontier',id:'stack',writer:'other',generation:2,expectedGeneration:1,items:[item]})).rejects.toThrow('writer');
  writeFileSync(join(project,'app.ts'),'export const value=3;\n');git(['commit','-am','changed patch']);const changed=git(['rev-parse','HEAD']);await command({operation:'frontier',id:'stack',writer:'stacker',generation:2,expectedGeneration:1,items:[{...item,head:changed}]});
  await expect(command(request)).rejects.toThrow('Stale');
  const invalid=await assess({...request,generation:2,observations:[{...request.observations[0],head:changed}]});expect(invalid.status).toBe('BLOCKED');expect(invalid.blocked[0]!.reason).toContain('patch');
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
},120000);
