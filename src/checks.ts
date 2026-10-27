import { realpathSync,readFileSync,existsSync,unlinkSync } from 'node:fs';
import { type Command,type Check,contained,nonempty,validateRuntimeProof } from './contracts';
import { Store } from './state';
import { supervised } from './processes';
import { sealEvidence,evidenceId } from './evidence';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { commandIdentity } from './command-identity';
export async function executeCheck(store:Store,command:Command,identity:{candidate:string;policy:string;plan:string},authority:{trustedCode:boolean;root:string},signal?:AbortSignal):Promise<Check>{
 if(!authority.trustedCode)throw Error('Executable code requires explicit trust authorization; process is not sandbox');
 if(!contained(realpathSync(authority.root),realpathSync(command.cwd)))throw Error('Command cwd outside authorized root');
 nonempty(command.executable,'executable');if(!Array.isArray(command.args)||command.args.some(x=>typeof x!=='string')||!Number.isSafeInteger(command.timeoutMs)||command.timeoutMs<=0)throw Error('Invalid command');
 const runner=command.runner??'bun-test';if(command.noTestsReason)throw Error('noTestsReason bypass unsupported');
 if(runner==='command'){validateRuntimeProof(command.proof);if(command.testCount!==undefined)throw Error('Command proof cannot claim test count')}
 else if(runner!=='bun-test'||command.proof||realpathSync(command.executable)!==realpathSync(process.execPath)||command.args[0]!=='test')throw Error('Unrecognized executable/test adapter; arbitrary output cannot certify');
 if(signal?.aborted)return {id:command.id,...identity,exitCode:null,status:'cancelled',selectedTests:null,log:store.artifact('Cancelled before spawn'),observation:'',runner,proof:command.proof};
 const report=runner==='bun-test'?join(store.directory,'test-report-'+randomUUID()+'.xml'):undefined;
 const args=report?[...command.args,'--reporter=junit','--reporter-outfile='+report]:command.args;
 const result=await supervised(command.executable,args,{cwd:command.cwd,timeoutMs:command.timeoutMs,signal,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,COMSPEC:process.env.COMSPEC,TEMP:process.env.TEMP,TMP:process.env.TMP,BUN_BE_BUN:'1',GIT_TERMINAL_PROMPT:'0'}});
 const output=result.stdout+result.stderr,truncated=result.truncated,exit=result.exitCode;
 let selected:number|null=null,failures:number|null=null;
 if(report&&existsSync(report)){const xml=readFileSync(report,'utf8');const total=xml.match(/<testsuites\b[^>]*\btests="(\d+)"/);const failed=xml.match(/<testsuites\b[^>]*\bfailures="(\d+)"/);selected=total?Number(total[1]):null;failures=failed?Number(failed[1]):null;store.artifact(xml);unlinkSync(report)}
 const passed=exit===0&&!truncated&&(runner==='command'?!!output.trim():selected!==null&&selected>0&&failures===0);
 const status:Check['status']=result.status==='exited'?(passed?'passed':'failed'):result.status;
 const evidence:Check={id:command.id,...identity,exitCode:exit,status,selectedTests:selected,log:store.artifact(output+(truncated?'\nOUTPUT_TRUNCATED':'')),observation:output.trim(),runner,proof:command.proof};sealEvidence(store,'check',evidenceId(identity.candidate,command.id),{...evidence,commandDigest:commandIdentity(command),expectedTests:command.testCount??null});store.put('check',identity.candidate+':'+command.id,evidence);return evidence;
}
