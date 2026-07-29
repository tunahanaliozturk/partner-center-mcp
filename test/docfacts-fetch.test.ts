import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "vitest";
import { fetchAll, fetchPage } from "../src/docfacts/fetch.js";

async function withServer(handler: (path: string) => { status: number; body: string }, run: (base: string) => Promise<void>) {
  const server: Server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status, { "content-type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("fetchPage returns the body and status of a page", async () => {
  await withServer(() => ({ status: 200, body: "<h1>ok</h1>" }), async (base) => {
    const result = await fetchPage(`${base}/page`);
    expect(result.status).toBe(200);
    expect(result.html).toBe("<h1>ok</h1>");
    expect(result.error).toBeNull();
  });
});

test("fetchPage reports a non-200 without a body", async () => {
  await withServer(() => ({ status: 404, body: "gone" }), async (base) => {
    const result = await fetchPage(`${base}/missing`);
    expect(result.status).toBe(404);
    expect(result.html).toBeNull();
  });
});

test("fetchPage reports a transport failure as an error, not a throw", async () => {
  const result = await fetchPage("http://127.0.0.1:1/nothing", 500);
  expect(result.status).toBe(0);
  expect(result.error).not.toBeNull();
  expect(result.html).toBeNull();
});

test("fetchAll preserves input order under concurrency", async () => {
  // Delay is inverted relative to request order: the first-requested URL is the
  // slowest to respond, the last is the fastest. That forces responses to arrive
  // out of order, so this only passes if fetchAll assembles results by index
  // rather than by completion order (a completion-order/push implementation
  // would return them roughly reversed).
  const paths = ["/a", "/b", "/c", "/d", "/e"];
  const delayMs: Record<string, number> = { "/a": 150, "/b": 90, "/c": 40, "/d": 15, "/e": 0 };
  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<h1>${path}</h1>`);
    }, delayMs[path] ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const base = `http://127.0.0.1:${port}`;
    const urls = paths.map((p) => base + p);
    const results = await fetchAll(urls, 2);
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results[2]?.html).toBe("<h1>/c</h1>");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
