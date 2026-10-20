// MTScraper by MazTech (https://maztech.me): crawl a site (same domain) and hand back one record per page.
// Record shape, identical for every row: { url, title, view, type: "html" | "pdf", text, tables }.
import { CheerioCrawler, PlaywrightCrawler, RequestQueue, log } from "crawlee";
import { fromHtml, fromPdf } from "./extract.mjs";

export const UA = "Mozilla/5.0 (compatible; MTScraper/2.0; +https://maztech.me)";

// Buttons whose label suggests they change something are never clicked (a label check cannot catch everything).
export const RISKY = /\b(delete|remove|log ?out|sign ?out|buy|pay|checkout|purchase|place order|add to cart|submit|send|subscribe|unsubscribe|register|sign ?up|confirm|upload|donate)\b/i;

const ext = (u) => { try { return (new URL(u).pathname.match(/\.([a-z0-9]{1,5})$/i) || [, ""])[1].toLowerCase(); } catch { return ""; } };
const isPdfUrl = (u) => ext(u) === "pdf";
// Links to files that are neither pages nor PDFs are not worth a request (they would only count as failures).
const SKIP_EXT = /^(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|avif|mp3|mp4|m4a|wav|ogg|webm|mov|avi|zip|gz|tgz|bz2|7z|rar|exe|dmg|msi|apk|iso|docx?|xlsx?|pptx?|css|js|mjs|json|xml|rss|atom|woff2?|ttf|otf|eot)$/;
const squeeze = (s) => s.replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/**
 * @param {object} o
 * @param {string[]} o.urls        start URLs
 * @param {number}  [o.maxPages]   stop after N saved pages (0 = no limit); PDFs count, clicked views don't
 * @param {string}  [o.follow]     only follow links whose URL contains this text
 * @param {boolean} [o.js]         render in headless Chromium
 * @param {string}  [o.click]      CSS selector of buttons/tabs to click, saving every view (implies js)
 * @param {number}  [o.wait]       ms to wait after each click
 * @param {boolean} [o.pdf]        download linked PDFs and extract text + tables
 * @param {string}  [o.resume]     name of a resumable run (re-run the same command after Ctrl+C)
 * @param {string}  [o.storageDir] where Crawlee keeps its queue
 * @param {(record: object) => void} onRecord
 * @returns {Promise<{saved: number, failed: number, reason: string}>}
 */
export async function crawl({ urls, maxPages = 1000, follow = "", js = false, click = "", wait = 1500, pdf = true, resume = "", storageDir = "" }, onRecord) {
  if (storageDir) process.env.CRAWLEE_STORAGE_DIR = storageDir;
  process.env.CRAWLEE_PURGE_ON_START = "0"; // we use our own named queue below, nothing shared to purge
  const useBrowser = js || !!click;
  const stats = { saved: 0, failed: 0, reason: "finished" };
  // A queue of its own per run, so runs in one process (MCP mode) never see each other's URLs.
  const queueName = resume ? `resume-${resume.replace(/[^\w-]/g, "_")}` : `run-${Date.now()}-${process.pid}`;
  const requestQueue = await RequestQueue.open(queueName);
  let crawler;

  const stop = (reason) => { stats.reason = reason; crawler.stop(reason); };

  const prepare = (req) => { // start URLs and discovered links alike
    if (SKIP_EXT.test(ext(req.url))) return false;
    if (isPdfUrl(req.url)) {
      if (!pdf) return false;
      req.label = "pdf";
      req.skipNavigation = true; // a browser tab cannot render a PDF, so PDFs are always plain downloads
    }
    return req;
  };
  const transformRequestFunction = (req) => (follow && !req.url.includes(follow) ? false : prepare(req)); // discovered links only

  async function handler(ctx) {
    const { request } = ctx;
    if (maxPages && stats.saved >= maxPages) return stop("max_pages reached"); // was already downloading when the cap was reached
    let record;
    if (request.label === "pdf" || ctx.contentType?.type === "application/pdf") {
      if (!pdf) return; // a PDF hiding behind a URL without .pdf: only known after the download
      const body = request.label === "pdf" ? (await ctx.sendRequest({ responseType: "buffer" })).body : ctx.body;
      if (body.subarray(0, 5).toString() !== "%PDF-") return;
      const name = new URL(request.url).pathname.split("/").pop() || "file.pdf";
      record = { ...(await fromPdf(body, name)), type: "pdf" };
    } else {
      const html = useBrowser ? await ctx.page.content() : ctx.body.toString();
      record = { ...fromHtml(html), type: "html", tables: [] };
    }
    const url = request.loadedUrl ?? request.url;
    stats.saved++;
    onRecord({ url, title: record.title, view: "", type: record.type, text: record.text, tables: record.tables });
    if (click && ctx.page) await clickViews(ctx.page, url, record.title, new Set([record.text]));
    if (maxPages && stats.saved >= maxPages) return stop("max_pages reached"); // queue nothing more; in-flight downloads still finish
    if (record.type === "html") await ctx.enqueueLinks({ strategy: "same-domain", transformRequestFunction });
  }

  async function clickViews(page, url, title, texts) {
    // Lower the risk of changing anything: block every non-GET request (form posts, API writes) while clicking.
    // This is not a guarantee: a plain link or button can still trigger a GET that logs out, deletes or toggles.
    await page.route("**/*", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
    texts.add(await page.innerText("body"));
    const buttons = page.locator(click);
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const btn = buttons.nth(i);
      let label = "";
      try {
        if (!(await btn.isVisible())) continue;
        label = (await btn.innerText({ timeout: 2000 })).split(/\s+/).join(" ").slice(0, 80);
        const hint = [label, await btn.getAttribute("aria-label"), await btn.getAttribute("type")].filter(Boolean).join(" ");
        if (RISKY.test(hint) || (await btn.evaluate((e) => !!e.closest("form")))) {
          log.info(`skip risky button "${label}" on ${url}`);
          continue;
        }
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(wait);
      } catch (e) { // disabled/detached button: skip it, keep going
        log.info(`skip click ${i} on ${url}: ${e.constructor.name}`);
        continue;
      }
      // Visible text, not article extraction: tab content is often short (prices, tables).
      const text = await page.innerText("body");
      if (text && !texts.has(text)) { // only save views that actually changed
        texts.add(text);
        onRecord({ url, title: `${title} | ${label}`, view: label, type: "html", text: squeeze(text), tables: [] });
      }
      if (page.url().split("#")[0] !== url.split("#")[0]) await page.goto(url); // button navigated away: come back
    }
  }

  const common = {
    requestQueue,
    requestHandler: handler,
    respectRobotsTxtFile: true,
    maxConcurrency: 4,
    maxRequestsPerMinute: 300,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 120,
    failedRequestHandler: ({ request }, err) => { stats.failed++; log.warning(`failed: ${request.url} (${err.message.split("\n")[0]})`); },
  };
  crawler = useBrowser
    ? new PlaywrightCrawler({ ...common, launchContext: { userAgent: UA }, headless: true })
    : new CheerioCrawler({
        ...common,
        additionalMimeTypes: ["application/pdf"],
        preNavigationHooks: [(_ctx, gotOptions) => { gotOptions.headers = { ...gotOptions.headers, "user-agent": UA }; }],
      });

  try {
    await crawler.run(urls.map((url) => prepare({ url })).filter(Boolean));
  } finally {
    if (!resume) await requestQueue.drop();
  }
  return stats;
}

/** List clickable elements on a page, to pick a selector for click mode. */
export async function listButtons(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url);
    await page.waitForTimeout(2000);
    return await page.$$eval("button, [role=tab], [role=button], a[href^='#']", (els) =>
      els.map((e) => [e.tagName.toLowerCase(), e.className, e.getAttribute("role") || "", e.innerText.trim().replace(/\s+/g, " ").slice(0, 50)]));
  } finally {
    await browser.close();
  }
}
