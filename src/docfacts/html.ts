// Minimal HTML readers for Microsoft Learn pages. Regex rather than a DOM
// parser on purpose: Learn's markup is machine-generated and stable, and a
// parser dependency would be the only runtime addition in this repo.

export interface Table {
  headers: string[];
  rows: string[][];
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Visible text of an HTML fragment: tags stripped, entities decoded, whitespace collapsed. */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** The `content` of `<meta name="...">`, or null when the tag is absent. */
export function metaContent(html: string, name: string): string | null {
  const escaped = escapeRegExp(name);
  const match = html.match(new RegExp(`<meta\\s+name="${escaped}"\\s+content="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

/**
 * The slice of `html` starting at the heading with `id`, ending before the next
 * heading of any level. Learn nests h2 > h3, so stopping at any heading keeps a
 * section from swallowing its siblings.
 */
export function sectionAfter(html: string, headingId: string): string | null {
  const escaped = escapeRegExp(headingId);
  const start = html.search(new RegExp(`<h[1-6][^>]*id="${escaped}"`, "i"));
  if (start < 0) return null;
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<h[1-6][\s>]/i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** Every `<table>` in the fragment, first row treated as the header row. */
export function parseTables(html: string): Table[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((table) => {
    const rows = [...(table[0] ?? "").matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map((row) => [...(row[0] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1] ?? "")));
    const [headers, ...body] = rows;
    return { headers: headers ?? [], rows: body };
  });
}
