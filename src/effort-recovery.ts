export const recoveryEfforts=['low','medium','high','auto'] as const;
export type RecoveryEffort=typeof recoveryEfforts[number];
export function effortRecoverySequence(initial:string):readonly string[]{const index=recoveryEfforts.indexOf(initial as RecoveryEffort);return index<0?[initial]:recoveryEfforts.slice(index)}
export function canRecoverAttempt(result:{status:string;disposed:boolean;failure?:{category:string;code:string};usage?:{toolCalls?:number}|null},readOnly=false){
 if(!['failed','timed_out'].includes(result.status)||!result.disposed||(!readOnly&&(result.usage?.toolCalls??0)>0))return false;
 if(result.status==='timed_out'&&!result.failure)return true;
 return result.failure?.category==='provider'&&['incomplete_reply','missing_wire_observation'].includes(result.failure.code)||result.failure?.category==='preflight'&&['unsupported_effort','model_not_found'].includes(result.failure.code);
}
