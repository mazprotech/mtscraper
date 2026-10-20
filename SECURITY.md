# Security

## Reporting a vulnerability

Email **contact@maztech.me**. Please do not open a public issue for security problems. We aim to reply within 7 days.

Include the command or MCP call you ran, the page or file that triggered the problem, and what happened.

## What counts

- Scraped content influencing what the tool does, for example page text ending up in a shell command or in a file path.
- Writing outside the chosen output file or the `scraped/` folder.
- Click mode sending a non-GET request, or clicking a button the guards should have skipped.
- The MCP server exposing anything beyond the `crawl` tool, or reading files it was not asked to.

## Scope note

MTScraper fetches whatever URL it is given, including hosts on your own network. Running it against internal services, and deciding which sites you may crawl, is the user's responsibility. The tool obeys robots.txt and has no option to disable that.
