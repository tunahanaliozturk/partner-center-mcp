// LLM tool-selection eval: proves the tools' names/descriptions lead a real model
// to pick the right tool for a natural-language question.
// Needs ANTHROPIC_API_KEY. Model via EVAL_MODEL (default claude-haiku-4-5).
// Skips gracefully (exit 0) when no key is set. Requires `npm run build` first.
import { readFileSync } from "node:fs";
import { allTools } from "../dist/tools/index.js";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.log("eval:llm skipped — set ANTHROPIC_API_KEY to run the LLM tool-selection eval.");
  process.exit(0);
}

const model = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
const cases = JSON.parse(readFileSync(new URL("../data/evals-llm.json", import.meta.url), "utf8")).cases;

// Minimal tool defs — selection is driven by name + description.
const tools = allTools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: { type: "object", additionalProperties: true },
}));

async function pickTool(question) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      tools,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const use = (data.content ?? []).find((b) => b.type === "tool_use");
  return use?.name ?? null;
}

let passed = 0;
const fails = [];
for (const c of cases) {
  let picked;
  try { picked = await pickTool(c.question); }
  catch (e) { fails.push(`${c.question}\n    error: ${e.message}`); continue; }
  if (c.expect.includes(picked)) passed++;
  else fails.push(`${c.question}\n    picked ${picked}, expected one of [${c.expect.join(", ")}]`);
}

console.log(`eval:llm (${model}): ${passed}/${cases.length} picked the expected tool`);
for (const f of fails) console.log(`  ✗ ${f}`);
if (fails.length) process.exit(1);
