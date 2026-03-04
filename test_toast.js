const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:8000/index.html');

  // Verify elements are in the DOM
  const overlay = page.locator('#overlay');
  await overlay.waitFor({ state: 'attached' });
  const toast = page.locator('#toast');
  await toast.waitFor({ state: 'attached' });

  // Add the 'visible' class manually to test styling & layout
  await page.evaluate(() => {
    const el = document.getElementById('toast');
    if (el) {
      el.classList.add('visible');
      el.textContent = 'Accessibility Tested!';
    }
  });

  // Verify the class was added and text changed
  await toast.waitFor({ state: 'visible' });

  // Take a screenshot
  await page.screenshot({ path: 'toast_test.png' });

  console.log('Test complete. Screenshot saved to toast_test.png');
  await browser.close();
})();
