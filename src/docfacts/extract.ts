import { metaContent, parseTables, sectionAfter, text } from "./html.js";
import { EXTRACTOR_VERSION, type DocFacts } from "./types.js";

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/;

/** `{baseURL} /v1/customers HTTP/1.1` -> `/v1/customers`. */
export function normalizeUri(raw: string): string {
  return raw
    .replace(/\{baseURL\}/gi, "")
    .replace(/\s*HTTP\/\d(\.\d)?\s*$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

interface GitCommit {
  repo: string | null;
  sha: string | null;
  path: string | null;
}

// <meta name="gitcommit"> pins the source markdown to an exact commit. This is
// the drift signal: original_content_git_url points at `live` and so never
// changes, while this SHA moves whenever the source page is edited.
function gitCommit(html: string): GitCommit {
  const raw = metaContent(html, "gitcommit");
  const match = raw?.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{40})\/(.+?)(?:[?#]|$)/i);
  if (!match) return { repo: null, sha: null, path: null };
  return { repo: match[1] ?? null, sha: match[2] ?? null, path: match[3] ?? null };
}

// Family is decided by where the doc lives, not by which sections it has. A
// conceptual Partner Center page is still a Partner Center page; only its
// requestSyntax is absent.
function detectTemplate(url: string, repo: string | null): DocFacts["template"] {
  const hay = (repo ?? "") + " " + url;
  if (/microsoft-graph-docs|learn\.microsoft\.com\/(en-us\/)?graph\//i.test(hay)) return "graph";
  if (/partner-center/i.test(hay)) return "partner-center";
  return "unknown";
}

function title(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const value = text(match?.[1] ?? "");
  return value === "" ? null : value;
}

function partnerCenterRequestSyntax(html: string): DocFacts["requestSyntax"] {
  const section = sectionAfter(html, "request-syntax");
  if (section === null) return null;
  const table = parseTables(section)[0];
  if (!table || (table.headers[0] ?? "").toLowerCase() !== "method") return null;
  const row = table.rows[0];
  if (!row) return null;
  const method = (row[0] ?? "").toUpperCase();
  const uri = normalizeUri(row[1] ?? "");
  if (!METHODS.test(method) || uri === "") return null;
  return { method, uri };
}

function headerNames(html: string): string[] {
  const section = sectionAfter(html, "request-headers");
  if (section === null) return [];
  const table = parseTables(section)[0];
  if (!table) return [];
  const first = (table.headers[0] ?? "").toLowerCase();
  if (first !== "header" && first !== "name") return [];
  return table.rows.map((row) => row[0] ?? "").filter((name) => name !== "");
}

function bodyFields(html: string): DocFacts["bodyFields"] {
  const section = sectionAfter(html, "request-body");
  if (section === null) return [];
  const fields: DocFacts["bodyFields"] = [];
  for (const table of parseTables(section)) {
    if ((table.headers[0] ?? "").toLowerCase() !== "name") continue;
    for (const row of table.rows) {
      const name = row[0] ?? "";
      if (name !== "") fields.push({ name, type: row[1] ?? "" });
    }
  }
  return fields;
}

export function extractDocFacts(url: string, finalUrl: string, html: string): DocFacts {
  const { repo, sha, path } = gitCommit(html);
  const template = detectTemplate(url, repo);
  const pageTitle = title(html);
  const documentId = metaContent(html, "document_id");

  // Missing identity means we did not receive a Learn article at all (an error
  // page, a login redirect, or a template change). Recording that as its own
  // event is what keeps field verification from silently passing on nothing.
  const problems: string[] = [];
  if (sha === null) problems.push("no gitcommit meta");
  if (documentId === null) problems.push("no document_id meta");
  if (pageTitle === null) problems.push("no <h1>");

  const requestSyntax = template === "partner-center" ? partnerCenterRequestSyntax(html) : null;

  return {
    url,
    finalUrl,
    template,
    documentId,
    sourceRepo: repo,
    sourceSha: sha,
    sourcePath: path,
    msDate: metaContent(html, "ms.date"),
    updatedAt: metaContent(html, "updated_at"),
    title: pageTitle,
    requestSyntax,
    headerNames: headerNames(html),
    bodyFields: bodyFields(html),
    isEndpointPage: requestSyntax !== null,
    extractionError: problems.length > 0 ? problems.join("; ") : null,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
