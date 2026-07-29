import { fetchPage } from "./fetch.js";

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
