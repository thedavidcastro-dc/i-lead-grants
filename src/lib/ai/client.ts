import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * The one door every model call goes through.
 * - Structured output via a single forced tool call whose input_schema is the JSON schema.
 * - Output validated with zod before it is returned or stored.
 * - Every call logged to grants.ai_calls with tokens and cost.
 */

export const MODELS = {
  extract: process.env.AI_MODEL_EXTRACT ?? "claude-sonnet-5",
  draft: process.env.AI_MODEL_DRAFT ?? "claude-sonnet-5",
  suggest: process.env.AI_MODEL_SUGGEST ?? "claude-haiku-4-5",
  budget: process.env.AI_MODEL_BUDGET ?? "claude-opus-5",
} as const;

// USD per million tokens (input, output). Update when Anthropic's price list changes.
const PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-opus-5": [5, 25],
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title?: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string } };

export type TaskName =
  | "extract_budget" | "map_lines" | "classify" | "draft_submission" | "extract_payroll" | "allocate_payroll" | "extract_rules";

export type RunOptions<T> = {
  task: TaskName;
  model?: string;
  system: string;
  content: ContentBlock[];
  schema: ZodType<T>;
  jsonSchema: Record<string, unknown>;   // JSON schema for the tool input (mirrors `schema`)
  entity?: string;
  entityId?: string;
  userId?: string | null;
  maxTokens?: number;
};

export type RunResult<T> = { data: T; inputTokens: number; outputTokens: number; costUsd: number; model: string; callId: number | null };

export async function runTask<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  const model = opts.model ?? MODELS[opts.task === "classify" ? "suggest" : "extract"];
  const toolName = `submit_${opts.task}`;
  const db = createAdminClient().schema("grants");
  const started = Date.now();

  let inputTokens = 0, outputTokens = 0, status = "ok", errorText: string | null = null, parsed: T | null = null;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      tools: [{ name: toolName, description: "Return the result in the required structure.", input_schema: opts.jsonSchema as Anthropic.Tool["input_schema"] }],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: opts.content as Anthropic.MessageParam["content"] }],
    });
    inputTokens = res.usage.input_tokens;
    outputTokens = res.usage.output_tokens;
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model returned no structured result");
    const check = opts.schema.safeParse(block.input);
    if (!check.success) throw new Error("Model output failed validation: " + check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    parsed = check.data;
  } catch (e) {
    status = "error";
    errorText = e instanceof Error ? e.message : String(e);
  }

  const [pi, po] = PRICES[model] ?? [0, 0];
  const costUsd = (inputTokens * pi + outputTokens * po) / 1e6;
  const { data: logged } = await db
    .from("ai_calls")
    .insert({
      task: opts.task, model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd, status,
      entity: opts.entity ?? null, entity_id: opts.entityId ?? null, user_id: opts.userId ?? null,
      response: status === "ok" ? { result: parsed, ms: Date.now() - started } : { error: errorText, ms: Date.now() - started },
    })
    .select("id")
    .single();

  if (status !== "ok" || parsed === null) throw new Error(errorText ?? "AI call failed");
  return { data: parsed, inputTokens, outputTokens, costUsd, model, callId: logged?.id ?? null };
}

/** Helper: text block */
export const text = (t: string): ContentBlock => ({ type: "text", text: t });

export { z };
