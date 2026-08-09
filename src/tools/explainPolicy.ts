import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge, Policy } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

const AREAS = ["customers", "billing", "pricing", "security", "lifecycle", "announcements"] as const;

/**
 * Ranks a policy against the words in a question.
 *
 * The question field is weighted highest because entries are written in the
 * words somebody would actually ask, so a match there is a match of intent
 * rather than of vocabulary that happens to appear in the answer.
 */
function score(policy: Policy, terms: string[]): number {
  if (terms.length === 0) return 1;
  const question = policy.question.toLowerCase();
  const rule = `${policy.rule} ${policy.consequence ?? ""}`.toLowerCase();
  const id = policy.id.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (question.includes(term)) total += 3;
    else if (id.includes(term)) total += 2;
    else if (rule.includes(term)) total += 1;
  }
  return total;
}

export const explainPolicy: Tool = {
  name: "pc_explain_policy",
  title: "Answer a question about how Partner Center behaves",
  description:
    "Answer questions about Partner Center's RULES rather than its endpoints: cancellation windows per product type, what happens when a customer does not pay, how promotion limits are counted, what a GDAP expiry does to subscriptions, how billing and proration work. " +
    "This is the tool for \"why was this refused\", \"how long do we have\", \"who is liable\", \"does this carry over at renewal\". " +
    "For the endpoint that performs an operation use pc_get_scenario; for whether an operation is legal right now use pc_explain_lifecycle; for a specific error code use pc_lookup_error. " +
    "Read-only, offline, deterministic. Every entry carries the Microsoft Learn page it was read from and the date it was checked.",
  inputShape: {
    question: z.string().optional().describe(
      "The question in plain words, e.g. \"can I reduce seats on a software subscription\" or \"customer went bankrupt who pays\". " +
      "Matched against the question each entry answers, then its rule. Omit to list everything in an area. " +
      "PASS IT IN ENGLISH: the rules are written in the words Microsoft's documentation uses, so a question in another language will not match. " +
      "Translate the user's question first and answer them in whatever language they asked.",
    ),
    area: z.enum(AREAS).optional().describe(
      "Narrow to one area: customers, billing, pricing, security, lifecycle, announcements. Omit to search them all.",
    ),
    limit: z.number().int().min(1).max(25).optional().describe(
      "How many answers to return, ranked best first. Defaults to 5; raise it when exploring an area rather than asking one question.",
    ),
  },
  outputShape: envelope(z.object({
    answers: z.array(z.object({
      id: z.string(),
      area: z.string(),
      question: z.string().describe("The question this entry answers."),
      rule: z.string().describe("What Partner Center actually does."),
      consequence: z.string().optional().describe("What goes wrong when this is not known."),
      relatedScenarios: z.array(z.string()).optional().describe("Scenario ids that carry the rule out."),
      relatedErrors: z.array(z.string()).optional().describe("Error codes this rule explains."),
      docUrl: z.string(),
      lastVerified: z.string(),
    })),
    notes: z.array(z.string()),
  })),
  annotations: OFFLINE,
  run(args, ctx): ToolResult {
    const k = ctx.knowledge as Knowledge;
    const limit = args.limit ?? 5;
    const terms = (args.question ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t: string) => t.length > 2);

    const pool = args.area ? k.policies.filter((p) => p.area === args.area) : k.policies;
    const ranked = pool
      .map((policy) => ({ policy, rank: score(policy, terms) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.policy.id.localeCompare(b.policy.id))
      .slice(0, limit)
      .map((entry) => entry.policy);

    const notes = [
      "These are documented rules, not endpoint definitions. The scenario a rule names is what carries it out.",
      "Where a rule states a window or a limit, the live subscription's own field is the authority for that subscription - cancellationAllowedUntilDate over any documented number of days.",
    ];
    if (ranked.length === 0) {
      notes.push(
        args.question
          ? `Nothing recorded answers "${args.question}". The pack covers ${k.policies.length} rules so far; try pc_search_docs for the live documentation.`
          : "No rules recorded for that area yet.",
      );
    }

    return ok({ answers: ranked, notes });
  },
};
