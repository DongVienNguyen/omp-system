import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {diagnoseProject} from '../src/doctor';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {sealEvidence,evidenceId} from '../src/evidence';
import {projectStatus} from '../src/status';
import {root,profileRoot,protectedHashes} from '../scripts/dev-preflight';

test('doctor performs real read-only profile inspection without inference or credential disclosure',()=>{
 const before=protectedHashes(),report=diagnoseProject({project:root,profile:'omp-system-dev',agentDir:join(profileRoot('omp-system-dev'),'agent'),executable:process.env.OMP_SYSTEM_EXECUTABLE??process.execPath});
 expect(report.inference).toBe('NOT RUN');expect(report.mutations).toBe('NONE');expect(report.checks.find(c=>c.id==='host-version')?.status).toBe('PASS');expect(report.checks.find(c=>c.id==='source-pins')?.status).toBe('PASS');expect(report.checks.find(c=>c.id==='package-assets')?.status).toBe('PASS');expect(report.checks.some(c=>c.id==='native-registration')).toBe(true);expect(report.checks.some(c=>c.id==='installed-ak')).toBe(true);expect(protectedHashes()).toEqual(before);
},45000);

test('doctor unavailable native command blocks enable, retains busy lease and never emits configured secret',()=>{
 const dir=mkdtempSync(join(root,'.lab/doctor-')),project=join(dir,'project'),agent=join(dir,'agent');mkdirSync(project);mkdirSync(agent);const secret='private-doctor-fixture-secret';writeFileSync(join(agent,'models.yml'),JSON.stringify({providers:{'9router':{apiKey:secret,models:[{id:'code-seek'},{id:'code-sol'},{id:'code-astra'}]}}}));const lock=join(project,'.omp-system-execution.lock'),token=JSON.stringify({pid:process.pid,id:'fixture'});writeFileSync(lock,token);
 try{const report=diagnoseProject({project,profile:'omp-system-dev',agentDir:agent,executable:join(dir,'missing.exe')});expect(report.canEnable).toBe(false);expect(report.checks.find(c=>c.id==='host-version')?.status).toBe('UNKNOWN');expect(report.checks.find(c=>c.id==='process-lease')?.status).toBe('FAIL');expect(report.checks.find(c=>c.id==='provider-auth')?.status).toBe('PASS');expect(JSON.stringify(report)).not.toContain(secret);expect(readFileSync(lock,'utf8')).toBe(token);
  writeFileSync(join(agent,'models.yml'),JSON.stringify({providers:{'9router':{apiKey:'OMP_SYSTEM_API_KEY',models:[{id:'code-seek'},{id:'code-sol'},{id:'code-astra'}]}}}));const denied=diagnoseProject({project,profile:'omp-system-dev',agentDir:agent,executable:join(dir,'missing.exe'),environment:{}});expect(denied.checks.find(c=>c.id==='provider-auth')?.status).toBe('UNKNOWN');expect(denied.canEnable).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true})}
},45000);

test('status links real candidate/check/review records and verified runtime log artifact',()=>{
 const dir=mkdtempSync(join(root,'.lab/status-')),work=join(dir,'work');mkdirSync(work);writeFileSync(join(work,'app.ts'),'42');const store=new Store(join(dir,'state'));
 try{const snap=snapshot(store,work,['app.ts']),log=store.artifact('actual retained log');const check={id:'test',candidate:snap.id,policy:'policy',plan:'plan',status:'passed',exitCode:0,selectedTests:1,log,observation:'retained'};sealEvidence(store,'check',evidenceId(snap.id,'test'),check);sealEvidence(store,'review','review',{id:'review',candidate:snap.id,findings:[]});const status=projectStatus(store);expect(status.snapshots[0]?.files[0]?.artifactPath).toBe(join(store.artifacts,snap.files[0]!.artifact));expect(status.checks[0]?.logArtifact).toEqual({hash:log,path:join(store.artifacts,log),verified:true});expect(status.reviews[0]?.record).toEqual({database:join(store.directory,'state.sqlite'),kind:'sealed-review',id:'review'});expect(status.checks[0]?.attestation).toBe('VERIFIED');
  store.put('sealed-check',evidenceId(snap.id,'test'),{body:check,signature:'0'.repeat(64)});store.put('instruction-dispatch','run:task:0',{run:'run',task:'task',fingerprint:'fingerprint',sources:[]});const denied=projectStatus(store);expect(denied.checks[0]?.attestation).toBe('INVALID');expect(denied.instructionDispatches[0]?.attestation).toBe('HOST_RECORDED_NOT_SEALED');
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
