export interface Finding {
  kind: string;
  severity: "error" | "warning" | "info";
  ref: string;
  message: string;
  detail?: string;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
