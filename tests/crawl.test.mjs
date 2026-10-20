// Run: npm test   (serves a few pages locally, crawls them, checks the records)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawl } from "../src/crawl.mjs";
import { layout } from "../src/extract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARA = "<p>" + "Clean text extraction needs a real paragraph of prose, so this page talks about nothing for a while. ".repeat(4) + "</p>";
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${PARA}${body}</body></html>`;

let server, base, hits, pdfBytes, chromium;
const pages = {
  "/index.html": page("Home", `<a href="a.html">A</a> <a href="b.html">B</a> <a href="mailto:x@y.z">mail</a>`),
  "/a.html": page("Page A", `<a href="b.html">B again</a> <a href="/index.html">home</a> <a href="logo.png">logo</a> <a href="/report">report</a>`),
  "/b.html": page("Page B", `<a href="#top">top</a>`),
  "/app.html": `<!doctype html><html><head><title>App</title></head><body>
    <h1>App</h1><div id="v">Welcome</div>
    <button onclick="v.textContent='Alpha content'">Tab A</button>
    <button onclick="v.textContent='Beta content'">Tab B</button>
    <button onclick="v.textContent='DELETED'">Delete</button>
    <form><button type="submit" onclick="v.textContent='SUBMITTED';return false">Go</button></form>
    </body></html>`,
};

before(async () => {
  process.env.CRAWLEE_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mtscraper-test-"));
  try {
    chromium = (await import("playwright")).chromium;
    const browser = await chromium.launch();
    const p = await browser.newPage();
    await p.setContent(`<h1>Price list</h1><p>Valid for 2026.</p>
      <table border="1" style="border-collapse:collapse"><style>th,td{padding:4px 8px}</style><tr><th>Item</th><th>Price</th></tr>
      <tr><td>Widget</td><td>9.99</td></tr><tr><td>Gadget</td><td>24.50</td></tr></table>`);
    pdfBytes = await p.pdf({ format: "A4" });
    await browser.close();
    pages["/index.html"] = pages["/index.html"].replace("</body>", `<a href="prices.pdf">Prices</a></body>`);
  } catch (e) {
    chromium = null;
    console.log(`# Chromium not available (${e.message.split("\n")[0]}); PDF, --js and --click cases are skipped. Run: npx playwright install chromium`);
  }
  hits = [];
  server = http.createServer((req, res) => {
    hits.push(req.url);
    if ((req.url === "/prices.pdf" || req.url === "/report") && pdfBytes) { res.writeHead(200, { "content-type": "application/pdf" }); return res.end(pdfBytes); }
    if (req.url === "/logo.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("89504e470d0a1a0a", "hex")); }
    const html = pages[req.url];
    if (!html) { res.writeHead(404); return res.end("no"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const run = (opts) => {
  hits.length = 0;
  const records = [];
  return crawl({ urls: [`${base}/index.html`], ...opts }, (r) => records.push(r)).then((stats) => ({ records, stats }));
};
const htmlHits = () => hits.filter((h) => h.endsWith(".html"));

test("max_pages=1 saves one page and never requests a second one", async () => {
  const { records, stats } = await run({ maxPages: 1, pdf: false });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Home");
  assert.deepEqual(htmlHits(), ["/index.html"]);
  assert.equal(stats.saved, 1);
});

test("follows internal links once each and extracts clean text", async () => {
  const { records } = await run({ maxPages: 0, pdf: false });
  assert.deepEqual(records.map((r) => r.title).sort(), ["Home", "Page A", "Page B"]);
  assert.equal(new Set(htmlHits()).size, htmlHits().length, "no page requested twice");
  for (const r of records) {
    assert.deepEqual(Object.keys(r), ["url", "title", "view", "type", "text", "tables"]);
    assert.equal(r.type, "html");
    assert.match(r.text, /nothing for a while/);
    assert.deepEqual(r.tables, []);
  }
});

test("follow= keeps the crawl inside matching URLs", async () => {
  const { records } = await run({ maxPages: 0, pdf: false, follow: "/b." });
  assert.deepEqual(records.map((r) => r.title).sort(), ["Home", "Page B"]);
});

test("linked PDFs are downloaded and their text and tables extracted", async (t) => {
  if (!chromium) return t.skip("needs Chromium");
  const { records, stats } = await run({ maxPages: 0 });
  const pdf = records.find((r) => r.url.endsWith("/prices.pdf"));
  assert.ok(pdf, "a pdf record");
  assert.equal(pdf.type, "pdf");
  assert.match(pdf.text, /Widget/);
  assert.equal(pdf.tables.length, 1);
  assert.deepEqual(pdf.tables[0][0], ["Item", "Price"]);
  assert.deepEqual(pdf.tables[0][1], ["Widget", "9.99"]);
  const noExt = records.find((r) => r.url.endsWith("/report"));
  assert.equal(noExt?.type, "pdf", "a PDF served without a .pdf extension is still extracted");
  assert.equal(records.filter((r) => r.type === "html").length, 3);
  assert.equal(stats.failed, 0, "image links are skipped, not fetched and failed");
  assert.ok(!hits.includes("/logo.png"));
});

test("a PDF can be the start URL", async (t) => {
  if (!chromium) return t.skip("needs Chromium");
  const records = [];
  const stats = await crawl({ urls: [`${base}/prices.pdf`], maxPages: 1 }, (r) => records.push(r));
  assert.equal(stats.failed, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "pdf");
  assert.deepEqual(records[0].tables[0][1], ["Widget", "9.99"]);
});

test("--js renders in Chromium and --click saves each view but never clicks risky buttons", async (t) => {
  if (!chromium) return t.skip("needs Chromium");
  const records = [];
  await crawl({ urls: [`${base}/app.html`], maxPages: 1, pdf: false, click: "button", wait: 100 }, (r) => records.push(r));
  assert.equal(records[0].title, "App");
  assert.equal(records[0].view, "");
  assert.deepEqual(records.slice(1).map((r) => r.view), ["Tab A", "Tab B"]);
  assert.match(records[1].text, /Alpha content/);
  assert.match(records[2].text, /Beta content/);
  assert.ok(records.every((r) => !/DELETED|SUBMITTED/.test(r.text)), "Delete and form buttons were skipped");
});

test("buttons: lists the clickable elements of a page", async (t) => {
  if (!chromium) return t.skip("needs Chromium");
  const { listButtons } = await import("../src/crawl.mjs");
  const rows = await listButtons(`${base}/app.html`);
  assert.deepEqual(rows.map((r) => r[3]), ["Tab A", "Tab B", "Delete", "Go"]);
  assert.equal(rows[0][0], "button");
});

test("layout(): aligned columns become a table, prose stays prose", () => {
  const it = (str, x, y, w = str.length * 5) => ({ str, width: w, height: 10, transform: [10, 0, 0, 10, x, y] });
  const items = [
    it("Item", 50, 700), it("Qty", 200, 700), it("Price", 350, 700),
    it("Widget", 50, 680), it("2", 200, 680), it("9.99", 350, 680),
    it("Gadget", 50, 660), it("10", 200, 660), it("24.50", 350, 660),
    it("Prices", 50, 600), it("are", 83, 600), it("valid", 101, 600), it("today.", 129, 600), // 3pt word spaces, like real prose
  ];
  const { text, tables } = layout(items);
  assert.deepEqual(tables, [[["Item", "Qty", "Price"], ["Widget", "2", "9.99"], ["Gadget", "10", "24.50"]]]);
  assert.match(text, /Prices are valid today\./);
  assert.match(text, /Widget \| 2 \| 9\.99/);
});

test("MCP mode: the crawl tool returns records over stdio", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "bin", "mtscraper.mjs"), "--mcp"] }));
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name), ["crawl"]);
    const res = await client.callTool({ name: "crawl", arguments: { url: `${base}/index.html`, max_pages: 0, pdf: false } });
    const out = JSON.parse(res.content[0].text);
    assert.equal(out.saved, 3);
    assert.equal(out.records.length, 3);
    assert.ok(fs.existsSync(out.file));
  } finally {
    await client.close();
  }
});
