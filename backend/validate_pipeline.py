"""Validate the full pipeline: static → detect garbage → Playwright → innerText → chunk."""
import asyncio
from app.services.url_processor import (
    download_url, extract_text_from_html, _is_spa_garbage,
    download_url_with_browser, _clean_text,
)
from app.services.document_processor import smart_chunk

URL = "https://centraldesustentabilidade.suzano.com.br/indicadores/?ind=consumo-de-energia-dentro-e-fora-da-organizacao-6562072b3a4e7"

async def main():
    # 1. Static download
    print("1. Static download...")
    content, ct, final_url = await download_url(URL)
    text, pages = extract_text_from_html(content, final_url)
    html_str = content.decode("utf-8", errors="replace")
    garbage = _is_spa_garbage(text, html_str)
    print(f"   {len(text)} chars | garbage={garbage}")

    if garbage:
        # 2. Playwright fallback
        print("2. Playwright fallback...")
        browser_bytes, _, browser_url, inner_text = await download_url_with_browser(URL)
        print(f"   HTML: {len(browser_bytes)} bytes | innerText: {len(inner_text)} chars")

        if inner_text and len(inner_text.strip()) > 500:
            text = _clean_text(inner_text)
            pages = max(1, len(text) // 3000)
            print(f"   Using innerText: {len(text)} chars, ~{pages} pages")
        else:
            text, pages = extract_text_from_html(browser_bytes, browser_url)
            print(f"   Using HTML extraction: {len(text)} chars, ~{pages} pages")

    # 3. Chunk
    print("3. Chunking...")
    chunks = smart_chunk(text)
    print(f"   Total chunks: {len(chunks)}")
    for i, c in enumerate(chunks[:5]):
        preview = c["content"][:100].replace("\n", " ")
        print(f"   Chunk {i}: {c['token_count']} tokens | {preview}...")
    if len(chunks) > 5:
        print(f"   ... and {len(chunks) - 5} more chunks")

    total_tokens = sum(c["token_count"] for c in chunks)
    avg_tokens = total_tokens // max(len(chunks), 1)
    print(f"\n   Total tokens: {total_tokens} | Average: {avg_tokens}/chunk")

asyncio.run(main())
