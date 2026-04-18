"""Test URL extraction to see how much content we're actually getting."""
import asyncio
from app.services.url_processor import download_url, detect_content_type, extract_text_from_html

async def main():
    url = "https://centraldesustentabilidade.suzano.com.br/indicadores/"
    
    print(f"Downloading: {url}")
    content_bytes, content_type_header, final_url = await download_url(url)
    print(f"Downloaded: {len(content_bytes)} bytes ({len(content_bytes)/1024:.0f} KB)")
    print(f"Content-Type: {content_type_header}")
    print(f"Final URL: {final_url}")
    
    doc_type = detect_content_type(final_url, content_type_header)
    print(f"Detected type: {doc_type}")
    
    text, page_count = extract_text_from_html(content_bytes, final_url)
    
    print(f"\n--- Extracted Text Stats ---")
    print(f"Total chars: {len(text)}")
    print(f"Total words: {len(text.split())}")
    print(f"Estimated pages: {page_count}")
    print(f"\n--- First 2000 chars ---")
    print(text[:2000])
    print(f"\n--- Last 500 chars ---")
    print(text[-500:])

asyncio.run(main())
