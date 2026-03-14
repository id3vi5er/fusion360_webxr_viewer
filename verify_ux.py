import time
import subprocess
from playwright.sync_api import sync_playwright

def verify_frontend():
    # Start the local server for the frontend
    # Note: Using port 8000, killing any existing process first
    subprocess.run("kill $(lsof -t -i :8000) 2>/dev/null || true", shell=True)
    server_process = subprocess.Popen(["python3", "-m", "http.server", "8000", "--directory", "addin/www"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    time.sleep(2) # Give server a moment to start

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()

            # Navigate to the local server
            page.goto("http://localhost:8000", wait_until="commit")

            # Wait a moment for some basic setup
            page.wait_for_timeout(1000)

            # The functions are module-scoped so we can't easily call updateDebugText from here.
            # Instead, we test the DOM manipulation directly.
            page.evaluate("""
                const toast = document.getElementById('toast');
                if (toast) {
                    toast.innerText = 'Test Notification!';
                    toast.classList.add('visible');
                }
            """)

            # Take a screenshot to verify the toast appears correctly in the 2D view
            page.screenshot(path="toast_verification.png")

            # Check if the toast has the correct role and aria-live attributes
            role = page.evaluate("document.getElementById('toast').getAttribute('role')")
            aria_live = page.evaluate("document.getElementById('toast').getAttribute('aria-live')")

            if role != "status" or aria_live != "polite":
                print(f"Error: Incorrect ARIA attributes. Role: {role}, Aria-Live: {aria_live}")
                exit(1)
            else:
                print("Frontend UX verification successful. Toast has correct ARIA attributes and screenshot taken.")

            browser.close()
    finally:
        server_process.kill()

if __name__ == "__main__":
    verify_frontend()
