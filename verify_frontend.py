from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto('http://localhost:8000')
        page.wait_for_selector('#aria-live-region', state='attached')
        text = page.locator('#aria-live-region').text_content()
        print(f"ARIA Live Region text: {text}")
        assert "Lade Materialien..." in text or "Modell (Farbe) geladen" in text or "Keine MTL gefunden. Lade grau." in text, "Text not synced!"
        print("Frontend check passed!")
        browser.close()

if __name__ == '__main__':
    main()
