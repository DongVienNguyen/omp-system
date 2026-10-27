import {cpus,freemem,loadavg,platform} from 'node:os';
import {closeSync,existsSync,lstatSync,openSync,readFileSync,realpathSync,statfsSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
export interface ResourceSnapshot {freeMemoryBytes:number;freeDiskBytes:number;cpuBusyFraction:number;loadPerCpu:number|null;}
const minimumMemory=256*1024**2,minimumDisk=2*1024**3;
export function requireResourceHeadroom(value:ResourceSnapshot){
 if(!Number.isFinite(value.freeMemoryBytes)||value.freeMemoryBytes<minimumMemory)throw Error('Resource admission denied: need 256 MiB free memory');
 if(!Number.isFinite(value.freeDiskBytes)||value.freeDiskBytes<minimumDisk)throw Error('Resource admission denied: need 2 GiB free disk');
 if(!Number.isFinite(value.cpuBusyFraction)||value.cpuBusyFraction<0||value.cpuBusyFraction>1)throw Error('Resource admission denied: CPU measurement unknown');
 if(value.cpuBusyFraction>=0.95)throw Error('Resource admission denied: CPU utilization at least 95%');
 if(value.loadPerCpu!==null&&(!Number.isFinite(value.loadPerCpu)||value.loadPerCpu>=1))throw Error('Resource admission denied: system load at CPU capacity');
 return value;
}
/** Exclusive owned lab lease, not OS isolation. Unknown/stale owner requires explicit reconciliation. */
export function acquireLiveExperiment(root:string){
 const source=realpathSync(root),lab=join(source,'.lab');if(lstatSync(lab).isSymbolicLink())throw Error('Resource admission refuses linked lab');const marker:unknown=JSON.parse(readFileSync(join(lab,'.omp-system-owner.json'),'utf8'));if(!marker||typeof marker!=='object'||!('owner'in marker)||marker.owner!=='omp-system/lab-v1'||!('source'in marker)||marker.source!==source)throw Error('Resource admission requires owned lab');const path=join(lab,'live-experiment.lock'),owner=JSON.stringify({pid:process.pid,id:randomUUID()});
 let fd:number;try{fd=openSync(path,'wx',0o600)}catch{throw Error('Live experiment admission denied: existing or unknown owner')}
 try{writeFileSync(fd,owner)}catch(error){closeSync(fd);unlinkSync(path);throw error}closeSync(fd);
 return {path,release(){if(!existsSync(path)||readFileSync(path,'utf8')!==owner)throw Error('Live experiment lease ownership changed; refusing cleanup');unlinkSync(path)}};
}
/** Windows uses native performance counters; load average is unavailable there. */
export async function admitResources(root:string,live=false){
 const lease=live?acquireLiveExperiment(root):undefined;
 try{
  const before=cpus();if(!before.length)throw Error('Resource admission denied: CPU topology unknown');let cpuBusyFraction:number;
  if(platform()==='win32'){
   const measurement=spawnSync(join(process.env.SystemRoot??'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime"],{encoding:'utf8',timeout:15000,windowsHide:true});
   const text=measurement.stdout.trim();if(measurement.status!==0||!/^\d+(\.\d+)?$/.test(text))throw Error('Resource admission denied: Windows CPU measurement unavailable');cpuBusyFraction=Number(text)/100;
  }else{
   await setTimeout(100);const after=cpus();if(before.length!==after.length)throw Error('Resource admission denied: CPU topology changed');let total=0,idle=0;
   for(let i=0;i<before.length;i++){const a=before[i]!.times,b=after[i]!.times;const delta=Object.keys(a).reduce((sum,key)=>sum+b[key as keyof typeof b]-a[key as keyof typeof a],0);if(delta<0||b.idle<a.idle)throw Error('Resource admission denied: CPU counters changed');total+=delta;idle+=b.idle-a.idle}cpuBusyFraction=total>0?1-idle/total:NaN;
  }
  const disk=statfsSync(realpathSync(root)),resources=requireResourceHeadroom({freeMemoryBytes:freemem(),freeDiskBytes:disk.bavail*disk.bsize,cpuBusyFraction,loadPerCpu:platform()==='win32'?null:loadavg()[0]!/before.length});
  return {resources,lease:lease?.path,release(){lease?.release()}};
 }catch(error){lease?.release();throw error}
}
