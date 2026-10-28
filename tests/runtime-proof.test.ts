import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../src/state';
import {digest,type Command,type Review} from '../src/contracts';
import {executeCheck} from '../src/checks';
import {certify,requireCertificate} from '../src/gate';
import {sealEvidence} from '../src/evidence';
import {commandIdentity} from '../src/command-identity';
import {snapshot} from '../src/workspaces';
test('native command proof requires frozen explicit policy and actual host execution',async()=>{
 const root=mkdtempSync(join(import.meta.dir,'../.lab/runtime-proof-')),work=join(root,'work');mkdirSync(work);writeFileSync(join(work,'README.txt'),'documented');const store=new Store(join(root,'state'));
 try{
  const candidate=snapshot(store,work,['README.txt']).id,base=digest('base'),policy=digest('policy'),plan=digest('plan'),identity={candidate,policy,plan};
  const command:Command={id:'cli',executable:process.execPath,args:['--version'],cwd:work,timeoutMs:10000,runner:'command',proof:{kind:'exit-code',reason:'Native CLI version command validates installed runtime is executable'}};
  const check=await executeCheck(store,command,identity,{trustedCode:true,root:work});expect(check.status).toBe('passed');expect(check.selectedTests).toBeNull();expect(check.observation).toMatch(/^1\./);
  const review:Review={id:'review',candidate,base,policy,plan,session:'independent',implementerSession:'producer',status:'complete',reviewed_paths:['README.txt'],findings:[]};sealEvidence(store,'review',review.id,review);
  const input={candidate,base,policy,plan,checks:[check],review,paths:['README.txt'],pendingJobs:0,currentCandidate:()=>snapshot(store,work,['README.txt']).id,requiredChecks:[{id:command.id,commandDigest:commandIdentity(command),runner:command.runner,proof:command.proof,requiresObservation:true}]};
  const certificate=certify(store,input);expect(requireCertificate(store,certificate.id,input).valid).toBe(true);
  expect(()=>certify(store,{...input,requiredChecks:[{...input.requiredChecks[0]!,proof:undefined}]})).toThrow('Explicit');
  expect(()=>certify(store,{...input,requiredChecks:[{...input.requiredChecks[0]!,proof:{kind:'exit-code',reason:'different approved proof'}}]})).toThrow('policy mismatch');
  expect(()=>certify(store,{...input,checks:[{...check,observation:'model claims PASS'}]})).toThrow('host-attested');
  await expect(executeCheck(store,{...command,id:'missing',proof:undefined},identity,{trustedCode:true,root:work})).rejects.toThrow('Explicit');
  const failed=await executeCheck(store,{...command,id:'failure',args:['-e','console.error("native failure");process.exit(3)']},identity,{trustedCode:true,root:work});expect(failed.status).toBe('failed');expect(failed.exitCode).toBe(3);
  const silent=await executeCheck(store,{...command,id:'silent',args:['-e','process.exit(0)']},identity,{trustedCode:true,root:work});expect(silent.status).toBe('failed');
  const empty=await executeCheck(store,{id:'empty',executable:process.execPath,args:['test'],cwd:work,timeoutMs:10000},identity,{trustedCode:true,root:work});expect(empty.status).toBe('failed');
  await expect(executeCheck(store,{...command,id:'bypass',noTestsReason:'docs'},identity,{trustedCode:true,root:work})).rejects.toThrow('bypass');
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
},45000);
