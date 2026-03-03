from playwright.sync_api import sync_playwright
import time
import os

def verify_toast():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to local server...")
        page.goto("http://localhost:8000/addin/www/index.html")

        print("Waiting for initial load...")
        time.sleep(2)

        print("Bypassing WebXR init and showing toast directly via DOM manipulation...")
        page.evaluate("""
            () => {
                const toast = document.getElementById('toast');
                if (toast) {
                    toast.textContent = 'Modell (Farbe) geladen';
                    toast.style.opacity = '1';
                }
            }
        """)

        print("Waiting for CSS transition...")
        time.sleep(0.5)

        print("Taking screenshot...")
        os.makedirs("/home/jules/verification", exist_ok=True)
        screenshot_path = "/home/jules/verification/verification.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_toast()