import { test, expect } from 'bun:test';
import { childEnvironment, profileRoot, requireHeadroom, root, within } from '../scripts/dev-preflight';

test('scope rejects sibling and parent escapes while allowing child paths', () => {
  expect(within(root, root)).toBe(true);
  expect(within(root, `${root}/.lab/workspaces`)).toBe(true);
  expect(within(root, `${root}-other`)).toBe(false);
  expect(within(root, `${root}/../other`)).toBe(false);
});
test('unknown profiles cannot reuse arbitrary user state', () => {
  expect(() => profileRoot('default')).toThrow('Unknown lab profile');
});
test('insufficient disk headroom refuses allocation', () => {
  expect(() => requireHeadroom(root, Number.MAX_SAFE_INTEGER)).toThrow('Insufficient disk headroom');
  expect(() => requireHeadroom(root, 0)).toThrow('Invalid disk headroom limit');
});
test('lab inherits explicit API credential without inheriting main profile routing',()=>{
 const keys=['OMP_SYSTEM_API_KEY','OMP_PROFILE','CREWS_SCOPE'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.OMP_SYSTEM_API_KEY='local-fixture-not-a-key';process.env.OMP_PROFILE='foreign-main';process.env.CREWS_SCOPE='foreign';const child=childEnvironment('omp-system-dev');expect(child.OMP_SYSTEM_API_KEY).toBe('local-fixture-not-a-key');expect(child.OMP_PROFILE).toBe('omp-system-dev');expect(child.CREWS_SCOPE).toBeUndefined();}finally{for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
});
