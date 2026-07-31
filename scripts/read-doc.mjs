// Print one Microsoft Learn page as readable text, for authoring scenarios.
// Run: npm run read-doc -- create-scheduled-changes
const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run read-doc -- <doc-slug|url>");
  process.exit(2);
}
const url = arg.startsWith("http")
  ? arg
  : `https://learn.microsoft.com/en-us/partner-center/developer/${arg}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`${url}: HTTP ${res.status}`);
  process.exit(1);
}
const html = await res.text();
const body = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const text = body
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n");
console.log(`# ${url}\n${text.trim()}`);
