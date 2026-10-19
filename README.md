# MTScraper

**Free website crawler for Claude Code**, by [MazTech](https://maztech.me).

Ask Claude Code to *"scrape example.com"* in any project. MTScraper crawls the site, follows its internal links, and saves each page's clean main text (no menus or footers) to JSONL or CSV. Then Claude works with the data for you.

- 🆓 Free and open source, with no API keys or page limits
- ⚡ Fast: Scrapy with auto-throttling, retries and caching
- 🌐 JavaScript sites: optional headless Chromium rendering via Playwright
- 🖱️ One-page apps: clicks through tabs and buttons and saves every view
- ⏯️ Resumable: stop a big crawl and pick it up later
- 🤝 Polite: obeys robots.txt and stays on the target domain

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Python 3.10 or newer. The scraping libraries install automatically on first use.

## Install

### Option A — Plugin (recommended)
Inside Claude Code, run:
```
/plugin marketplace add <your-github-user>/mtscraper
/plugin install mtscraper@maztech
```

### Option B — Copy the skill folder
Copy `skills/mtscraper` into your personal skills folder.

**macOS / Linux**
```bash
git clone https://github.com/<your-github-user>/mtscraper.git
mkdir -p ~/.claude/skills && cp -r mtscraper/skills/mtscraper ~/.claude/skills/
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/<your-github-user>/mtscraper.git
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force mtscraper\skills\mtscraper "$HOME\.claude\skills\"
```

Restart Claude Code after installing.

## Use

Just ask Claude Code in plain language:

- *"Scrape the docs at example.com/docs, max 100 pages"*
- *"Pull every blog post from site.com into a CSV"*
- *"Crawl this competitor's site and summarize their services"*

Results are saved to a `scraped/` folder in your current project.

### Run it yourself (no Claude needed)
```bash
pip install -r skills/mtscraper/requirements.txt
playwright install chromium          # only needed for js=1

scrapy runspider skills/mtscraper/crawl.py -a url=https://example.com -a max_pages=200 -o pages.jsonl
```

| Option | Meaning |
|---|---|
| `-a url=A,B` | One or more start URLs |
| `-a max_pages=N` | Page cap (default 1000; `0` = no limit) |
| `-a follow=/blog/` | Only follow links containing this text |
| `-a js=1` | Render JavaScript with headless Chromium (slower) |
| `-a click=".tabs button"` | Click each matching button/tab and save every view (for one-page apps) |
| `-a wait=1500` | Milliseconds to wait after each click |
| `-o file.jsonl` / `.csv` | Output file |
| `-s JOBDIR=jobs/name` | Resumable crawl |

Each output record contains `url`, `title` and `text` (plus `view` for clicked views).

**Example — a one-page app with tabs:**
```bash
scrapy runspider skills/mtscraper/crawl.py -a url=https://app.example.com -a click="[role=tab]" -a max_pages=1 -o views.jsonl
```

## Safety

- **Read-only clicking:** click mode blocks every form post or data change, and skips buttons like Delete, Logout, Buy or Subscribe.
- **Prompt-injection aware:** the skill tells Claude to treat scraped text as data and never follow instructions found inside web pages.
- Runs locally. Nothing is sent anywhere except requests to the site you're scraping.

## Limits

- No logins, CAPTCHA solving or proxy rotation
- Sites with heavy bot protection may still block it
- Click mode doesn't open nested menus (buttons that only appear after another click)

## Responsible use

Respect each site's terms of service and robots.txt, and don't collect personal data about private individuals.

## License

MIT © [MazTech](https://maztech.me)
