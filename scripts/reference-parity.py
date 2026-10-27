"""Execute pinned upstream scheduling functions unchanged with deterministic numeric stage substrate."""
import ast,sys,json,types,tempfile,hashlib
from pathlib import Path
from dataclasses import dataclass,field
from concurrent.futures import ThreadPoolExecutor
source=Path(sys.argv[1]).read_text(encoding='utf8')
assert hashlib.sha256(source.encode()).hexdigest()=='b299813b5334f2c0f89024a7f14162f0fdd5418ebd4413be93920b5334a204c1', 'Pinned reference source changed'
tree=ast.parse(source)
selected=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in {'ModeResult','run_parallel','run_sequential'}]
@dataclass
class Ledger:
 mode:str;task_id:str;k:int
 def __post_init__(self):self.rows=[]
 def rollout(self,label):self.rows.append('rollout:'+label)
 def assert_identity(self):assert len(self.rows)==7*self.k
 def to_dict(self):return self.rows
class HarnessTree:
 Tree=dict
 @staticmethod
 def write_tree(surface,tree,path):path.mkdir(parents=True,exist_ok=True);return path
 @staticmethod
 def diversity(trees):return {}
class Prompts:
 @staticmethod
 def propose(*args,**kwargs):return ''
 @staticmethod
 def aggregate(*args,**kwargs):return ''
 @staticmethod
 def compose_round(*args,**kwargs):return ''
class Run:
 def __init__(self,label,bias=0):self.label=label;self.run_id='run-'+label;self.bias=bias;self.ok=True;self.delivered=True
class Adapter:
 substrate=types.SimpleNamespace(surface=lambda:None)
def stage(**kw):
 label,dim=kw['label'],kw['dim'];i=int(''.join(c for c in label if c.isdigit()));base=kw['fallback']['bias']
 if dim=='INV':bias=base+i
 elif dim=='DOM':bias=base+10*i
 else:
  pool=kw.get('pool',[]);pool=pool[-2:] if dim=='COMPOSE' else pool
  bias=sum(item[2].bias for item in pool)+i
 return types.SimpleNamespace(label=label,tree={'bias':bias},notes='',error='')
def record(ledger,stages):
 for s in stages:ledger.rows.append('session:'+s.label)
def roll(adapter,ledger,task_id,label,tree,*args):ledger.rollout(label);return Run(label,tree['bias'])
def rolls(adapter,ledger,task_id,items,*args,**kwargs):return {label:roll(adapter,ledger,task_id,label,tree) for label,tree in items}
namespace=dict(Sequence=list,RunView=Run,BenchmarkAdapter=Adapter,Proposer=object,Path=Path,dataclass=dataclass,field=field,Callable=object,Ledger=Ledger,harness_tree=HarnessTree,ThreadPoolExecutor=ThreadPoolExecutor,PHASE_WIDTH=2,resolve_prompts=lambda *_:None,prompts=Prompts,_run_stage=stage,_record_sessions=record,_roll=roll,_roll_many=rolls)
# Future annotations preserve source type expressions without importing upstream CLI channels.
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0)]+selected,type_ignores=[])),'<pinned-harness2>','exec'),namespace)
results=[]
with tempfile.TemporaryDirectory(prefix='omp-reference-') as temp:
 for mode in ['agg','seq']:
  for k in [1,2]:
   fn=namespace['run_parallel' if mode=='agg' else 'run_sequential'];r=fn('sum/one',k,[Run('base'+str(i+1)) for i in range(k)],adapter=Adapter(),prop=None,work_dir=Path(temp)/mode/str(k),run_id_of=lambda x:x,base_tree={'bias':0},propose_workers=1,rollout_workers=1)
   results.append(dict(mode=mode,k=k,stages=[s.label for s in r.stages],finals=r.finals,biases=[r.trees[x]['bias'] for x in r.finals],trace=r.ledger.rows))
print(json.dumps(results))
