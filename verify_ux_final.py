
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
        print("PASS: Status overlay exists")
    else:
        print("FAIL: Status overlay does not exist")

    # Check if toast exists and has initial text
    toast = page.locator("#toast")
    if toast.count() > 0:
         print("PASS: Toast element exists")
    else:
         print("FAIL: Toast element missing")

    # The ARButton should be injected into the overlay now
    ar_button = page.locator("#status-overlay button#ARButton")
    if ar_button.count() > 0:
        print("PASS: ARButton is inside the overlay")
    else:
        print("FAIL: ARButton is NOT inside the overlay (or ID changed)")

    page.screenshot(path="after_changes.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
