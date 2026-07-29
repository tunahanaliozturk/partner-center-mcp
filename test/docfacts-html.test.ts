import { test, expect } from "vitest";
import { metaContent, text, sectionAfter, parseTables } from "../src/docfacts/html.js";

test("metaContent reads a meta tag by name and returns null when absent", () => {
  const html = '<meta name="document_id" content="abc-123" />\n<meta name="ms.date" content="2024-03-20T00:00:00Z" />';
  expect(metaContent(html, "document_id")).toBe("abc-123");
  expect(metaContent(html, "ms.date")).toBe("2024-03-20T00:00:00Z");
  expect(metaContent(html, "missing")).toBeNull();
});

test("text strips tags, decodes entities, and collapses whitespace", () => {
  expect(text("<td><strong>POST</strong></td>")).toBe("POST");
  expect(text("<td>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</td>")).toBe("a & b <c> \"d\" 'e'");
  expect(text("<p>one\n   two</p>")).toBe("one two");
});

test("sectionAfter returns the slice from a heading to the next heading", () => {
  const html = '<h3 id="request-syntax">Request syntax</h3><table>T1</table><h3 id="request-headers">Request headers</h3><table>T2</table>';
  const section = sectionAfter(html, "request-syntax");
  expect(section).toContain("T1");
  expect(section).not.toContain("T2");
  expect(sectionAfter(html, "nope")).toBeNull();
});

test("parseTables splits header row from body rows", () => {
  const html = "<table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>"
    + "<tbody><tr><td><strong>POST</strong></td><td>{baseURL}/v1/customers HTTP/1.1</td></tr></tbody></table>";
  const tables = parseTables(html);
  expect(tables).toHaveLength(1);
  expect(tables[0]?.headers).toEqual(["Method", "Request URI"]);
  expect(tables[0]?.rows).toEqual([["POST", "{baseURL}/v1/customers HTTP/1.1"]]);
});

test("parseTables returns every table in the slice", () => {
  expect(parseTables("<table><tr><th>A</th></tr></table><table><tr><th>B</th></tr></table>")).toHaveLength(2);
});
