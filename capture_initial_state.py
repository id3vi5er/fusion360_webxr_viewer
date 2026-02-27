
from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8000/index.html")

    # Wait a bit for things to load
    time.sleep(2)

    page.screenshot(path="before_changes.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
