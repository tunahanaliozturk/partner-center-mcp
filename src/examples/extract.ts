/**
 * Pulls the response example out of a Microsoft Learn endpoint page.
 *
 * Learn writes them as an `<h3>Response example</h3>` followed by a
 * `<pre><code class="lang-http">` block holding a whole HTTP response: a status
 * line, headers, a blank line, then the JSON body. Everything here is derived
 * from that shape, and anything that does not parse as JSON is dropped rather
 * than guessed at, because a wrong example is worse than no example.
 */

export interface ResponseExample {
  /** Status from the example's HTTP status line, or null when it stated none. */
  httpStatus: number | null;
  /** The parsed JSON body. */
  body: unknown;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/**
 * Learn examples routinely carry `// comment` annotations inside the JSON and
 * elide long collections with `...`. Both are invalid JSON, and both appear in
 * examples that are otherwise exactly what a caller wants to see.
 */
function stripJsonNoise(s: string): string {
  // Comments are removed with a string-aware scan, not a regex: URLs are common
  // in these payloads and "https://learn..." would otherwise lose its tail.
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && s[i + 1] === "/") {
      const end = s.indexOf("\n", i);
      if (end === -1) break;
      i = end - 1;
      continue;
    }
    out += ch;
  }
  return out
    // An elided collection: "...," or a bare "..." standing in for more items.
    .replace(/(^|[,[{])\s*\.\.\.\s*(?=[,\]}])/g, "$1")
    .replace(/,\s*\.\.\.\s*/g, "")
    // Whatever the two rules above leave behind as a trailing comma.
    .replace(/,(\s*[}\]])/g, "$1");
}

/** The outermost JSON object or array in a string, or null when there is none. */
function outermostJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start] as "[" | "{";
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Restores an opening quote a page dropped from a property name, e.g. a line
 * reading `  tags": [` on get-a-customer-by-id.
 *
 * This is the one repair applied to an example, and it is safe because the
 * pattern is unambiguous: a line that starts with a bare identifier followed by
 * `":` can only ever have been a quoted property name. Nothing else is guessed
 * at, and a body that still fails to parse is dropped rather than coerced.
 */
function repairPropertyQuotes(s: string): string {
  return s.replace(/^(\s*)([A-Za-z_$][\w$-]*)":/gm, '$1"$2":');
}

/**
 * Rejoins a string literal a page wrapped across lines, e.g. the long offer
 * descriptions on get-a-list-of-offers-for-a-market.
 *
 * A raw newline inside a JSON string is always invalid, so there is no valid
 * document this changes the meaning of. The continuation's indentation is
 * collapsed to a single space, which is how the sentence was meant to read.
 */
function joinWrappedStrings(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === "\n" || ch === "\r") {
        while (i + 1 < s.length && /[\s]/.test(s[i + 1] as string)) i++;
        out += " ";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/**
 * Inserts a comma a page left out between two members, e.g. the contact block
 * on get-confirmation-of-customer-agreement where "email" is followed straight
 * by "phoneNumber".
 *
 * Only fires where JSON requires a separator and none is present: a value has
 * just ended and the next token opens another member. Valid JSON never has that
 * shape, so this cannot alter a document that already parses.
 */
function repairMissingCommas(s: string): string {
  const ENDS_VALUE = /["}\]\w]/;
  let out = "";
  let inString = false;
  let escaped = false;
  let lastSignificant = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') { inString = false; lastSignificant = '"'; }
      continue;
    }
    if (/\s/.test(ch)) { out += ch; continue; }
    if ((ch === '"' || ch === "{" || ch === "[") && ENDS_VALUE.test(lastSignificant)) {
      out += ",";
    }
    if (ch === '"') inString = true;
    out += ch;
    lastSignificant = ch;
  }
  return out;
}

/**
 * The repairs, in the order they have to run: quotes first so the string-aware
 * passes can see where strings begin, then wrapped literals, then separators.
 *
 * Exported so the repairs can be exercised directly, and so a page that still
 * refuses to parse can be diagnosed against the same text the extractor saw.
 */
export function repairExampleJson(text: string): string {
  return repairMissingCommas(joinWrappedStrings(repairPropertyQuotes(text)));
}

const CODE_BLOCK = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>/gi;
const STATUS_LINE = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/im;

function parseBlock(raw: string): ResponseExample | null {
  const text = decodeEntities(raw);
  const status = STATUS_LINE.exec(text);
  const httpStatus = status ? Number(status[1]) : null;

  // Drop the status line and headers before anything else. The repairs are
  // string-aware scans, and running them over the preamble made them read
  // `Content-Length: 620` as a value and insert a separator before the body.
  const bodyStart = text.search(/[[{]/);
  if (bodyStart === -1) return null;
  const body = text.slice(bodyStart);

  // Repairs are applied before the body is delimited: a property name missing
  // its opening quote leaves a stray `"` that makes the string-aware scan in
  // outermostJson mis-read where the body ends.
  for (const source of [body, repairExampleJson(body)]) {
    const json = outermostJson(source);
    if (json === null) continue;
    for (const candidate of [json, stripJsonNoise(json)]) {
      try {
        return { httpStatus, body: JSON.parse(candidate) };
      } catch { /* try the next form */ }
    }
  }
  return null;
}

interface Heading { index: number; length: number; level: number; text: string }

const HEADING = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

function headingsOf(html: string): Heading[] {
  const out: Heading[] = [];
  HEADING.lastIndex = 0;
  for (let m = HEADING.exec(html); m !== null; m = HEADING.exec(html)) {
    out.push({
      index: m.index,
      length: m[0].length,
      level: Number(m[1]),
      text: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
    });
  }
  return out;
}

/**
 * The body of a section: from the end of its heading to the next heading at the
 * same level or higher.
 *
 * Bounding matters. A Graph page has several "Response" headings, and the first
 * is prose with no example; searching forward without a bound would walk out of
 * that section and pick up a code block belonging to another one.
 */
function sectionBody(html: string, headings: Heading[], heading: Heading, i: number): string {
  const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
  return html.slice(heading.index + heading.length, next ? next.index : undefined);
}

/**
 * The first parseable response example on the page, or null.
 *
 * Two doc templates publish these differently. Partner Center writes a
 * "Response example" heading; Microsoft Graph writes plain "Response", usually
 * more than once. Both are read, Partner Center first, and only sections that
 * announce a response are considered: a page's REQUEST example is the same
 * shape and mistaking it for the response would poison the whole set.
 */
export function extractResponseExample(html: string): ResponseExample | null {
  const headings = headingsOf(html);
  const isPartnerCenter = (t: string) => /response\s+example/i.test(t);
  const isGraph = (t: string) => /^response(\s+\d+)?$/i.test(t);

  for (const matches of [isPartnerCenter, isGraph]) {
    for (const [i, heading] of headings.entries()) {
      if (!matches(heading.text)) continue;
      const body = sectionBody(html, headings, heading, i);
      CODE_BLOCK.lastIndex = 0;
      for (let m = CODE_BLOCK.exec(body); m !== null; m = CODE_BLOCK.exec(body)) {
        const parsed = parseBlock(m[1] ?? "");
        if (parsed) return parsed;
      }
    }
  }
  return null;
}
