"""Test Playwright extraction for the Suzano indicators page."""
import asyncio
from app.services.url_processor import (
    download_url, download_url_with_browser,
    detect_content_type, extract_text_from_html,
    _is_spa_garbage,
)

async def main():
    url = "https://centraldesustentabilidade.suzano.com.br/indicadores/"

    # Step 1: Static extraction
    print("=" * 60)
    print("STATIC EXTRACTION (httpx)")
    print("=" * 60)
    content_bytes, ct_header, final_url = await download_url(url)
    text_static, pages_static = extract_text_from_html(content_bytes, final_url)
    html_str = content_bytes.decode("utf-8", errors="replace")
    is_garbage = _is_spa_garbage(text_static, html_str)
    print(f"Size: {len(content_bytes)} bytes")
    print(f"Text length: {len(text_static)} chars, {len(text_static.split())} words")
    print(f"Is SPA garbage: {is_garbage}")
    print(f"First 300 chars: {text_static[:300]}")
    print()

    # Step 2: Playwright extraction
    print("=" * 60)
    print("PLAYWRIGHT EXTRACTION (headless Chromium)")
    print("=" * 60)
    browser_bytes, _, browser_url = await download_url_with_browser(url)
    text_pw, pages_pw = extract_text_from_html(browser_bytes, browser_url)
    html_pw = browser_bytes.decode("utf-8", errors="replace")
    is_garbage_pw = _is_spa_garbage(text_pw, html_pw)
    print(f"Size: {len(browser_bytes)} bytes")
    print(f"Text length: {len(text_pw)} chars, {len(text_pw.split())} words")
    print(f"Is SPA garbage: {is_garbage_pw}")
    print(f"Estimated pages: {pages_pw}")
    print(f"\nFirst 1000 chars:\n{text_pw[:1000]}")
    print(f"\nLast 500 chars:\n{text_pw[-500:]}")

asyncio.run(main())
