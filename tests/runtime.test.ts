import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { observeWire, runWorker, type WorkerRequest } from "../src/runtime";

// Boundary fixtures only: no session, credential access, or provider execution permitted.
function boundaryRequest(): WorkerRequest {
	const authStorage = {} as WorkerRequest["authStorage"];
	return {
		tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},
		id: "boundary-worker", cwd: resolve("."), agentDir: resolve("private-worker-profile"),
		model: { provider: "boundary-provider", id: "boundary-model" }, thinkingLevel: "off",
		systemPrompt: "private system prompt", prompt: "private user prompt", tools: [], timeoutMs: 1000,
		authStorage,
		modelRegistry: {
			authStorage,
			find() { throw new Error("Unexpected model lookup; boundary must stop before SDK startup"); },
		} as unknown as WorkerRequest["modelRegistry"],
	};
}

async function rejectsBoundary(overrides: Partial<WorkerRequest>, code: string): Promise<void> {
	const result = await runWorker({...boundaryRequest(), ...overrides});
	assert.equal(result.status, "failed");
	assert.deepEqual(result.failure, { category: "preflight", code });
	assert.equal(result.disposed, true);
	assert.equal(result.usage, null);
	assert.equal(result.reply, "");
	assert.deepEqual(result.wire, []);
	assert.ok(!JSON.stringify(result).includes("private user prompt"));
}

function tool(name: string): WorkerRequest["tools"][number] {
	return {
		name, label: name, description: "Boundary fixture", parameters: { type: "object", properties: {} },
		execute: async () => { throw new Error("Boundary tool must never execute"); },
	} as WorkerRequest["tools"][number];
}

test("observeWire retains model and recognized actual effort, not provider secrets", () => {
	const observation = observeWire({
		model: "actual-wire-model", reasoning_effort: "high",
		reasoning: { effort: "medium", summary: "secret reasoning" },
		thinking: { type: "enabled", budget_tokens: 1024, token: "secret thinking" },
		output_config: { effort: "max" },
		generationConfig: { thinkingConfig: { thinkingBudget: -1, thinkingLevel: "HIGH" } },
		headers: { authorization: "Bearer secret" }, api_key: "secret key",
		messages: [{ content: "secret prompt" }], url: "https://user:secret@example.test",
	}, { provider: "actual-provider", id: "selected-model" });
	assert.deepEqual(observation, {
		provider: "actual-provider", model: "selected-model", wireModel: "actual-wire-model",
		effort: {
			reasoning_effort: "high", "reasoning.effort": "medium", "thinking.type": "enabled",
			"thinking.budget_tokens": 1024, "output_config.effort": "max",
			"generationConfig.thinkingConfig.thinkingBudget": -1,
			"generationConfig.thinkingConfig.thinkingLevel": "HIGH",
		},
	});
	assert.ok(!JSON.stringify(observation).includes("secret"));
});

test("observeWire ignores unsupported effort, nonfinite values, missing payloads", () => {
	for (const payload of [undefined, null, [], "secret", { reasoning_effort: "secret", thinking: { budget_tokens: Infinity }, output_config: { effort: { token: "secret" } } }]) {
		assert.deepEqual(observeWire(payload), { provider: undefined, model: undefined, wireModel: undefined, effort: {} });
	}
});

test("preflight rejects missing or divergent caller auth without SDK startup", async () => {
	await rejectsBoundary({ authStorage: undefined as unknown as WorkerRequest["authStorage"] }, "invalid_auth");
	await rejectsBoundary({ modelRegistry: undefined as unknown as WorkerRequest["modelRegistry"] }, "invalid_auth");
	await rejectsBoundary({ authStorage: {} as WorkerRequest["authStorage"] }, "invalid_auth");
});

test("preflight rejects invalid exact model selectors", async () => {
	for (const model of [{ provider: "", id: "model" }, { provider: "provider", id: " " }]) {
		await rejectsBoundary({ model }, "invalid_model");
	}
	const request = boundaryRequest();
	request.modelRegistry = { authStorage: request.authStorage, find: () => undefined } as unknown as WorkerRequest["modelRegistry"];
	const result = await runWorker(request);
	assert.deepEqual(result.failure, { category: "preflight", code: "model_not_found" });
	assert.deepEqual(result.wire, []);
	assert.equal(result.disposed, true);
});

test("preflight rejects duplicate, ambient, alias, and malformed tool names", async () => {
	for (const names of [["same", "same"], [""], ["bad name"], ["bash"], ["TASK"], ["search"], ["yield"], ["mcp__server_tool"]]) {
		await rejectsBoundary({ tools: names.map(tool) }, "invalid_tool_names");
	}
});

test("preflight rejects unsafe deadlines", async () => {
	for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
		await rejectsBoundary({ timeoutMs }, "invalid_timeout");
	}
});

test("pre-aborted request returns cancelled with no model lookup or inference", async () => {
	const controller = new AbortController();
	controller.abort("private cancellation reason");
	const result = await runWorker({...boundaryRequest(), tools: [tool("allowed_custom")], signal: controller.signal});
	assert.equal(result.status, "cancelled");
	assert.equal(result.disposed, true);
	assert.equal(result.failure, undefined);
	assert.equal(result.error, undefined);
	assert.equal(result.usage, null);
	assert.equal(result.reply, "");
	assert.deepEqual(result.wire, []);
	assert.ok(!JSON.stringify(result).includes("private cancellation reason"));
});
