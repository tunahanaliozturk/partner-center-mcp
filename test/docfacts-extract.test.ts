import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { extractDocFacts, normalizeUri } from "../src/docfacts/extract.js";
import { EXTRACTOR_VERSION } from "../src/docfacts/types.js";

const fixture = (name: string) => readFileSync(`test/fixtures/docs/${name}`, "utf8");

const PC_URL = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const PC_FINAL = "https://learn.microsoft.com/en-us/partner-center/developer/create-a-customer";

test("normalizeUri strips the baseURL placeholder and the protocol token", () => {
  expect(normalizeUri("{baseURL} /v1/customers HTTP/1.1")).toBe("/v1/customers");
  expect(normalizeUri("{baseURL}/v1/customers/{customer-id}/carts HTTP/1.1")).toBe("/v1/customers/{customer-id}/carts");
  expect(normalizeUri("/v1/customers")).toBe("/v1/customers");
});

test("a Partner Center endpoint page yields identity, request syntax and body fields", () => {
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.url).toBe(PC_URL);
  expect(facts.finalUrl).toBe(PC_FINAL);
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceRepo).toBe("MicrosoftDocs/partner-center-pr");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.sourcePath).toBe("partner-center/developer/create-a-customer.md");
  expect(facts.documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(facts.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/v1/customers" });
  expect(facts.isEndpointPage).toBe(true);
  expect(facts.bodyFields.map((f) => f.name)).toContain("BillingProfile");
  expect(facts.extractionError).toBeNull();
  expect(facts.extractorVersion).toBe(EXTRACTOR_VERSION);
});

test("a page that links to the shared headers article yields no header names", () => {
  // create-a-customer's Request headers section is a bullet list pointing at
  // the shared "Partner Center REST headers" page, not a table. Absent headers
  // must read as "not tabulated", never as an extraction failure.
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.headerNames).toEqual([]);
  expect(facts.extractionError).toBeNull();
});

test("a conceptual page extracts identity but is not an endpoint page", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model";
  const facts = extractDocFacts(url, url, fixture("pc-conceptual.html"));
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.requestSyntax).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
  expect(facts.extractionError).toBeNull();
});

test("a page without Learn metadata reports an extraction error rather than empty facts", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/whatever";
  const facts = extractDocFacts(url, url, fixture("malformed.html"));
  expect(facts.extractionError).toContain("gitcommit");
  expect(facts.extractionError).toContain("document_id");
  expect(facts.sourceSha).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
});

test("a Graph endpoint page yields its route and tabulated headers", () => {
  const url = "https://learn.microsoft.com/graph/api/user-post-users";
  const facts = extractDocFacts(url, url, fixture("graph-endpoint.html"));
  expect(facts.template).toBe("graph");
  expect(facts.sourceRepo).toBe("microsoftgraph/microsoft-graph-docs");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/users" });
  expect(facts.isEndpointPage).toBe(true);
  expect(facts.headerNames).toContain("Authorization");
  expect(facts.extractionError).toBeNull();
});

test("a Graph page with multiple routes in one block extracts the first route", () => {
  const url = "https://learn.microsoft.com/graph/api/example";
  const html = `
    <meta name="gitcommit" content="https://github.com/microsoftgraph/microsoft-graph-docs/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h2 id="http-request">HTTP request</h2>
    <pre><code class="lang-http">POST /users
POST /users/{id}/restore</code></pre>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/users" });
});

test("a Graph page with a non-route code block under http-request yields no request syntax", () => {
  const url = "https://learn.microsoft.com/graph/api/example";
  const html = `
    <meta name="gitcommit" content="https://github.com/microsoftgraph/microsoft-graph-docs/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h2 id="http-request">HTTP request</h2>
    <pre><code class="lang-json">{ "displayName": "example" }</code></pre>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntax).toBeNull();
});

// A Partner Center doc page can document more than one endpoint (e.g.
// transition-a-new-commerce-subscription: an eligibility GET and a transition
// POST). Learn de-duplicates repeated heading ids as request-syntax,
// request-syntax-1, request-syntax-2, ... so the extractor walks all of them.
test("a Partner Center page with two request-syntax sections yields both entries, in order", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/example-multi";
  const html = `
    <meta name="gitcommit" content="https://github.com/MicrosoftDocs/partner-center-pr/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h4 id="request-syntax">Request syntax</h4>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>GET</td><td>{baseURL}/v1/customers/{customer-id}/transitionEligibilities HTTP/1.1</td></tr></tbody></table>
    <h4 id="request-syntax-1">Request syntax</h4>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>POST</td><td>{baseURL}/v1/customers/{customer-id}/transitions HTTP/1.1</td></tr></tbody></table>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntaxes).toEqual([
    { method: "GET", uri: "/v1/customers/{customer-id}/transitionEligibilities" },
    { method: "POST", uri: "/v1/customers/{customer-id}/transitions" },
  ]);
  expect(facts.requestSyntax).toEqual(facts.requestSyntaxes[0]);
});

test("a Graph page with two http-request sections yields both entries", () => {
  const url = "https://learn.microsoft.com/graph/api/example-multi";
  const html = `
    <meta name="gitcommit" content="https://github.com/microsoftgraph/microsoft-graph-docs/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h2 id="http-request">HTTP request</h2>
    <pre><code class="lang-http">GET /users/{id}</code></pre>
    <h2 id="http-request-1">HTTP request</h2>
    <pre><code class="lang-http">DELETE /users/{id}</code></pre>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntaxes).toEqual([
    { method: "GET", uri: "/users/{id}" },
    { method: "DELETE", uri: "/users/{id}" },
  ]);
});

test("a page with a single request-syntax section yields a one-element requestSyntaxes equal to requestSyntax", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/example-single";
  const html = `
    <meta name="gitcommit" content="https://github.com/MicrosoftDocs/partner-center-pr/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h3 id="request-syntax">Request syntax</h3>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>GET</td><td>{baseURL}/v1/customers HTTP/1.1</td></tr></tbody></table>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntaxes).toEqual([{ method: "GET", uri: "/v1/customers" }]);
  expect(facts.requestSyntaxes).toEqual([facts.requestSyntax]);
});

test("the real pc-endpoint fixture still yields exactly one entry, unchanged for ordinary pages", () => {
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.requestSyntaxes).toEqual([{ method: "POST", uri: "/v1/customers" }]);
});

test("a malformed second request-syntax section does not truncate the walk of later sections", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/example-gap";
  const html = `
    <meta name="gitcommit" content="https://github.com/MicrosoftDocs/partner-center-pr/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h3 id="request-syntax">Request syntax</h3>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>GET</td><td>{baseURL}/v1/one HTTP/1.1</td></tr></tbody></table>
    <h3 id="request-syntax-1">Request syntax</h3>
    <p>No table here, just prose describing the request in words instead.</p>
    <h3 id="request-syntax-2">Request syntax</h3>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>DELETE</td><td>{baseURL}/v1/three HTTP/1.1</td></tr></tbody></table>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntaxes).toEqual([
    { method: "GET", uri: "/v1/one" },
    { method: "DELETE", uri: "/v1/three" },
  ]);
});

// Regression for the stray ">" in get-fraud-events's extracted URI. The real
// page's Request syntax cell is `<a ...><em>{baseURL}</em></a>/v1/fraudEvents&gt;`
// — a literal ">" character baked into the source markdown right after the
// path, which HTML-escapes to `&gt;` and then decodes right back to ">" by
// the time normalizeUri sees it. Reproduce the actual markup shape, not the
// already-broken string.
test("a stray '>' character trailing the request URI in the source markup does not leak into the extracted uri", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/get-fraud-events";
  const html = `
    <meta name="gitcommit" content="https://github.com/MicrosoftDocs/partner-center-pr/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Azure fraud notification - Get fraud events</h1>
    <h3 id="request-syntax">Request syntax</h3>
    <table>
    <thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td><strong>GET</strong></td><td><a href="partner-center-rest-urls" data-linktype="relative-path"><em>{baseURL}</em></a>/v1/fraudEvents&gt;</td></tr></tbody>
    </table>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntax).toEqual({ method: "GET", uri: "/v1/fraudEvents" });
});

// get-fraud-events's *second* request-syntax section wraps the placeholder in
// brackets instead of a link: `[<em>{baseURL}</em>]/v1/fraudEvents`. Nothing
// strips the leading "[", so the resulting uri doesn't start with "/" -- it is
// not a URI at all, and must be treated the same as any other malformed
// section: it contributes nothing, and does not truncate the walk.
test("a request-syntax section whose extracted uri does not start with '/' contributes nothing, without truncating the walk", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/example-bracket";
  const html = `
    <meta name="gitcommit" content="https://github.com/MicrosoftDocs/partner-center-pr/blob/0000000000000000000000000000000000000000/path.md">
    <meta name="document_id" content="00000000-0000-0000-0000-000000000000">
    <h1>Example</h1>
    <h3 id="request-syntax">Request syntax</h3>
    <table>
    <thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>GET</td><td>[<em>{baseURL}</em>]/v1/fraudEvents&gt;</td></tr></tbody>
    </table>
    <h3 id="request-syntax-1">Request syntax</h3>
    <table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>
    <tbody><tr><td>GET</td><td>{baseURL}/v1/fraudEvents HTTP/1.1</td></tr></tbody></table>
  `;
  const facts = extractDocFacts(url, url, html);
  expect(facts.requestSyntaxes).toEqual([{ method: "GET", uri: "/v1/fraudEvents" }]);
});
