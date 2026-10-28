import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export interface ProcessResult {pid:number;exitCode:number|null;status:'exited'|'cancelled'|'timed_out';stdout:string;stderr:string;truncated:boolean;timing?:{elapsedMs:number;firstOutputMs?:number;exitMs?:number;stopMs?:number;killExit?:number|null};}
export async function supervised(executable:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number;signal?:AbortSignal;maxBytes?:number;input?:string}):Promise<ProcessResult>{
 if(!executable||!Array.isArray(args)||args.some(x=>typeof x!=='string')||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw Error('Invalid process boundary');
 if(options.signal?.aborted)return {pid:0,exitCode:null,status:'cancelled',stdout:'',stderr:'',truncated:false};
 const started=performance.now(),timing:NonNullable<ProcessResult['timing']>={elapsedMs:0};
 const windows=process.platform==='win32';const runner=windows?'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe':executable;
 const argv=windows?['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows-job.ps1',import.meta.url)),'-Request',Buffer.from(JSON.stringify({executable,args,cwd:options.cwd})).toString('base64')]:args;
 const environment={...options.env};if(windows){delete environment.BUN_BE_BUN;environment.OMP_SYSTEM_CHILD_BUN=options.env.BUN_BE_BUN??''}
 const child=spawn(runner,argv,{cwd:options.cwd,env:environment,shell:false,windowsHide:true,detached:!windows,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});
 if(options.input!==undefined){child.stdin!.on('error',()=>{});child.stdin!.end(options.input)}
 let status:ProcessResult['status']='exited',stdout='',stderr='',truncated=false,bytes=0;const cap=options.maxBytes??2*1024*1024;
 const capture=(which:'stdout'|'stderr',data:Buffer)=>{timing.firstOutputMs??=performance.now()-started;const remaining=Math.max(0,cap-bytes);const text=data.subarray(0,remaining).toString('utf8');bytes+=data.length;if(bytes>cap)truncated=true;if(which==='stdout')stdout+=text;else stderr+=text};
 child.stdout!.on('data',data=>capture('stdout',data));child.stderr!.on('data',data=>capture('stderr',data));
 let termination:Promise<void>|undefined,closed=false;let rejectSettlement:((error:Error)=>void)|undefined;let settlementTimer:ReturnType<typeof setTimeout>|undefined;
 const terminate=(reason:'cancelled'|'timed_out')=>{if(termination||closed)return;status=reason;timing.stopMs=performance.now()-started;if(!child.pid)return;settlementTimer=setTimeout(()=>{child.kill();rejectSettlement?.(Error('Owned process cleanup unconfirmed after termination'))},20000);termination=(async()=>{if(windows){timing.killExit=await new Promise<number|null>(resolve=>{let done=false;const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(killTimer);resolve(code)};const killer=spawn('C:/Windows/System32/taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});const killTimer=setTimeout(()=>{killer.kill();child.kill();finish(null)},10000);killer.once('error',()=>finish(null));killer.once('exit',finish)});if(timing.killExit!==0&&child.exitCode===null)child.kill()}else{try{process.kill(-child.pid!,'SIGKILL')}catch{if(child.exitCode===null)child.kill('SIGKILL')}}})();};
 const abort=()=>terminate('cancelled');options.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>terminate('timed_out'),options.timeoutMs);
 child.once('exit',()=>{timing.exitMs=performance.now()-started});
 child.once('close',()=>{closed=true});
 try{const exitCode=await new Promise<number|null>((resolve,reject)=>{rejectSettlement=reject;child.once('error',reject);child.once('close',resolve)});await termination;timing.elapsedMs=performance.now()-started;return {pid:child.pid??0,exitCode,status,stdout,stderr,truncated,timing}}
 finally{clearTimeout(timer);clearTimeout(settlementTimer);options.signal?.removeEventListener('abort',abort)}
}
