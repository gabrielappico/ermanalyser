"""Debug Playwright rendering for Suzano indicators page."""
import asyncio
from playwright.async_api import async_playwright

URL = "https://centraldesustentabilidade.suzano.com.br/indicadores/?ind=consumo-de-energia-dentro-e-fora-da-organizacao-6562072b3a4e7"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            locale="pt-BR",
        )
        page = await context.new_page()

        # Log all console messages from the page
        page.on("console", lambda msg: print(f"  [CONSOLE {msg.type}] {msg.text[:200]}"))

        print(f"1. Navigating to {URL[:80]}...")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        print("   domcontentloaded fired")

        # Wait for networkidle separately
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
            print("   networkidle fired")
        except:
            print("   networkidle timeout (15s) - continuing anyway")

        # Wait extra time for SPA hydration
        print("2. Waiting 15s for SPA to hydrate...")
        await page.wait_for_timeout(15000)

        # Try scrolling to trigger lazy content
        print("3. Scrolling page...")
        await page.evaluate("""async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for (let i = 0; i < 10; i++) {
                window.scrollBy(0, window.innerHeight);
                await delay(800);
            }
            window.scrollTo(0, 0);
        }""")
        await page.wait_for_timeout(3000)

        # Check for specific content
        print("4. Checking page content...")
        html = await page.content()
        print(f"   HTML length: {len(html)} chars")

        # Look for evidence of loaded content
        body_text = await page.evaluate("document.body.innerText")
        print(f"   Body text length: {len(body_text)} chars")
        print(f"   Contains 'energia': {'energia' in body_text.lower()}")
        print(f"   Contains 'GJ': {'GJ' in body_text}")
        print(f"   Contains 'Suzano': {'Suzano' in body_text}")
        print(f"   Contains 'biomassa': {'biomassa' in body_text.lower()}")
        print(f"   Contains 'byslug': {'byslug' in body_text}")
        print(f"   Contains 'exception': {'exception' in body_text.lower()}")

        # Save screenshot for debugging
        await page.screenshot(path="debug_screenshot.png", full_page=True)
        print("   Screenshot saved to debug_screenshot.png")

        # Print first 3000 chars of body text
        print(f"\n{'='*60}")
        print("BODY TEXT (first 3000 chars):")
        print("="*60)
        print(body_text[:3000])

        # Print last 1000 chars
        print(f"\n{'='*60}")
        print("BODY TEXT (last 1000 chars):")
        print("="*60)
        print(body_text[-1000:])

        # Check all tables
        tables = await page.query_selector_all("table")
        print(f"\n{'='*60}")
        print(f"Found {len(tables)} <table> elements")
        for i, table in enumerate(tables):
            table_text = await table.inner_text()
            print(f"\nTable {i}: {len(table_text)} chars")
            print(table_text[:300])

        await browser.close()

asyncio.run(main())
