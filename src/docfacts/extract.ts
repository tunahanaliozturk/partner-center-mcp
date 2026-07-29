import { metaContent, parseTables, sectionAfter, text } from "./html.js";
import { EXTRACTOR_VERSION, type DocFacts } from "./types.js";

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/;

// A page can document more than one endpoint (an eligibility GET alongside
// the transition POST it feeds, for instance). Learn de-duplicates repeated
// heading ids as -1, -2, ...; this is far beyond anything Learn publishes.
const MAX_REQUEST_SYNTAX_SECTIONS = 10;

type SyntaxEntry = { method: string; uri: string };

/**
 * `{baseURL} /v1/customers HTTP/1.1` -> `/v1/customers`.
 *
 * Some Request syntax cells (e.g. get-fraud-events) carry a stray literal
 * "<" or ">" right after the path -- an authoring artifact in the source
 * markdown, HTML-escaped to `&lt;`/`&gt;` and decoded straight back to the
 * literal character by the time this function sees it. Neither character is
 * ever valid in a Partner Center REST path, so they're dropped unconditionally
 * rather than special-cased to any one page.
 */
export function normalizeUri(raw: string): string {
  return raw
    .replace(/\{baseURL\}/gi, "")
    .replace(/\s*HTTP\/\d(\.\d)?\s*$/i, "")
    .replace(/[<>]/g, "")
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

// A Request URI is either a {baseURL}-relative path or, on some pages (e.g.
// get-a-list-of-referrals), a full absolute URL -- both are legitimate
// documentation styles. Anything else (a bracket-convention leftover like
// "[]/v1/fraudEvents") is neither, and is rejected. The absolute form is
// stored as-is: DocFacts records what the page said, and pathsMatch (in
// checks/fields.ts) is what strips the scheme+host for comparison.
const ABSOLUTE_URL = /^https?:\/\//i;

function isUri(uri: string): boolean {
  return uri.startsWith("/") || ABSOLUTE_URL.test(uri);
}

function partnerCenterSyntaxEntry(section: string): SyntaxEntry | null {
  const table = parseTables(section)[0];
  if (!table || (table.headers[0] ?? "").toLowerCase() !== "method") return null;
  const row = table.rows[0];
  if (!row) return null;
  const method = (row[0] ?? "").toUpperCase();
  const uri = normalizeUri(row[1] ?? "");
  if (!METHODS.test(method) || !isUri(uri)) return null;
  return { method, uri };
}

// Graph publishes the route as an http code block. Pages that document several
// routes on one block list them one per line; the first is the canonical one.
function graphSyntaxEntry(section: string): SyntaxEntry | null {
  const block = section.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/i);
  if (!block) return null;
  const firstLine = text(block[1] ?? "").split(/\s+/);
  const method = (firstLine[0] ?? "").toUpperCase();
  const uri = firstLine[1] ?? "";
  if (!METHODS.test(method) || !uri.startsWith("/")) return null;
  return { method, uri };
}

// Learn de-duplicates repeated heading ids by suffixing -1, -2, ..., which
// makes enumerating every documented endpoint on a page deterministic. A
// section whose table or code block doesn't parse to a valid method+URI
// contributes nothing to the list but must not stop the walk: a malformed
// second section must not discard a valid third one.
function collectRequestSyntaxes(
  html: string,
  baseId: string,
  parseSection: (section: string) => SyntaxEntry | null,
): SyntaxEntry[] {
  const entries: SyntaxEntry[] = [];
  for (let i = 0; i < MAX_REQUEST_SYNTAX_SECTIONS; i++) {
    const headingId = i === 0 ? baseId : `${baseId}-${i}`;
    const section = sectionAfter(html, headingId);
    if (section === null) break;
    const entry = parseSection(section);
    if (entry) entries.push(entry);
  }
  return entries;
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

  const requestSyntaxes = template === "graph"
    ? collectRequestSyntaxes(html, "http-request", graphSyntaxEntry)
    : template === "partner-center"
      ? collectRequestSyntaxes(html, "request-syntax", partnerCenterSyntaxEntry)
      : [];
  const requestSyntax = requestSyntaxes[0] ?? null;

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
    requestSyntaxes,
    headerNames: headerNames(html),
    bodyFields: bodyFields(html),
    isEndpointPage: requestSyntax !== null,
    extractionError: problems.length > 0 ? problems.join("; ") : null,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
