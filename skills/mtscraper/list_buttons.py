"""List clickable elements on a page, to pick a selector for crawl.py's click mode.

Run: python list_buttons.py https://app.example.com
"""
import sys

if len(sys.argv) != 2:
    sys.exit("usage: python list_buttons.py <url>")

from playwright.sync_api import sync_playwright

JS = """els => els.map(e => [e.tagName.toLowerCase(), e.className, e.getAttribute('role') || '',
                          e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 50)])"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(sys.argv[1])
    page.wait_for_timeout(2000)
    rows = page.eval_on_selector_all("button, [role=tab], [role=button], a[href^='#']", JS)
    browser.close()

for tag, cls, role, text in rows:
    print(f"{tag:6} class={cls!r:30} role={role!r:10} | {text}")
print(f"\n{len(rows)} clickable elements")
