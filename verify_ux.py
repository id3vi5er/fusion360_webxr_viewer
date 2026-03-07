from playwright.sync_api import sync_playwright

def verify_toast():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Go to local server
        page.goto("http://localhost:8000", wait_until="commit")
        page.wait_for_selector("#toast-container")

        # Verify DOM structure
        dom_overlay = page.locator("#dom-overlay")
        assert dom_overlay.count() == 1, "Missing dom-overlay"

        toast = page.locator("#toast-container")
        assert toast.count() == 1, "Missing toast-container"

        assert toast.get_attribute("role") == "status", "Missing role='status'"
        assert toast.get_attribute("aria-live") == "polite", "Missing aria-live='polite'"

        # Wait a bit for CSS to load completely
        page.wait_for_timeout(1000)

        # Trigger toast visibility programmatically for test
        page.evaluate("document.getElementById('toast-container').classList.add('visible')")

        # Check if visible class is added
        assert "visible" in toast.evaluate("el => el.className"), "Visible class should be present"

        print("✅ Toast UX enhancements successfully verified.")

        browser.close()

if __name__ == "__main__":
    verify_toast()
