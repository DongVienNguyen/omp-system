import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {acquireLiveExperiment,requireResourceHeadroom} from '../src/resource-admission';
test('resource pressure and unknown CPU deny before launch',()=>{
 const good={freeMemoryBytes:256*1024**2,freeDiskBytes:2*1024**3,cpuBusyFraction:0.5,loadPerCpu:null};expect(requireResourceHeadroom(good)).toEqual(good);
 expect(()=>requireResourceHeadroom({...good,freeMemoryBytes:good.freeMemoryBytes-1})).toThrow('memory');expect(()=>requireResourceHeadroom({...good,freeDiskBytes:good.freeDiskBytes-1})).toThrow('disk');expect(()=>requireResourceHeadroom({...good,cpuBusyFraction:NaN})).toThrow('unknown');expect(()=>requireResourceHeadroom({...good,cpuBusyFraction:0.95})).toThrow('CPU utilization');expect(()=>requireResourceHeadroom({...good,loadPerCpu:1})).toThrow('system load');
});
test('exclusive live lease rejects second launch and never removes changed owner',()=>{
 const root=realpathSync(mkdtempSync(join(import.meta.dir,'../.lab/admission-'))),lab=join(root,'.lab');mkdirSync(lab);writeFileSync(join(lab,'.omp-system-owner.json'),JSON.stringify({owner:'omp-system/lab-v1',source:root}));
 try{const first=acquireLiveExperiment(root);expect(()=>acquireLiveExperiment(root)).toThrow('existing or unknown');first.release();const next=acquireLiveExperiment(root);writeFileSync(next.path,'foreign');expect(()=>next.release()).toThrow('ownership changed');expect(readFileSync(next.path,'utf8')).toBe('foreign')}finally{rmSync(root,{recursive:true,force:true})}
});
test('foreign lab denied without writing live lock',()=>{
 const root=realpathSync(mkdtempSync(join(import.meta.dir,'../.lab/admission-'))),lab=join(root,'.lab');mkdirSync(lab);writeFileSync(join(lab,'.omp-system-owner.json'),JSON.stringify({owner:'foreign',source:root}));try{expect(()=>acquireLiveExperiment(root)).toThrow('owned lab')}finally{rmSync(root,{recursive:true,force:true})}
});
