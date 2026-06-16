from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir='/home/jules/verification/videos/')
        page = context.new_page()

        page.goto("http://localhost:8000/index.html")

        page.wait_for_selector("#ar-announcer", state="attached")

        # Un-hide for screenshot
        page.evaluate('''
            const el = document.getElementById('ar-announcer');
            el.style.position = 'static';
            el.style.width = 'auto';
            el.style.height = 'auto';
            el.style.clip = 'auto';
            el.style.overflow = 'visible';
            el.textContent = "Test Accessibility Announcement";
        ''')

        page.screenshot(path="/home/jules/verification/screenshots/a11y_overlay.png")

        context.close()
        browser.close()

run()
