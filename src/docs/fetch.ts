import type { DocFetch } from "../types.js";

const ENDPOINT = "https://learn.microsoft.com/api/search";

interface MakeOpts { fetchImpl?: typeof fetch; defaultTimeoutMs?: number; cacheTtlMs?: number; now?: () => number }

type Result = Awaited<ReturnType<DocFetch>>;

export function makeDocFetch(opts: MakeOpts = {}): DocFetch {
  const doFetch = opts.fetchImpl ?? fetch;
  const defaultTimeout = opts.defaultTimeoutMs ?? 5000;
  const ttl = opts.cacheTtlMs ?? 10 * 60 * 1000; // 10 minutes
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; result: Result }>();

  return async (query, callOpts) => {
    const key = query.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return { ...hit.result, note: "cached" };

    const timeoutMs = callOpts?.timeoutMs ?? defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${ENDPOINT}?search=${encodeURIComponent(query)}&locale=en-us&scope=partner-center`;
      const res = (await doFetch(url, { signal: controller.signal } as RequestInit)) as Response;
      if (!res.ok) return { ok: false, excerpts: [], note: `Live doc fetch unavailable (HTTP ${res.status}); using curated knowledge only.` };
      const body = (await res.json()) as { results?: { title: string; url: string; excerpt?: string }[] };
      const excerpts = (body.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.excerpt ?? "" }));
      const result: Result = { ok: true, excerpts };
      cache.set(key, { at: now(), result }); // only successful responses are cached
      return result;
    } catch {
      return { ok: false, excerpts: [], note: "Live doc fetch unavailable (network error); using curated knowledge only." };
    } finally {
      clearTimeout(timer);
    }
  };
}
