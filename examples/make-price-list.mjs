// Builds examples/price-list.pdf (a small brochure-style PDF with a table) with headless Chromium,
// then writes examples/price-list.jsonl: the record MTScraper extracts from it.
// Run: node examples/make-price-list.mjs   (needs Chromium: node bin/mtscraper.mjs setup)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fromPdf } from "../src/extract.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111215; margin: 48px; }
  h1 { color: #C21622; margin-bottom: 4px; } .sub { color: #555; margin-top: 0; }
  table { border-collapse: collapse; margin: 24px 0; } th, td { border: 1px solid #bbb; padding: 6px 14px; text-align: left; }
  th { background: #f3f3f3; } td.num { text-align: right; } .note { font-size: 12px; color: #555; }
</style></head><body>
  <h1>Example Studio</h1><p class="sub">Price list, valid from January 2026</p>
  <p>All prices are per unit and exclude VAT. Discounts apply from ten units of the same service.</p>
  <table>
    <tr><th>Service</th><th>Unit</th><th>Price (USD)</th></tr>
    <tr><td>Logo design</td><td>per project</td><td class="num">450.00</td></tr>
    <tr><td>Landing page</td><td>per page</td><td class="num">900.00</td></tr>
    <tr><td>Product photo</td><td>per photo</td><td class="num">35.00</td></tr>
    <tr><td>Short video edit</td><td>per minute</td><td class="num">120.00</td></tr>
  </table>
  <p class="note">Payment within 14 days. Rush delivery adds 25 percent.</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
const pdf = await page.pdf({ format: "A4" });
await browser.close();
fs.writeFileSync(path.join(dir, "price-list.pdf"), pdf);

const record = { url: "examples/price-list.pdf", view: "", ...(await fromPdf(pdf, "price-list.pdf")), type: "pdf" };
const ordered = Object.fromEntries(["url", "title", "view", "type", "text", "tables"].map((k) => [k, record[k]]));
fs.writeFileSync(path.join(dir, "price-list.jsonl"), JSON.stringify(ordered) + "\n");
console.log(`wrote price-list.pdf (${pdf.length} bytes) and price-list.jsonl with ${ordered.tables.length} table(s)`);
