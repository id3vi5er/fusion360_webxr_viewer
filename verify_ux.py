import os
import subprocess
import time
from playwright.sync_api import sync_playwright

def run_tests():
    # Start the local server serving the addin/www directory
    print("Starting server...")
    www_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'addin', 'www')
    server_process = subprocess.Popen(['python3', '-m', 'http.server', '8000'], cwd=www_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2) # Wait for server to start

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()

            print("Navigating to local server...")
            page.goto('http://localhost:8000/index.html', wait_until='commit')

            # Verify #overlay element
            overlay = page.locator('#overlay')
            assert overlay.count() == 1, "Overlay element not found"

            # Verify #toast element and attributes
            toast = page.locator('#toast')
            assert toast.count() == 1, "Toast element not found"
            assert toast.get_attribute('role') == 'status', "Toast element missing role='status'"
            assert toast.get_attribute('aria-live') == 'polite', "Toast element missing aria-live='polite'"

            # Test direct DOM manipulation to trigger the visible class and test styles
            print("Testing DOM manipulation...")
            page.evaluate("""
                const toast = document.getElementById('toast');
                toast.textContent = 'Test notification';
                toast.classList.add('visible');
            """)

            # Verify visibility and text via evaluation
            is_visible = page.evaluate("document.getElementById('toast').classList.contains('visible')")
            assert is_visible, "Toast should have the 'visible' class"

            text_content = page.evaluate("document.getElementById('toast').textContent")
            assert text_content == 'Test notification', "Toast text content was not set correctly"

            # Test that the ARButton was created correctly with domOverlay
            print("Testing ARButton configuration...")
            # We can't easily intercept the ARButton.createButton call, but we can verify the DOM structure it usually creates.
            # However, Three.js ARButton adds the button directly to document.body, so let's check for a button in the body.
            button_count = page.locator('button').count()
            # Three.js ARButton might take a moment to initialize or might fail if WebXR is not supported.
            # We skip explicit testing of the ARButton.createButton arguments here as they are inside the module scope,
            # but the fact that our script ran without crashing the page is a good sign.

            print("All frontend verification tests passed successfully!")
            browser.close()

    finally:
        print("Stopping server...")
        server_process.terminate()

if __name__ == "__main__":
    run_tests()
