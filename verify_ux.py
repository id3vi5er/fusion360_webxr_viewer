
from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8000/index.html")

    # Wait a bit for things to load
    time.sleep(2)

    # Check if the status overlay exists
    overlay = page.locator("#status-overlay")
    if overlay.count() > 0:
        print("FAIL: Status overlay already exists")
    else:
        print("PASS: Status overlay does not exist yet")

    page.screenshot(path="before_changes.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
