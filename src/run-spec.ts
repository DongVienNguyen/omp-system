import { readFileSync } from 'node:fs';
import { validateJsonSchemaValue } from '@oh-my-pi/pi-ai/utils/schema';
import { validateTasks,safeRelative,validateRuntimeProof } from './contracts';
import type { RunSpec } from './coordinator';
import {assertSnapshotCommand} from './command-identity';
const schema=JSON.parse(readFileSync(new URL('../schemas/omp-system.v1.json',import.meta.url),'utf8'));
export function parseRunSpec(value:unknown):RunSpec {
 const result=validateJsonSchemaValue(schema,value);
 if(!result.success)throw Error('Invalid run specification: '+JSON.stringify(result.issues));
 const spec=value as RunSpec;
 validateTasks(spec.tasks);
 for(const task of spec.tasks){
  const commands=spec.checks[task.id];
  if(!commands?.length||new Set(commands.map(c=>c.id)).size!==commands.length)throw Error('Unique required checks missing for '+task.id);
  for(const command of commands)assertSnapshotCommand(command);
  for(const c of commands){c.input_scope?.forEach(safeRelative);if(c.runner==='command'){validateRuntimeProof(c.proof);if(c.testCount!==undefined||c.noTestsReason)throw Error('Command runtime proof cannot claim tests')}else if(c.proof)throw Error('Test runner cannot use command proof')}
 }
 if(Object.keys(spec.checks).some(id=>!spec.tasks.some(t=>t.id===id)))throw Error('Check-plan names an unknown task');
 return spec;
}
