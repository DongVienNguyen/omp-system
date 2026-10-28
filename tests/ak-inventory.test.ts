import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from '../src/contracts';
import {installedAkInventory,resolveAkInstructions,akInstructionContext,type InstructionSources} from '../src/ak-inventory';

test('installed AK selection keeps exact names, ownership hashes, host identity and immutable dispatch context',()=>{
 const dir=mkdtempSync(join(import.meta.dir,'../.lab/ak-inventory-')),agentRoot=join(dir,'agent'),ownershipPath=join(dir,'ownership.json');
 try{
  mkdirSync(join(agentRoot,'agents'),{recursive:true});mkdirSync(join(agentRoot,'skills','ak-review'),{recursive:true});mkdirSync(join(agentRoot,'rules'),{recursive:true});
  const files=[{kind:'agent' as const,name:'Explore',path:join(agentRoot,'agents','Explore.md'),content:'---\nname: Explore\nmodel: forbidden-override\ntools: Bash\n---\nRead scoped inputs. Report facts only.'},{kind:'skill' as const,name:'ak-review',path:join(agentRoot,'skills','ak-review','SKILL.md'),content:'---\nname: ak-review\n---\nCheck actual behavior.'},{kind:'rule' as const,name:'development-rules',path:join(agentRoot,'rules','development-rules.md'),content:'Preserve public APIs.'}];
  for(const f of files)writeFileSync(f.path,f.content);writeFileSync(ownershipPath,JSON.stringify({claims:files.map(f=>({path:f.path,sha256:digest(f.content)}))}));
  const inventory=installedAkInventory({ownershipPath,agentRoot});expect(inventory.available).toBe(true);expect(inventory.entries).toHaveLength(3);expect(inventory.entries.every(e=>e.valid)).toBe(true);
  const selection={agent:{name:'Explore',sha256:digest(files[0].content)},skills:[{name:'ak-review',sha256:digest(files[1].content)}],rules:[{name:'development-rules',sha256:digest(files[2].content)}]},bundle=resolveAkInstructions(selection,inventory);akInstructionContext(bundle);
  expect(bundle.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(bundle.sources)).toBe(true);
  expect(()=>resolveAkInstructions({...selection,agent:{...selection.agent,name:'explore'}},inventory)).toThrow('missing');expect(()=>resolveAkInstructions({...selection,agent:{...selection.agent,sha256:'0'.repeat(64)}},inventory)).toThrow('hash mismatch');expect(()=>resolveAkInstructions({skills:[selection.skills[0],selection.skills[0]]},inventory)).toThrow('duplicate');
  const forged:InstructionSources={fingerprint:bundle.fingerprint,sources:bundle.sources};expect(()=>akInstructionContext(forged)).toThrow('not host resolved');
  const claims=files.map(f=>({path:f.path,sha256:digest(f.content)}));writeFileSync(ownershipPath,JSON.stringify({claims:[...claims,claims[0]]}));const duplicate=installedAkInventory({ownershipPath,agentRoot});expect(duplicate.available).toBe(false);expect(duplicate.errors.length).toBeGreaterThan(0);expect(duplicate.entries.filter(e=>e.name==='Explore').every(e=>!e.valid)).toBe(true);expect(()=>resolveAkInstructions(selection,duplicate)).toThrow('ambiguous');
  writeFileSync(ownershipPath,JSON.stringify({claims:[{...claims[0],path:join(agentRoot,'agents','explore.md')},...claims.slice(1)]}));const wrongCase=installedAkInventory({ownershipPath,agentRoot});expect(wrongCase.entries.find(e=>e.name==='explore')?.valid).toBe(false);expect(()=>resolveAkInstructions({...selection,agent:{...selection.agent,name:'explore'}},wrongCase)).toThrow('missing');writeFileSync(ownershipPath,JSON.stringify({claims}));
  writeFileSync(files[0].path,'mutated role');expect(()=>akInstructionContext(bundle)).toThrow('changed before dispatch');expect(()=>resolveAkInstructions(selection,inventory)).toThrow('changed');expect(installedAkInventory({ownershipPath,agentRoot}).entries.find(e=>e.name==='Explore')?.valid).toBe(false);
  expect(installedAkInventory({ownershipPath:join(dir,'missing'),agentRoot}).available).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
