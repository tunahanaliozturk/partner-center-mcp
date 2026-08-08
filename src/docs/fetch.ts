import type { DocFetch } from "../types.js";

const ENDPOINT = "https://learn.microsoft.com/api/search";

interface MakeOpts {
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  /** Most entries kept before the oldest is evicted. Defaults to 500. */
  maxCacheEntries?: number;
}

type Result = Awaited<ReturnType<DocFetch>>;

export function makeDocFetch(opts: MakeOpts = {}): DocFetch {
  const doFetch = opts.fetchImpl ?? fetch;
  const defaultTimeout = opts.defaultTimeoutMs ?? 5000;
  const ttl = opts.cacheTtlMs ?? 10 * 60 * 1000; // 10 minutes
  const now = opts.now ?? Date.now;
  // Bounded on purpose. The HTTP server is long-lived and every distinct query
  // used to add a permanent entry, so a caller could grow this without limit.
  const maxEntries = opts.maxCacheEntries ?? 500;
  const cache = new Map<string, { at: number; result: Result }>();

  return async (query, callOpts) => {
    const key = query.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) {
      // Refresh insertion order so the least recently USED entry is the one
      // evicted, not merely the least recently written.
      cache.delete(key);
      cache.set(key, hit);
      return { ...hit.result, note: "cached" };
    }
    if (hit) cache.delete(key); // expired

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
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return result;
    } catch {
      return { ok: false, excerpts: [], note: "Live doc fetch unavailable (network error); using curated knowledge only." };
    } finally {
      clearTimeout(timer);
    }
  };
}
