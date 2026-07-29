import type { Finding } from "./findings.js";

const RANK: Record<Finding["severity"], number> = { error: 0, warning: 1, info: 2 };
const ICON: Record<Finding["severity"], string> = { error: "❌", warning: "⚠️", info: "ℹ️" };

export function renderReport(title: string, findings: Finding[], summary: string[]): string {
  const lines = [`# ${title}`, ""];
  for (const line of summary) lines.push(`- ${line}`);
  if (summary.length > 0) lines.push("");

  if (findings.length === 0) {
    lines.push("✅ Nothing to report.", "");
    return lines.join("\n");
  }

  const kinds = [...new Set(findings.map((f) => f.kind))].sort((a, b) => {
    const worst = (kind: string) => Math.min(...findings.filter((f) => f.kind === kind).map((f) => RANK[f.severity]));
    return worst(a) - worst(b) || a.localeCompare(b);
  });

  for (const kind of kinds) {
    const group = findings.filter((f) => f.kind === kind);
    lines.push(`## ${kind} (${group.length})`, "");
    for (const finding of group) {
      lines.push(`- ${ICON[finding.severity]} \`${finding.ref}\` — ${finding.message}`);
      if (finding.detail !== undefined) lines.push(`  - ${finding.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
