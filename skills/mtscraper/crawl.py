"""MTScraper by MazTech (https://maztech.me): site crawler that follows links on the same domain(s) and saves clean page text.

Run:
  scrapy runspider crawl.py -a url=https://example.com -o pages.jsonl
Options (-a key=value):
  url        one start URL, or several separated by commas
  max_pages  stop after N pages (default 1000, 0 = no limit)
  follow     only follow links whose URL contains this text (e.g. /blog/)
  js         1 = render pages in a real browser (for JavaScript sites; slower)
  click      CSS selector of buttons/tabs to click one by one, saving each view (implies js=1)
             e.g. click="[role=tab]"  or  click=".tabs button"
  wait       ms to wait after each click for the view to update (default 1500)
"""
import re
from urllib.parse import urlparse

import scrapy
from scrapy.exceptions import CloseSpider
import trafilatura


# Buttons that could change something on the site are never clicked.
RISKY = re.compile(r"\b(delete|remove|log ?out|sign ?out|buy|pay|checkout|purchase|place order|add to cart|"
                   r"submit|send|subscribe|unsubscribe|register|sign ?up|confirm|upload|donate)\b", re.I)


class MTScraper(scrapy.Spider):
    name = "mtscraper"

    custom_settings = {
        # Be polite and avoid bans: obey robots.txt, adapt speed to server load.
        "ROBOTSTXT_OBEY": True,
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_TARGET_CONCURRENCY": 4,
        "CONCURRENT_REQUESTS": 32,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 8,
        "DOWNLOAD_DELAY": 0.25,
        "RETRY_TIMES": 3,
        "USER_AGENT": "Mozilla/5.0 (compatible; MTScraper/1.2; +https://maztech.me)",
        # Re-runs don't re-download pages already fetched.
        "HTTPCACHE_ENABLED": True,
        "HTTPCACHE_DIR": "httpcache",
        "FEED_EXPORT_ENCODING": "utf-8",
        "LOG_LEVEL": "INFO",
        # Browser rendering is only used for requests flagged with meta playwright=True (js=1).
        "DOWNLOAD_HANDLERS": {
            "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
            "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
        },
        "TWISTED_REACTOR": "twisted.internet.asyncioreactor.AsyncioSelectorReactor",
        "PLAYWRIGHT_BROWSER_TYPE": "chromium",
    }

    def __init__(self, url, max_pages="1000", follow="", js="0", click="", wait="1500", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [u.strip() for u in url.split(",") if u.strip()]
        self.allowed_domains = [urlparse(u).hostname for u in self.start_urls]
        self.follow = follow
        self.max_pages = int(max_pages)
        self.pages = 0
        self.click = click
        self.wait = int(wait)
        self.meta = {"playwright": True} if js == "1" or click else {}
        if click:
            self.meta["playwright_include_page"] = True  # keep the live tab so we can click in it
        self.seen = set()  # start URLs bypass Scrapy's dupe filter, so track them here

    @classmethod
    def from_crawler(cls, crawler, *args, **kwargs):
        spider = super().from_crawler(crawler, *args, **kwargs)
        # Separate caches, so a plain (unrendered) page is never reused by a js=1 run.
        if spider.meta:
            crawler.settings.set("HTTPCACHE_DIR", "httpcache-js", priority="spider")
        if spider.click:
            # A cached response has no live browser tab to click in.
            crawler.settings.set("HTTPCACHE_ENABLED", False, priority="spider")
        return spider

    async def start(self):
        for u in self.start_urls:
            yield scrapy.Request(u, meta=self.meta, errback=self.close_page)

    async def parse(self, response):
        page = response.meta.get("playwright_page")
        try:
            if not response.headers.get("Content-Type", b"").startswith(b"text/html"):
                return
            if response.url in self.seen:
                return
            self.seen.add(response.url)
            self.pages += 1
            if self.max_pages and self.pages > self.max_pages:
                raise CloseSpider("max_pages reached")
            title = response.css("title::text").get(default="").strip()
            text = trafilatura.extract(response.text) or ""
            yield {"url": response.url, "title": title, "view": "", "text": text}
            if page and self.click:
                async for item in self.click_views(page, response.url, title, {text}):
                    yield item
            for href in response.css("a::attr(href)").getall():
                link = response.urljoin(href)
                if not link.startswith(("http://", "https://")):  # skip mailto:, tel:, javascript:
                    continue
                if not self.follow or self.follow in link:
                    yield scrapy.Request(link, self.parse, meta=self.meta, errback=self.close_page)
        finally:
            if page:
                await page.close()

    async def close_page(self, failure):
        page = failure.request.meta.get("playwright_page")
        if page:
            await page.close()
        self.logger.info(f"failed: {failure.request.url} ({failure.value.__class__.__name__})")

    async def click_views(self, page, url, title, texts):
        # Read-only browsing: block every non-GET request (form posts, API writes) while clicking.
        await page.route("**/*", lambda route: route.abort() if route.request.method != "GET" else route.continue_())
        texts.add(await page.inner_text("body"))
        buttons = page.locator(self.click)
        for i in range(await buttons.count()):
            btn = buttons.nth(i)
            try:
                if not await btn.is_visible():
                    continue
                label = " ".join((await btn.inner_text(timeout=2000)).split())[:80]
                hint = " ".join(filter(None, [label, await btn.get_attribute("aria-label"),
                                              await btn.get_attribute("type")]))
                if RISKY.search(hint) or await btn.evaluate("e => !!e.closest('form')"):
                    self.logger.info(f"skip risky button {label!r} on {url}")
                    continue
                await btn.click(timeout=5000)
                await page.wait_for_timeout(self.wait)
            except Exception as e:  # disabled/detached button: skip it, keep going
                self.logger.info(f"skip click {i} on {url}: {e.__class__.__name__}")
                continue
            # Visible text, not article extraction: tab content is often short (prices, tables).
            text = await page.inner_text("body")
            if text and text not in texts:  # only save views that actually changed
                texts.add(text)
                yield {"url": url, "title": f"{title} | {label}", "view": label, "text": text}
            if page.url.split("#")[0] != url.split("#")[0]:  # button navigated away: come back
                await page.goto(url)
