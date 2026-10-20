#!/usr/bin/env node
// MTScraper CLI. Run `mtscraper --help`.
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";

const HELP = `MTScraper — free website crawler for AI agents (by MazTech, https://maztech.me)

Usage: mtscraper <url> [url...] [options]
       mtscraper buttons <url>      list clickable elements, to pick a --click selector
       mtscraper setup              install the Chromium build that --js, --click and buttons need (once per machine)
       mtscraper --mcp              run as an MCP server over stdio

Options:
  -o, --out <file>        output .jsonl or .csv (default: scraped/<host>.jsonl, appends if it exists)
  -n, --max-pages <N>     stop after N pages (default 1000, 0 = no limit); PDFs count as pages
  -f, --follow <text>     only follow links whose URL contains this text, e.g. /blog/
      --js                render pages in headless Chromium (JavaScript sites; 5-10x slower)
      --click <selector>  click each matching button/tab and save every view (implies --js)
      --wait <ms>         wait after each click for the view to update (default 1500)
      --no-pdf            skip linked PDFs (by default their text and tables are extracted too)
      --resume <name>     resumable: re-run the same command with the same name after Ctrl+C
  -q, --quiet             only print the summary
  -h, --help

Every record has: url, title, view, type ("html" | "pdf"), text, tables (PDF tables: rows, header first).`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    "max-pages": { type: "string", short: "n", default: "1000" },
    follow: { type: "string", short: "f", default: "" },
    js: { type: "boolean", default: false },
    click: { type: "string", default: "" },
    wait: { type: "string", default: "1500" },
    "no-pdf": { type: "boolean", default: false },
    resume: { type: "string", default: "" },
    quiet: { type: "boolean", short: "q", default: false },
    mcp: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (o.help) { console.log(HELP); process.exit(0); }

// Playwright's own error already says what is missing; this adds the command that installs the matching build.
process.on("uncaughtException", (e) => { fail(e); });
process.on("unhandledRejection", (e) => { fail(e); });
function fail(e) {
  console.error(e?.stack || e);
  if (/Executable doesn't exist|browserType\.launch/.test(String(e?.message))) console.error("\nChromium is missing. Run once:  npx -y github:mazprotech/mtscraper setup");
  process.exit(1);
}

if (o.mcp) {
  const { serve } = await import("../src/mcp.mjs");
  await serve();
} else if (positionals[0] === "setup") {
  // Use the Playwright bundled with this package, so the browser build always matches it.
  const { createRequire } = await import("node:module");
  const { spawnSync } = await import("node:child_process");
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
  process.exit(spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status ?? 1);
} else if (positionals[0] === "buttons") {
  const url = positionals[1];
  if (!url) { console.error("usage: mtscraper buttons <url>"); process.exit(2); }
  const { listButtons } = await import("../src/crawl.mjs");
  const rows = await listButtons(url);
  for (const [tag, cls, role, text] of rows) console.log(`${tag.padEnd(6)} class=${JSON.stringify(cls).padEnd(30)} role=${JSON.stringify(role).padEnd(10)} | ${text}`);
  console.log(`\n${rows.length} clickable elements`);
} else {
  const urls = positionals.map((u) => (/^https?:\/\//.test(u) ? u : `https://${u}`));
  if (!urls.length) { console.error(HELP); process.exit(2); }
  for (const u of urls) { try { new URL(u); } catch { console.error(`not a URL: ${u}`); process.exit(2); } }
  const out = o.out || path.join("scraped", `${new URL(urls[0]).hostname}.jsonl`);
  const csv = out.toLowerCase().endsWith(".csv");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const write = writer(out, csv);

  const { crawl } = await import("../src/crawl.mjs");
  const { log } = await import("crawlee");
  log.setLevel(o.quiet ? log.LEVELS.WARNING : log.LEVELS.INFO);
  const stats = await crawl({
    urls,
    maxPages: Number(o["max-pages"]),
    follow: o.follow,
    js: o.js,
    click: o.click,
    wait: Number(o.wait),
    pdf: !o["no-pdf"],
    resume: o.resume,
    storageDir: path.resolve("scraped", ".crawlee"), // crawl state always lives here, whatever -o says
  }, (record) => {
    write(record);
    if (!o.quiet) console.error(`saved ${record.type} ${record.url}${record.view ? ` [${record.view}]` : ""}`);
  });
  console.error(`done: ${stats.records} records -> ${out} (${stats.reason}${stats.failed ? `, ${stats.failed} failed` : ""})`);
}

function writer(out, csv) {
  const fields = ["url", "title", "view", "type", "text", "tables"];
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  if (csv && !(fs.existsSync(out) && fs.statSync(out).size)) fs.appendFileSync(out, fields.join(",") + "\n");
  return (r) => {
    const line = csv
      ? fields.map((f) => q(f === "tables" ? JSON.stringify(r[f]) : r[f])).join(",")
      : JSON.stringify(Object.fromEntries(fields.map((f) => [f, r[f]])));
    fs.appendFileSync(out, line + "\n");
  };
}
