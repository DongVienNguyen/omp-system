import { isAbsolute } from "node:path";
import {
	AgentRegistry,
	Settings,
	createAgentSession,
	type CreateAgentSessionOptions,
	type ExtensionFactory,
	type ToolDefinition,
} from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession as Session, SessionStats } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { buildOutputValidator } from "@oh-my-pi/pi-coding-agent/tools/output-schema-validator";
import { resolveThinkingLevelForModel,parseThinkingLevel,resolveProvisionalAutoLevel } from "@oh-my-pi/pi-tui/thinking";
import { BUILTIN_TOOL_NAMES, HIDDEN_TOOL_NAMES, normalizeToolName } from "@oh-my-pi/pi-coding-agent/tools/builtin-names";

import {akInstructionContext,type InstructionSources} from './ak-inventory';
import {effortRecoverySequence,canRecoverAttempt} from './effort-recovery';
export type WorkerThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "auto" | "xhigh" | "max";
import {TokenLedger,validateTokenLimits,type TokenLimits} from './token-limits';
export interface WorkerRequest {
	id: string;
	cwd: string;
	agentDir: string;
	model: { provider: string; id: string };
	thinkingLevel: WorkerThinkingLevel;
	systemPrompt: string;
	prompt: string;
	tools: ToolDefinition[];
	/** Cooperative deadline only; host process must enforce hard wall-clock limits. */
	timeoutMs: number;
 tokenLimits:TokenLimits;
	signal?: AbortSignal;
	outputSchema?: unknown;
	/** Trusted caller-owned factories. Their tools are never admitted. */
	extensions?: ExtensionFactory[];
	authStorage: NonNullable<CreateAgentSessionOptions["authStorage"]>;
	modelRegistry: NonNullable<CreateAgentSessionOptions["modelRegistry"]>;
 instructionSources?:InstructionSources;
 /** Host admission for each additional attempt; throws when budget exhausted. */
 reserveRetry?: (effort:WorkerThinkingLevel,attempt:number)=>void;
 readOnly?:boolean;
}

export interface WireObservation {
	provider?: string;
	model?: string;
	wireModel?: string;
	/** Only recognized nonsecret effort fields from actual provider payload. */
	effort: Record<string, string | number | boolean>;
}
export interface WorkerResult {
	id: string;
	status: "success" | "failed" | "cancelled" | "timed_out";
	reply: string;
	usage: SessionStats | null;
	structured: { status: "not_requested" | "valid" | "invalid"; data?: unknown };
 instructionFingerprint?:string;
 tokenBudget?:ReturnType<TokenLedger['status']>;
	wire: WireObservation[];
	error?: string;
	failure?: { category: "preflight" | "sdk" | "provider" | "output" | "cleanup"; code: string };
 authRejected?:boolean;
	disposed: boolean;
 recoveryStop?:'budget'|'deadline'|'cancelled';
 attempts?:{effort:string;resolvedEffort?:string;status:string;failure?:WorkerResult['failure'];wire:WireObservation[];usage:SessionStats|null;disposed:boolean}[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : undefined;

/** Never retain prompts, headers, URLs, credentials, or whole provider payloads. */
export function observeWire(payload: unknown, model?: { provider: string; id: string }): WireObservation {
	const body = record(payload);
	const effort: WireObservation["effort"] = {};
	const pick = (object: Record<string, unknown> | undefined, key: string, name: string) => {
		const value = object?.[key];
		if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") effort[name] = value;
		else if (typeof value === "string" && /^(off|none|disabled|enabled|adaptive|auto|minimal|low|medium|high|xhigh|max)$/i.test(value)) effort[name] = value;
	};
	pick(body, "reasoning_effort", "reasoning_effort");
	pick(record(body?.reasoning), "effort", "reasoning.effort");
	pick(record(body?.thinking), "type", "thinking.type");
	pick(record(body?.thinking), "budget_tokens", "thinking.budget_tokens");
	pick(record(body?.output_config), "effort", "output_config.effort");
	const google = record(record(body?.generationConfig)?.thinkingConfig);
	pick(google, "thinkingBudget", "generationConfig.thinkingConfig.thinkingBudget");
	pick(google, "thinkingLevel", "generationConfig.thinkingConfig.thinkingLevel");
	return { provider: model?.provider, model: model?.id,
		wireModel: typeof body?.model === "string" ? body.model : undefined, effort };
}

class WorkerFailure extends Error {
	constructor(readonly category: NonNullable<WorkerResult["failure"]>["category"], readonly code: string, message: string) {
		super(message);
	}
}

/** SDK still reads runtime build identity and cwd/agentDir metadata. Use private agentDir/profile in host. */

export async function runWorker(request:WorkerRequest):Promise<WorkerResult>{
 if(!Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<=0||request.timeoutMs>2_147_483_647)return runWorkerAttempt(request);
 let ledger:TokenLedger;try{ledger=new TokenLedger(request.tokenLimits)}catch{return {id:request.id,status:'failed',reply:'',usage:null,structured:{status:'invalid'},wire:[],disposed:true,failure:{category:'preflight',code:'invalid_token_limits'}}}
 const deadline=Date.now()+request.timeoutMs,attempts:NonNullable<WorkerResult['attempts']>=[];let terminal:WorkerResult|undefined;
 for(const effort of effortRecoverySequence(request.thinkingLevel)){
  if(attempts.length){if(request.signal?.aborted)return {...terminal!,status:'cancelled',wire:attempts.flatMap(a=>a.wire),attempts,recoveryStop:'cancelled'};if(Date.now()>=deadline)return {...terminal!,wire:attempts.flatMap(a=>a.wire),attempts,recoveryStop:'deadline'};if(!request.reserveRetry)return {...terminal!,wire:attempts.flatMap(a=>a.wire),attempts,recoveryStop:'budget'};try{request.reserveRetry(effort as WorkerThinkingLevel,attempts.length+1)}catch{return {...terminal!,wire:attempts.flatMap(a=>a.wire),attempts,recoveryStop:'budget'}}}
  const result=await runWorkerAttempt({...request,thinkingLevel:effort as WorkerThinkingLevel,timeoutMs:Math.max(1,deadline-Date.now())},ledger);attempts.push({effort,resolvedEffort:result.wire[0]?.effort.reasoning_effort as string|undefined,status:result.status,failure:result.failure,wire:result.wire,usage:result.usage,disposed:result.disposed});
  terminal=result;
  if(!canRecoverAttempt(result,request.readOnly)||attempts.length===effortRecoverySequence(request.thinkingLevel).length)return {...result,wire:attempts.flatMap(a=>a.wire),attempts};
 }
 return {...terminal!,wire:attempts.flatMap(a=>a.wire),attempts};
}
async function runWorkerAttempt(request: WorkerRequest,ledger?:TokenLedger): Promise<WorkerResult> {
	const result: WorkerResult = {
		id: request.id, status: "failed", reply: "", usage: null,
		structured: { status: request.outputSchema === undefined ? "not_requested" : "invalid" },
		wire: [], disposed: false,
	};
	let session: Session | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stop: "cancelled" | "timed_out" | undefined;
 let tokenFailure:string|undefined;
	let aborting: Promise<void> | undefined;
	const stopRun = (reason: "cancelled" | "timed_out") => {
		stop ??= reason;
		if (session && !aborting) aborting = session.abort().catch(() => undefined);
	};
	const cancel = () => stopRun("cancelled");
	const started = Date.now();
	try {
		const reject = (code: string, message: string): never => { throw new WorkerFailure("preflight", code, message); };
		if (typeof request.id !== "string" || !request.id.trim() || typeof request.cwd !== "string" || !isAbsolute(request.cwd) || typeof request.agentDir !== "string" || !isAbsolute(request.agentDir)) reject("invalid_identity", "id and absolute cwd/agentDir required");
		if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 2_147_483_647) reject("invalid_timeout", "timeoutMs must be positive timer-safe integer");
  try{validateTokenLimits(request.tokenLimits);ledger??=new TokenLedger(request.tokenLimits)}catch{reject('invalid_token_limits','Explicit token/output limits required')}
		if (typeof request.prompt !== "string" || typeof request.systemPrompt !== "string") reject("invalid_prompt", "prompt and systemPrompt must be strings");
 const instructionContext=request.instructionSources?akInstructionContext(request.instructionSources):'';if(request.instructionSources)result.instructionFingerprint=request.instructionSources.fingerprint;
		if (!["off", "minimal", "low", "medium", "high", "auto", "xhigh", "max"].includes(request.thinkingLevel)) reject("invalid_effort", "Concrete thinkingLevel required");
		if (!request.authStorage || !request.modelRegistry || request.modelRegistry.authStorage !== request.authStorage) reject("invalid_auth", "Caller authStorage and matching modelRegistry required");
		if (typeof request.model?.provider !== "string" || !request.model.provider.trim() || typeof request.model.id !== "string" || !request.model.id.trim()) reject("invalid_model", "Exact provider/id required");
		if (!Array.isArray(request.tools)) reject("invalid_tools", "Explicit tools array required");
		const names = request.tools.map(tool => tool?.name);
        if(request.readOnly&&names.some(name=>name!=='workspace_read'))reject('invalid_readonly_tools','Readonly recovery allows only scoped read tools');
		const reserved = new Set<string>([...BUILTIN_TOOL_NAMES, ...HIDDEN_TOOL_NAMES]);
		if (new Set(names).size !== names.length || names.some(name => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || reserved.has(normalizeToolName(name)) || name.toLowerCase().startsWith("mcp__"))) reject("invalid_tool_names", "Unique nonreserved custom tool names required");
		if (request.tools.some(tool => typeof tool.execute !== "function" || !record(tool.parameters))) reject("invalid_tools", "Custom tool execute and parameter schema required");
		if (request.extensions !== undefined && (!Array.isArray(request.extensions) || request.extensions.some(factory => typeof factory !== "function"))) reject("invalid_extensions", "Explicit extension factories required");
        if(request.readOnly&&request.extensions?.length)reject('invalid_readonly_extensions','Readonly recovery cannot run executable extensions');
		const schema = buildOutputValidator(request.outputSchema);
		if (schema.error) reject("invalid_output_schema", "Invalid outputSchema");
		if (request.signal?.aborted) { stop = "cancelled"; result.status = stop; return result; }
		const model = request.modelRegistry.find(request.model.provider, request.model.id);
		if (!model || model.provider !== request.model.provider || model.id !== request.model.id) throw new WorkerFailure("preflight", "model_not_found", "Exact model not found");
        const requestedLevel=request.thinkingLevel==='auto'?resolveProvisionalAutoLevel(model):parseThinkingLevel(request.thinkingLevel);
        if(requestedLevel===undefined||resolveThinkingLevelForModel(model,requestedLevel)!==requestedLevel)reject("unsupported_effort","Model cannot honor exact thinkingLevel");
        const thinkingLevel=requestedLevel;
		request.signal?.addEventListener("abort", cancel, { once: true });
		timer = setTimeout(() => stopRun("timed_out"), Math.max(1, request.timeoutMs - (Date.now() - started)));
		const observer: ExtensionFactory = api => {
			api.on("before_provider_request", (event, context) => {
				result.wire.push(observeWire(event.payload, context.model));
			});
   let finalized=false;
   const account=(message:Parameters<TokenLedger['observe']>[0])=>{try{ledger!.observe(message)}catch(error){tokenFailure??=error instanceof Error?error.message:'output_budget_exhausted';}};
   api.on('assistant_message',event=>{account(event.message);finalized=true;});
   api.on('message_end',event=>{if(event.message.role==='assistant'){if(!finalized)account(event.message);finalized=false;}});
   api.on('tool_call',()=>{if(!tokenFailure&&(ledger!.status().outputTokens>=ledger!.limits.max_output_tokens||ledger!.status().outputBytes>=ledger!.limits.max_output_bytes))tokenFailure='output_budget_exhausted';return tokenFailure?{block:true,reason:tokenFailure}:undefined});
		};
		const settings = Settings.isolated({
			"memory.backend": "off", "autolearn.enabled": false,
			"retry.enabled": false, "retry.maxRetries": 0,
			"retry.modelFallback": false, "retry.usageAwareFallback": false,
			"retry.fallbackChains": {}, "compaction.enabled": false,
			"ttsr.enabled": false, "includeWorkspaceTree": false,
   "tools.speculativeExecution.enabled": false, "task.speculativeLaunch": false,
		});
		const created = await createAgentSession({
			cwd: request.cwd, agentDir: request.agentDir, settings,
			authStorage: request.authStorage, modelRegistry: request.modelRegistry,
            model, thinkingLevel, rebindModelAfterDiscovery: false,
			bindProcessState: false, sessionManager: SessionManager.inMemory(request.cwd),
			agentRegistry: new AgentRegistry(), agentId: request.id,
			parentTaskPrefix: request.id, taskDepth: 1,
   systemPrompt: request.systemPrompt+instructionContext,
			// SDK18.12.6 otherwise treats ToolDefinition as legacy CustomTool (different execute argument order).
			customTools: request.tools.map(tool => ({ ...tool, __isToolDefinition: true })),
			toolNames: names, restrictToolNames: true, allowRestrictedCustomTools: true,
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			workspaceTree: { rootPath: request.cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
			disableExtensionDiscovery: true, preloadedCustomToolPaths: [],
			preloadedPreparedExtensions: [...(request.extensions ?? []), observer].map((factory, index) => ({
				path: `<inline-${index}>`, resolvedPath: `<inline-${index}>`, factory, error: null,
			})),
			enableMCP: false, enableLsp: false, enableIrc: false, skipPythonPreflight: true,
			requireYieldTool: false, cacheWarming: false, suppressAutoPrewalk: true,
			// SDK starts online model discovery for hasUI:false, even with explicit model.
			hasUI: true, interactivePrompts: false, autoTitle: false, autoApprove: true,
			allowSessionModelFallback: false, deadline: started + request.timeoutMs,
		});
  const providerStream=created.session.agent.streamFn;created.session.agent.streamFn=(model,context,options)=>{try{if(tokenFailure)throw Error(tokenFailure);const maxTokens=ledger!.remaining({context,tools:request.tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters}))});return providerStream(model,context,{...options,maxTokens:Math.min(maxTokens,options?.maxTokens??maxTokens),maxHttpAttempts:1})}catch(error){tokenFailure=error instanceof Error?error.message:'output_budget_exhausted';throw new WorkerFailure('output',tokenFailure,'Frozen token/output budget exhausted')}};
		session = created.session;
		if (stop || Date.now() >= started + request.timeoutMs) {
			stopRun(stop ?? "timed_out");
		} else {
			if (created.extensionsResult.errors.length) throw new Error("Explicit extension failed to load");
			if (session.model?.provider !== model.provider || session.model.id !== model.id || session.thinkingLevel !== thinkingLevel) throw Error("SDK changed exact model/effort");
			const enabled = session.getEnabledToolNames();
			if (enabled.length !== names.length || enabled.some(name => !names.includes(name))) throw new Error("SDK tool allowlist mismatch");
			await session.prompt(request.prompt, { runCommands: false, expandPromptTemplates: false, throwOnDrop: true, skipCompactionCheck: true });
			await session.waitForIdle();
			while (!stop && session.hasPendingAsyncWork()) await session.settleAsyncWork();
			const last = session.getLastAssistantMessage();
   if(last?.stopReason==='error'&&/\b(?:401|403)\b|unauthori[sz]ed|invalid (?:api[ -]?)?(?:key|token)|authentication (?:failed|required)/i.test(last.errorMessage??''))result.authRejected=true;
			result.reply = last?.content.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
			result.usage = session.getSessionStats();
   result.tokenBudget=ledger!.status();if(tokenFailure)throw new WorkerFailure('output',tokenFailure,'Frozen token/output budget exhausted');if(last?.stopReason==='length')throw new WorkerFailure('output','output_budget_exhausted','Provider output ceiling reached');
            if (!last || last.stopReason === "error" || last.stopReason === "aborted") { const error=typeof last?.errorMessage==='string'?last.errorMessage:'',rateLimited=/\b429\b|rate.limit|too many requests/i.test(error),authRejected=/\b(?:401|403)\b|unauthori[sz]ed|invalid (?:api[ -]?)?(?:key|token)|authentication (?:failed|required)/i.test(error);throw new WorkerFailure("provider",rateLimited?'rate_limited':authRejected?'auth_rejected':'incomplete_reply',rateLimited?'Provider rate limited; launch admission stopped':authRejected?'Provider rejected credentials; operator refresh required':'Provider did not complete successfully'); }
			if (!result.wire.length) throw new WorkerFailure("provider", "missing_wire_observation", "No before_provider_request observed");
			if (request.outputSchema !== undefined) {
				const data: unknown = JSON.parse(result.reply);
				const normalized = schema.validator?.normalize(data) ?? data;
				if (schema.validator && !schema.validator.validate(normalized).success) throw new WorkerFailure("output", "schema_violation", "Reply violates outputSchema");
				result.structured = { status: "valid", data: normalized };
			}
			result.status = "success";
		}
	} catch (error) {
		// Do not expose SDK/provider error bodies: may contain credentials or request data.
		result.failure = error instanceof WorkerFailure ? { category: error.category, code: error.code }
			: error instanceof SyntaxError ? { category: "output", code: "invalid_json" } : { category: "sdk", code: "sdk_failure" };
        if(result.failure.code==='auth_rejected')result.authRejected=true;
		result.error = error instanceof WorkerFailure ? error.message : error instanceof SyntaxError ? "Reply is not JSON" : "Worker failed; inspect trusted host diagnostics";
	} finally {
  if(ledger)result.tokenBudget=ledger.status();
		clearTimeout(timer);
		request.signal?.removeEventListener("abort", cancel);
		if (session) {
			try {
				if (stop) stopRun(stop);
				await aborting;
				result.usage ??= session.getSessionStats();
				if (!result.reply) result.reply = session.getLastAssistantMessage()?.content.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
				await session.dispose({ drainTimeoutMs: Math.max(0, started + request.timeoutMs - Date.now()) });
				result.disposed = true;
			} catch {
				result.status = "failed";
				result.error = "Session cleanup failed";
				result.failure = { category: "cleanup", code: "dispose_failed" };
			}
		} else result.disposed = true;
		if (stop) result.status = stop;
	}
  if(tokenFailure){result.reply='';result.structured={status:request.outputSchema===undefined?'not_requested':'invalid'};if(result.failure?.category!=='cleanup'){result.status=stop??'failed';result.failure=result.authRejected?{category:'provider',code:'auth_rejected'}:{category:'output',code:tokenFailure};result.error=result.authRejected?'Provider rejected credentials; operator refresh required':'Frozen token/output budget exhausted';}}
	return result;
}
