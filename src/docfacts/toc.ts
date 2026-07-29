import { fetchPage } from "./fetch.js";
import type { Finding } from "./findings.js";

// The whole-set TOC. `partner-center/developer/toc.json` does not exist — the
// developer section is a subtree of this one.
export const TOC_URL = "https://learn.microsoft.com/en-us/partner-center/toc.json";

const LEARN_BASE = "https://learn.microsoft.com/partner-center/";

interface TocNode {
  href?: unknown;
  items?: unknown;
  children?: unknown;
}

/** Depth-first list of every href in the TOC, in document order. */
export function parseTocHrefs(json: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const { href, items, children } = node as TocNode;
    if (typeof href === "string") out.push(href.replace(/^\.\//, ""));
    for (const branch of [items, children]) {
      if (Array.isArray(branch)) for (const child of branch) walk(child);
    }
  };
  walk(json);
  return out;
}

export function tocHrefToUrl(href: string): string {
  return LEARN_BASE + href.replace(/^\.\//, "").replace(/\/$/, "");
}

export async function fetchTocHrefs(): Promise<string[]> {
  const page = await fetchPage(TOC_URL);
  if (page.html === null) throw new Error(`${TOC_URL}: unreachable (${page.status || "ERR"})`);
  return parseTocHrefs(JSON.parse(page.html));
}

/**
 * Re-read the TOC for the weekly `check-docs` run, degrading safely.
 *
 * The TOC drives both coverage and retirement detection, so a stale one
 * freezes both: `retired-page` stops firing and newly documented endpoints
 * never surface as gaps. But a failed or empty fetch must NEVER clobber the
 * snapshot's list — an empty `tocHrefs` would make every scenario's docUrl
 * look retired at once, turning a network hiccup into a wall of false
 * findings. On any failure the previous list is carried forward and the
 * failure itself is reported.
 *
 * `fetch` is injectable so the resilience path is unit-testable offline.
 */
export async function refreshTocHrefs(
  previous: string[],
  fetch: () => Promise<string[]> = fetchTocHrefs,
): Promise<{ hrefs: string[]; findings: Finding[] }> {
  let hrefs: string[];
  try {
    hrefs = await fetch();
  } catch (e) {
    return {
      hrefs: previous,
      findings: [{
        kind: "toc-unreadable", severity: "warning", ref: TOC_URL,
        message: `could not be re-read (${(e as Error).message}); coverage and retirement detection are running on the previous table of contents.`,
        detail: `carried ${previous.length} href(s) forward.`,
      }],
    };
  }
  if (hrefs.length === 0) {
    return {
      hrefs: previous,
      findings: [{
        kind: "toc-unreadable", severity: "warning", ref: TOC_URL,
        message: "parsed to zero hrefs, which would mark every page retired; keeping the previous table of contents.",
        detail: `carried ${previous.length} href(s) forward.`,
      }],
    };
  }
  return { hrefs, findings: [] };
}
