// MCP server mode: one `crawl` tool over stdio, for Claude Desktop, Codex, Gemini CLI, Cursor, Windsurf, VS Code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { crawl } from "./crawl.mjs";

const MAX_CHARS = 200_000; // what we hand back inline; the full result is always in the file

export async function serve() {
  const { log } = await import("crawlee");
  log.setLevel(log.LEVELS.OFF); // stdout is the protocol channel, nothing else may print there
  const server = new McpServer({ name: "mtscraper", version: "2.0.0" });

  server.registerTool("crawl", {
    title: "Crawl a website into clean text",
    description: "Crawls a site from the start URL, following internal links (same domain) and linked PDFs, and returns one record per page: url, title, view, type (html|pdf), text, tables. Obeys robots.txt. Results are also written to a JSONL file whose path is returned.",
    inputSchema: {
      url: z.string().url().describe("Start URL"),
      max_pages: z.number().int().min(0).default(50).describe("Stop after this many pages (0 = no limit)"),
      follow: z.string().optional().describe("Only follow links whose URL contains this text, e.g. /docs/"),
      js: z.boolean().default(false).describe("Render pages in headless Chromium for JavaScript sites (slower)"),
      click: z.string().optional().describe("CSS selector of tabs/buttons to click on single-page apps, saving every view"),
      pdf: z.boolean().default(true).describe("Also download linked PDFs and extract their text and tables"),
    },
  }, async ({ url, max_pages, follow, js, click, pdf }) => {
    const dir = path.join(os.tmpdir(), "mtscraper");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new URL(url).hostname}-${Date.now()}.jsonl`);
    const records = [];
    const stats = await crawl({ urls: [url], maxPages: max_pages, follow, js, click, pdf, storageDir: path.join(dir, ".crawlee") }, (r) => {
      records.push(r);
      fs.appendFileSync(file, JSON.stringify(r) + "\n");
    });
    // Return whole records until the budget runs out, then point at the file for the rest.
    let used = 0;
    const inline = [];
    for (const r of records) {
      const s = JSON.stringify(r);
      if (used + s.length > MAX_CHARS) break;
      used += s.length;
      inline.push(r);
    }
    const text = JSON.stringify({ file, saved: stats.saved, failed: stats.failed, reason: stats.reason,
      truncated: inline.length < records.length ? `showing ${inline.length} of ${records.length} records, read the file for all` : false,
      records: inline });
    return { content: [{ type: "text", text }] };
  });

  await server.connect(new StdioServerTransport());
}
