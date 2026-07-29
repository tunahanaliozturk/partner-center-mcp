export interface PageFetch {
  url: string;
  finalUrl: string;
  status: number;
  html: string | null;
  error: string | null;
}

const UA = "partner-center-mcp-doccheck/2.0 (+https://github.com/tunahanaliozturk/partner-center-mcp)";

export async function fetchPage(url: string, timeoutMs = 15000): Promise<PageFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html" },
    });
    const ok = res.status >= 200 && res.status < 400;
    return {
      url,
      finalUrl: res.url === "" ? url : res.url,
      status: res.status,
      html: ok ? await res.text() : null,
      error: null,
    };
  } catch (e) {
    return { url, finalUrl: url, status: 0, html: null, error: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Concurrency-limited fetch that keeps results in input order. */
export async function fetchAll(urls: string[], concurrency = 6, timeoutMs = 15000): Promise<PageFetch[]> {
  const out: PageFetch[] = new Array(urls.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (next < urls.length) {
      const index = next++;
      const url = urls[index];
      if (url === undefined) continue;
      out[index] = await fetchPage(url, timeoutMs);
    }
  });
  await Promise.all(workers);
  return out;
}
