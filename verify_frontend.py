import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto("http://localhost:8000/index.html")
        await page.wait_for_selector("#sr-status", state="attached")
        text = await page.locator("#sr-status").inner_text()
        print(f"Status is: {text}")
        await browser.close()

asyncio.run(run())
