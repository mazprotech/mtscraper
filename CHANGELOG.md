# Changelog

All notable changes to MTScraper. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2.0.0 - 2026-10-20

### Changed
- Rewritten in Node.js (20 or newer). No Python, no pip. Runs with `npx -y github:mazprotech/mtscraper`, which fetches the newest commit on every run.
- Crawler is now [Crawlee](https://crawlee.dev): same-domain links, robots.txt obeyed, retries, concurrency 4.
- Main text is extracted with Mozilla Readability instead of trafilatura.
- The page cap is exact for `--max-pages 1` and queues nothing more once reached. Before, one extra page was downloaded and discarded.
- "Read-only clicking" is now described as what it is: it lowers the risk of changing anything, it cannot guarantee it. The guards are unchanged.

### Added
- Linked PDFs are downloaded and extracted by default: `text` plus `tables` (rows of strings, header row first) via pdf.js and a layout heuristic. `--no-pdf` skips them.
- `--mcp`: an MCP server over stdio with one tool, `crawl`, for Claude Desktop, Codex, Gemini CLI, Cursor, Windsurf and VS Code.
- The skill folder follows the Agent Skills format and works in Claude Code, Codex CLI, Gemini CLI, Cursor, Copilot CLI and VS Code.
- `setup` subcommand installs the Chromium build that matches the bundled Playwright.
- `buttons <url>` subcommand lists clickable elements to pick a `--click` selector (was `list_buttons.py`).
- `--resume <name>` for resumable crawls (was `-s JOBDIR=`).
- Links to images, archives, media, fonts and scripts are skipped instead of fetched and reported as failures.
- A PDF served from a URL without a `.pdf` extension is still recognised and extracted.
- Test suite (`npm test`): local server, page cap, link following, `--follow`, PDF tables, click-mode safety, MCP round trip. CI runs it on every push.
- Examples: `examples/sample.jsonl` and `examples/price-list.pdf` with its extracted record.

### Removed
- The Python/Scrapy edition (`crawl.py`, `list_buttons.py`, `requirements.txt`) and its HTTP cache.

## 1.2.0 - 2026-10-19

Python/Scrapy skill for Claude Code: same-domain crawl into JSONL/CSV, optional Playwright rendering, click mode for single-page apps, resumable crawls, robots.txt obeyed. Superseded by 2.0.0.
