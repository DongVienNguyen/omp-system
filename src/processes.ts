import { spawn,spawnSync,type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export interface ProcessResult {pid:number;exitCode:number|null;status:'exited'|'cancelled'|'timed_out';stdout:string;stderr:string;truncated:boolean;}
export async function supervised(executable:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number;signal?:AbortSignal;maxBytes?:number;input?:string}):Promise<ProcessResult>{
 if(!executable||!Array.isArray(args)||args.some(x=>typeof x!=='string')||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw Error('Invalid process boundary');
 if(options.signal?.aborted)return {pid:0,exitCode:null,status:'cancelled',stdout:'',stderr:'',truncated:false};
 const windows=process.platform==='win32';const runner=windows?'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe':executable;
 const argv=windows?['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows-job.ps1',import.meta.url)),'-Request',Buffer.from(JSON.stringify({executable,args,cwd:options.cwd})).toString('base64')]:args;
 const environment={...options.env};if(windows){delete environment.BUN_BE_BUN;environment.OMP_SYSTEM_CHILD_BUN=options.env.BUN_BE_BUN??''}
 const child=spawn(runner,argv,{cwd:options.cwd,env:environment,shell:false,windowsHide:true,detached:!windows,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});
 if(options.input!==undefined){child.stdin!.on('error',()=>{});child.stdin!.end(options.input)}
 let status:ProcessResult['status']='exited',stdout='',stderr='',truncated=false,bytes=0;const cap=options.maxBytes??2*1024*1024;
 const capture=(which:'stdout'|'stderr',data:Buffer)=>{const remaining=Math.max(0,cap-bytes);const text=data.subarray(0,remaining).toString('utf8');bytes+=data.length;if(bytes>cap)truncated=true;if(which==='stdout')stdout+=text;else stderr+=text};
 child.stdout!.on('data',data=>capture('stdout',data));child.stderr!.on('data',data=>capture('stderr',data));
 const terminate=(reason:'cancelled'|'timed_out')=>{if(child.exitCode!==null||child.signalCode!==null)return;status=reason;if(!child.pid)return;if(process.platform==='win32'){const killed=spawnSync('C:/Windows/System32/taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:10000});if(killed.status!==0)child.kill()}else{try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}};
 const abort=()=>terminate('cancelled');options.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>terminate('timed_out'),options.timeoutMs);
 try{const exitCode=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});return {pid:child.pid??0,exitCode,status,stdout,stderr,truncated}}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
}
