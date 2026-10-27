export interface TokenLimits {max_output_tokens:number;max_input_bytes:number;max_output_bytes:number;}
export function validateTokenLimits(value:TokenLimits){for(const key of ['max_output_tokens','max_input_bytes','max_output_bytes'] as const)if(!Number.isSafeInteger(value?.[key])||value[key]<1)throw Error('Explicit positive token/output limits required');return value;}
/** Per-worker ceiling across provider turns and admitted effort attempts, not a tokenizer estimate. */
export class TokenLedger {
 private outputTokens=0;private outputBytes=0;
 readonly limits:Readonly<TokenLimits>;
 constructor(limits:TokenLimits){validateTokenLimits(limits);this.limits=Object.freeze({max_output_tokens:limits.max_output_tokens,max_input_bytes:limits.max_input_bytes,max_output_bytes:limits.max_output_bytes})}
 remaining(input:unknown){const bytes=Buffer.byteLength(JSON.stringify(input),'utf8');if(bytes>this.limits.max_input_bytes)throw Error('input_byte_limit');const remaining=this.limits.max_output_tokens-this.outputTokens;if(remaining<1||this.outputBytes>=this.limits.max_output_bytes)throw Error('output_budget_exhausted');return remaining;}
 observe(message:{content:unknown;usage?:{output?:number}}){const tokens=message.usage?.output;this.outputBytes+=Buffer.byteLength(JSON.stringify(message.content),'utf8');if(!Number.isSafeInteger(tokens)||tokens!<0||(tokens===0&&Array.isArray(message.content)&&message.content.length>0))throw Error('output_usage_unknown');this.outputTokens+=tokens!;if(this.outputTokens>this.limits.max_output_tokens||this.outputBytes>this.limits.max_output_bytes)throw Error('output_budget_exhausted');}
 status(){return {outputTokens:this.outputTokens,outputBytes:this.outputBytes,...this.limits,inputMeasure:'UTF8_BYTES' as const,outputMeasure:'PROVIDER_REPORTED_TOKENS' as const};}
}
