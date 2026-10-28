import {join} from 'node:path';
import {openSync,closeSync,writeFileSync,readFileSync,unlinkSync,realpathSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {admitResources} from './resource-admission';
/** Cross-process canonical project lease. Unknown owners block; no automatic cleanup/replay. */
export async function withProjectExecution<T>(directory:string,project:string,run:()=>Promise<T>):Promise<T>{
 project=realpathSync(project);const admission=await admitResources(directory);let releaseProject:(()=>void)|undefined;
 const path=join(project,'.omp-system-execution.lock'),guard=path+'.reconciling',owner=JSON.stringify({pid:process.pid,id:randomUUID()});let fd:number;
 try{
  releaseProject=(await admitResources(project)).release;
  if(existsSync(guard))throw Error('Project execution lease reconciliation active or unknown');
  try{fd=openSync(path,'wx',0o600)}catch{throw Error('Project execution already active or owner unknown')}
  try{writeFileSync(fd,owner)}catch(error){closeSync(fd);unlinkSync(path);throw error}closeSync(fd);
  try{if(existsSync(guard))throw Error('Project execution lease reconciliation active or unknown');return await run()}
  finally{if(readFileSync(path,'utf8')!==owner)throw Error('Execution lease owner changed; no cleanup');unlinkSync(path)}
 }finally{releaseProject?.();admission.release()}
}
/** Operator must supply exact inspected lock bytes. Only OS-proven absent PID may be reconciled. Never kills a process or repairs run state. */
export function reconcileProjectExecution(project:string,expectedToken:string,operatorConfirmed:boolean){
 if(!operatorConfirmed||typeof expectedToken!=='string'||!expectedToken)throw Error('Exact lease token and operator confirmation required');
 project=realpathSync(project);const path=join(project,'.omp-system-execution.lock'),guard=path+'.reconciling',guardOwner=JSON.stringify({pid:process.pid,id:randomUUID()});let fd:number;
 try{fd=openSync(guard,'wx',0o600)}catch{throw Error('Lease reconciliation already active or owner unknown')}
 try{writeFileSync(fd,guardOwner)}catch(error){closeSync(fd);unlinkSync(guard);throw error}closeSync(fd);
 try{
  if(readFileSync(path,'utf8')!==expectedToken)throw Error('Execution lease token changed');
  const value:unknown=JSON.parse(expectedToken);if(!value||typeof value!=='object'||!('pid' in value)||typeof value.pid!=='number'||!Number.isSafeInteger(value.pid)||value.pid<=0||!('id' in value)||typeof value.id!=='string'||!value.id)throw Error('Malformed execution lease; owner absence unknown');
  try{process.kill(value.pid,0)}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ESRCH')throw Error('Execution lease owner absence unknown');
   if(readFileSync(path,'utf8')!==expectedToken)throw Error('Execution lease token changed');unlinkSync(path);return {project,previousOwner:{pid:value.pid,id:value.id},state:'RECONCILED' as const,runState:'UNCHANGED' as const};
  }
  throw Error('Execution lease owner still exists; no cleanup');
 }finally{if(readFileSync(guard,'utf8')!==guardOwner)throw Error('Reconciliation lease owner changed; no cleanup');unlinkSync(guard)}
}

/** Explicit recovery of a crashed reconciler only. Main execution lease and run state remain untouched. */
export function reconcileProjectGuard(project:string,expectedGuardToken:string,operatorConfirmed:boolean){
 if(!operatorConfirmed||typeof expectedGuardToken!=='string'||!expectedGuardToken)throw Error('Exact guard token and operator confirmation required');
 project=realpathSync(project);const path=join(project,'.omp-system-execution.lock.reconciling');
 if(readFileSync(path,'utf8')!==expectedGuardToken)throw Error('Reconciliation guard token changed');
 const value:unknown=JSON.parse(expectedGuardToken);if(!value||typeof value!=='object'||!('pid' in value)||typeof value.pid!=='number'||!Number.isSafeInteger(value.pid)||value.pid<=0||!('id' in value)||typeof value.id!=='string'||!value.id)throw Error('Malformed reconciliation guard; owner absence unknown');
 try{process.kill(value.pid,0)}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ESRCH')throw Error('Reconciliation guard owner absence unknown');
  if(readFileSync(path,'utf8')!==expectedGuardToken)throw Error('Reconciliation guard token changed');unlinkSync(path);return {project,previousOwner:{pid:value.pid,id:value.id},state:'GUARD_RECONCILED' as const,executionLease:'UNCHANGED' as const,runState:'UNCHANGED' as const};
 }
 throw Error('Reconciliation guard owner still exists; no cleanup');
}
