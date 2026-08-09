import { test, expect } from "vitest";
import { extractResponseExample } from "../src/examples/extract.js";

const page = (body: string) => `<h2>Request example</h2>
<pre><code class="lang-http">POST /v1/customers HTTP/1.1

{"requestOnly": true}
</code></pre>
<h3>Response example</h3>
<pre><code class="lang-http">HTTP/1.1 200 OK
Content-Type: application/json

${body}
</code></pre>`;

test("takes the response example, never the request example above it", () => {
  const got = extractResponseExample(page('{"id": "abc", "status": "active"}'));
  expect(got).toEqual({ httpStatus: 200, body: { id: "abc", status: "active" } });
});

test("returns null when the page documents no response example", () => {
  expect(extractResponseExample("<h2>Request example</h2><pre><code>GET /v1/x</code></pre>")).toBeNull();
});

test("decodes the entities Learn escapes into the code block", () => {
  const got = extractResponseExample(page('{&quot;name&quot;: &quot;A &amp; B&quot;}'));
  expect(got?.body).toEqual({ name: "A & B" });
});

test("survives the // comments Learn writes inside its examples", () => {
  const got = extractResponseExample(page(`{
  "quantity": 5, // originally 3
  "status": "active"
}`));
  expect(got?.body).toEqual({ quantity: 5, status: "active" });
});

test("survives an elided collection", () => {
  const got = extractResponseExample(page(`{
  "items": [
    { "id": 1 },
    ...
  ],
  "totalCount": 90
}`));
  expect(got?.body).toEqual({ items: [{ id: 1 }], totalCount: 90 });
});

test("reads a status line other than 200", () => {
  const html = page("{}").replace("HTTP/1.1 200 OK", "HTTP/1.1 201 Created");
  expect(extractResponseExample(html)?.httpStatus).toBe(201);
});

test("handles an array body", () => {
  const got = extractResponseExample(page('[{"id": 1}, {"id": 2}]'));
  expect(got?.body).toEqual([{ id: 1 }, { id: 2 }]);
});

test("skips a block that cannot be parsed and takes the next one that can", () => {
  const html = `<h3>Response example</h3>
<pre><code class="lang-http">HTTP/1.1 204 No Content
</code></pre>
<pre><code class="lang-http">HTTP/1.1 200 OK

{"ok": true}
</code></pre>`;
  expect(extractResponseExample(html)?.body).toEqual({ ok: true });
});

test("a URL inside a string is not mistaken for a comment", () => {
  const got = extractResponseExample(page(`{
  "self": "https://api.partnercenter.microsoft.com/v1/customers", // the link
  "ok": true
}`));
  expect(got?.body).toEqual({ self: "https://api.partnercenter.microsoft.com/v1/customers", ok: true });
});

test("restores an opening quote the page dropped from a property name", () => {
  // get-a-customer-by-id publishes `  tags": [` with no opening quote.
  const got = extractResponseExample(page(`{
  "id": "abc",
  tags": [
    "TestCustomer"
  ]
}`));
  expect(got?.body).toEqual({ id: "abc", tags: ["TestCustomer"] });
});

test("a body that is still broken after repair is dropped, not coerced", () => {
  expect(extractResponseExample(page('{"id": "abc",,,, "x"}'))).toBeNull();
});

test("rejoins a string literal the page wrapped across lines", () => {
  // get-a-list-of-offers-for-a-market wraps its long offer descriptions.
  const got = extractResponseExample(page(`{
  "description": "Protects confidential documents.
                  Control who can view and edit your data."
}`));
  expect(got?.body).toEqual({
    description: "Protects confidential documents. Control who can view and edit your data.",
  });
});

test("an escaped newline inside a string is left alone", () => {
  // String.raw so the block really carries a backslash and an n, which is valid
  // JSON escaping and must survive the wrapped-string repair untouched.
  const got = extractResponseExample(page(String.raw`{"text": "line one\nline two"}`));
  expect(got?.body).toEqual({ text: "line one\nline two" });
});

test("inserts a separator the page left out between two members", () => {
  const got = extractResponseExample(page(`{
  "email": "a@example.com"
  "phoneNumber": "1234567890"
}`));
  expect(got?.body).toEqual({ email: "a@example.com", phoneNumber: "1234567890" });
});

test("a comma inside a string value is not treated as structure", () => {
  const got = extractResponseExample(page('{"a": "x, y", "b": "{not json}"}'));
  expect(got?.body).toEqual({ a: "x, y", b: "{not json}" });
});

// --- Microsoft Graph template ------------------------------------------

const graphPage = (body: string) => `<h2 id="request">Request</h2>
<pre><code class="lang-http">GET /tenantRelationships/delegatedAdminRelationships

</code></pre>
<h2 id="response">Response</h2>
<p>If successful, this method returns a <code>200 OK</code> response code.</p>
<h2 id="examples">Examples</h2>
<h3 id="request-1">Request</h3>
<pre><code class="lang-http">GET /tenantRelationships/delegatedAdminRelationships

{"requestOnly": true}
</code></pre>
<h3 id="response-1">Response</h3>
<blockquote><p><strong>Note:</strong> shortened for readability.</p></blockquote>
<pre><code class="lang-http">HTTP/1.1 200 OK
Content-Type: application/json

${body}
</code></pre>`;

test("reads the Graph template, which heads its example just Response", () => {
  const got = extractResponseExample(graphPage('{"value": [{"id": "abc"}]}'));
  expect(got).toEqual({ httpStatus: 200, body: { value: [{ id: "abc" }] } });
});

test("the prose Response section above the example is skipped, not mistaken for it", () => {
  // The first "Response" heading holds no code block at all. Reading forward
  // without bounding the section would pick up the request example under
  // Examples instead.
  const got = extractResponseExample(graphPage('{"value": []}'));
  expect(got?.body).toEqual({ value: [] });
  expect(got?.body).not.toHaveProperty("requestOnly");
});

test("a Partner Center page still wins over a bare Response heading", () => {
  const both = `<h2>Response</h2>
<pre><code class="lang-http">HTTP/1.1 200 OK

{"from": "graph-shaped section"}
</code></pre>
<h2>Response example</h2>
<pre><code class="lang-http">HTTP/1.1 200 OK

{"from": "partner-center section"}
</code></pre>`;
  expect(extractResponseExample(both)?.body).toEqual({ from: "partner-center section" });
});
