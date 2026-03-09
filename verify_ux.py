import sys
import time
from playwright.sync_api import sync_playwright

def verify_overlay():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Let the page render
        page.goto("http://localhost:8000/index.html", wait_until="commit")
        time.sleep(1)

        # Check DOM structure
        ui_overlay = page.locator("#ui-overlay")
        assert ui_overlay.count() == 1, "Expected #ui-overlay to exist"

        # Verify overlay allows clicks through
        overlay_style = ui_overlay.evaluate("el => window.getComputedStyle(el).pointerEvents")
        assert overlay_style == "none", "Expected #ui-overlay to have pointer-events: none"

        toast = page.locator("#toast")
        assert toast.count() == 1, "Expected #toast to exist"

        # Verify a11y properties
        assert toast.get_attribute("role") == "status", "Expected #toast to have role=status"
        assert toast.get_attribute("aria-live") == "polite", "Expected #toast to have aria-live=polite"

        # Verify toast interactivity
        toast_style = toast.evaluate("el => window.getComputedStyle(el).pointerEvents")
        assert toast_style == "auto", "Expected #toast to have pointer-events: auto"

        # Verify visual sync updates
        print("Triggering debug text update")
        page.evaluate("""() => {
            const toast = document.getElementById('toast');
            toast.textContent = 'Testing Accessibility';
            toast.style.opacity = '1';

            clearTimeout(window.toastTimeout);
            window.toastTimeout = setTimeout(() => {
                toast.style.opacity = '0';
            }, 3000);
        }""")

        # Allow time for text to set
        time.sleep(0.5)

        toast_text = toast.inner_text()
        assert "Testing Accessibility" in toast_text, f"Expected toast text to update, got: {toast_text}"

        opacity = toast.evaluate("el => window.getComputedStyle(el).opacity")
        assert float(opacity) == 1.0, f"Expected toast to be visible, got opacity: {opacity}"

        # Wait for timeout (3 seconds + 0.5s padding)
        time.sleep(3.5)
        opacity_after = toast.evaluate("el => window.getComputedStyle(el).opacity")
        assert float(opacity_after) == 0.0, f"Expected toast to fade out, got opacity: {opacity_after}"

        print("Verification passed successfully.")
        browser.close()

if __name__ == "__main__":
    verify_overlay()
