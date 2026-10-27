import { Store } from './state';
import { digest,type Task } from './contracts';
import type { RunSpec } from './coordinator';
export function validateContinuation(store:Store,spec:RunSpec){
 const saved=store.get<RunSpec>('run-spec',spec.id),run=store.get<any>('run',spec.id),source=store.get<{source:string;generation:string}>('run-source',spec.id);
 if(!saved||!run||!source||source.generation!==run.generation||run.cancelled)throw Error('Run is not safely resumable');
 const shape=(s:RunSpec)=>({project:s.project,tasks:s.tasks,checks:s.checks,trustedCode:s.trustedCode});
 if(digest(shape(saved))!==digest(shape(spec)))throw Error('Continuation changes frozen intent/check-plan');
 for(const key of ['concurrency','max_worker_calls','max_rollouts','max_stages','max_transport_retries','max_repairs'] as const)if(spec.budget[key]>saved.budget[key])throw Error('Continuation may not widen approved resource caps');
 const pending=store.list<any>('dispatch').filter(d=>d.run===spec.id&&d.state!=='settled');if(pending.length)throw Error('Unknown or pending workers must reconcile before continuation');
 const tasks=store.list<Task & {run:string}>('task').filter(t=>t.run===spec.id);
 if(tasks.some(t=>['RUNNING','VERIFYING','CANCEL_REQUESTED'].includes(t.state)))throw Error('Live or interrupted task requires reconciliation');
 if(tasks.some(t=>['BLOCKED','FAILED'].includes(t.state)))throw Error('Failed/blocked tasks require explicit repair, not replay');
 return {source:source.source,tasks:tasks.filter(t=>['PLANNED','READY'].includes(t.state))};
}
