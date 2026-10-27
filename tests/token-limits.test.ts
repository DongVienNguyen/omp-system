import {test,expect} from 'bun:test';
import {TokenLedger} from '../src/token-limits';

test('worker ceilings remain frozen and cumulative across attempts',()=>{
 const limits={max_output_tokens:10,max_input_bytes:32,max_output_bytes:100};
 const ledger=new TokenLedger(limits);limits.max_output_tokens=100;
 expect(ledger.remaining('ok')).toBe(10);
 ledger.observe({content:'first',usage:{output:6}});
 expect(ledger.remaining('retry')).toBe(4);
 ledger.observe({content:'last',usage:{output:4}});
 expect(()=>ledger.remaining('next')).toThrow('output_budget_exhausted');
});
test('input bytes, output bytes and missing usage fail closed',()=>{
 const limits={max_output_tokens:10,max_input_bytes:4,max_output_bytes:4};
 expect(()=>new TokenLedger(limits).remaining('éé')).toThrow('input_byte_limit');
 expect(()=>new TokenLedger(limits).observe({content:'hello',usage:{output:1}})).toThrow('output_budget_exhausted');
 expect(()=>new TokenLedger(limits).observe({content:'x'})).toThrow('output_usage_unknown');
 expect(()=>new TokenLedger(limits).observe({content:[{type:'text',text:'partial'}],usage:{output:0}})).toThrow('output_usage_unknown');
});
