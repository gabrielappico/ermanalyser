"""URL-based document ingestion — download from URL, detect type, extract text, and process.

Supports:
  - PDF URLs → download + PyMuPDF extraction
  - HTML pages → download + trafilatura/BeautifulSoup extraction
  - SPA / JS-heavy pages → Playwright headless browser fallback

Fallback logic:
  1. Static download via httpx
  2. Extract text with trafilatura / BS4
  3. If content looks like SPA garbage (JSON errors, <500 useful chars),
     re-download with Playwright headless Chromium and extract again.
"""

import re
import logging
import httpx
import trafilatura
from bs4 import BeautifulSoup
from urllib.parse import urlparse

from app.services.document_processor import (
    extract_text_from_pdf,
    smart_chunk,
    generate_embeddings_for_document,
)
from app.database import get_supabase

logger = logging.getLogger(__name__)


DOWNLOAD_TIMEOUT = 60
MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024  # 100 MB
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def detect_content_type(url: str, content_type_header: str | None) -> str:
    """Determine whether URL points to a PDF or HTML page."""
    url_lower = url.lower().split("?")[0]
    if url_lower.endswith(".pdf"):
        return "pdf"

    if content_type_header:
        ct = content_type_header.lower()
        if "application/pdf" in ct:
            return "pdf"
        if "text/html" in ct or "application/xhtml" in ct:
            return "html"

    return "html"


# Minimum useful chars to consider static extraction successful
_MIN_USEFUL_CHARS = 500

# Patterns that indicate SPA garbage / API error dumps instead of real content
_GARBAGE_PATTERNS = [
    r'"exception"\s*:', r'"trace"\s*:', r'"stacktrace"\s*:',
    r'Symfony\\', r'Laravel\\', r'500 Internal Server Error',
    r'"message"\s*:\s*"No query results',
    r'<noscript>.*enable javascript',
    r'__NEXT_DATA__',
]
_GARBAGE_RE = re.compile('|'.join(_GARBAGE_PATTERNS), re.IGNORECASE | re.DOTALL)


def _is_spa_garbage(text: str, html_str: str) -> bool:
    """Detect if extracted text is SPA garbage or incomplete because of JS rendering.

    Returns True if:
    - Text is too short (<500 chars)
    - Text contains known garbage patterns (error dumps, stack traces)
    - HTML is script-heavy (SPA) and the text is missing tabular data that's in the raw HTML
    """
    stripped = text.strip()
    if len(stripped) < _MIN_USEFUL_CHARS:
        return True
    if _GARBAGE_RE.search(text):
        return True

    # Check for SPA indicators in the raw HTML
    html_lower = html_str.lower()
    script_count = html_lower.count('<script')

    # Heavy SPA (5+ scripts) with relatively short text is suspicious
    if script_count > 5 and len(stripped) < 1000:
        return True

    # If HTML references a JS framework / data-loading pattern, tables might be JS-rendered
    spa_frameworks = ['react', 'vue', 'angular', 'nuxt', 'next', '__nuxt', 'data-v-', 'ng-app']
    has_spa_framework = any(fw in html_lower for fw in spa_frameworks)

    if has_spa_framework and script_count > 3:
        # Check if HTML has table-like data patterns that text doesn't include
        # Common indicators: the HTML mentions numbers/data but extracted text is mostly prose
        html_has_tables = '<table' in html_lower or 'data-table' in html_lower
        text_has_numbers = len(re.findall(r'\d{1,3}(?:\.\d{3})+(?:,\d+)?', text)) > 3  # brazilian number format

        if html_has_tables and not text_has_numbers:
            return True

    return False


def extract_text_from_html(html_bytes: bytes, url: str) -> tuple[str, int]:
    """Extract meaningful text from an HTML page.

    Uses trafilatura for smart content extraction, with BeautifulSoup fallback.
    Returns (text, estimated_page_count).
    """
    html_str = html_bytes.decode("utf-8", errors="replace")

    # Try trafilatura first — it's excellent at extracting article/report content
    extracted = trafilatura.extract(
        html_str,
        include_tables=True,
        include_comments=False,
        include_links=False,
        favor_recall=True,
        url=url,
    )

    if extracted and len(extracted.strip()) > 200:
        text = _clean_text(extracted)
        if not _is_spa_garbage(text, html_str):
            page_estimate = max(1, len(text) // 3000)
            return text, page_estimate

    # Fallback: BeautifulSoup — strip all non-content elements
    soup = BeautifulSoup(html_str, "lxml")

    for tag in soup.find_all(["script", "style", "nav", "footer", "header",
                               "aside", "noscript", "iframe", "svg", "form"]):
        tag.decompose()

    # Try to find main content area
    main_content = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"role": "main"})
        or soup.find("div", class_=re.compile(r"content|article|post|entry|main", re.I))
    )

    target = main_content if main_content else soup.body if soup.body else soup

    # Extract text, preserving table structure
    text_parts = []
    for element in target.descendants:
        if element.name == "table":
            text_parts.append(_table_to_text(element))
        elif element.string and element.name not in ("table", "thead", "tbody", "tr", "td", "th"):
            cleaned = element.string.strip()
            if cleaned:
                text_parts.append(cleaned)

    if not text_parts:
        text = target.get_text(separator="\n\n", strip=True)
    else:
        text = "\n\n".join(text_parts)

    text = _clean_text(text)
    page_estimate = max(1, len(text) // 3000)
    return text, page_estimate


def _table_to_text(table_tag) -> str:
    """Convert an HTML table to a readable text representation."""
    rows = []
    for tr in table_tag.find_all("tr"):
        cells = []
        for td in tr.find_all(["td", "th"]):
            cells.append(td.get_text(strip=True))
        if cells:
            rows.append(" | ".join(cells))

    if not rows:
        return ""

    header = rows[0]
    separator = " | ".join(["---"] * len(rows[0].split(" | ")))
    body = "\n".join(rows[1:]) if len(rows) > 1 else ""

    return f"{header}\n{separator}\n{body}"


def _clean_text(text: str) -> str:
    """Remove excessive whitespace and normalize text."""
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" +\n", "\n", text)
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def derive_filename_from_url(url: str) -> str:
    """Extract a human-readable filename from a URL."""
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")

    if path:
        last_segment = path.split("/")[-1]
        if last_segment and "." in last_segment:
            return last_segment[:120]
        if last_segment:
            return last_segment[:80] + ".html"

    return parsed.netloc.replace("www.", "")[:60] + ".html"


async def download_url(url: str) -> tuple[bytes, str, str]:
    """Download content from URL (static). Returns (content_bytes, content_type, final_url)."""
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=DOWNLOAD_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        verify=False,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

        if len(response.content) > MAX_DOWNLOAD_SIZE:
            raise ValueError(f"File too large: {len(response.content)} bytes (max {MAX_DOWNLOAD_SIZE})")

        content_type = response.headers.get("content-type", "")
        return response.content, content_type, str(response.url)


async def download_url_with_browser(url: str, wait_seconds: int = 15) -> tuple[bytes, str, str, str]:
    """Download a page using Playwright headless Chromium to render JavaScript.

    Used as fallback when static download returns SPA shell / garbage.
    Waits for network idle + extra seconds for JS frameworks to hydrate.
    Returns (html_bytes, content_type, final_url, inner_text).

    inner_text is extracted directly from the rendered DOM via
    document.body.innerText — this bypasses trafilatura entirely and avoids
    the problem where error JSON coexists with real content in the DOM.
    """
    from playwright.async_api import async_playwright

    logger.info(f"[Playwright] Rendering {url} with headless browser ({wait_seconds}s wait)...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1920, "height": 1080},
                locale="pt-BR",
            )
            page = await context.new_page()

            await page.goto(url, wait_until="domcontentloaded", timeout=60000)

            # Wait for networkidle (may timeout for some SPAs, that's ok)
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                logger.info("[Playwright] networkidle timeout — continuing")

            # Extra wait for SPA frameworks to finish rendering
            await page.wait_for_timeout(wait_seconds * 1000)

            # Scroll down to trigger lazy-loaded content
            await page.evaluate("""async () => {
                const delay = ms => new Promise(r => setTimeout(r, ms));
                for (let i = 0; i < 10; i++) {
                    window.scrollBy(0, window.innerHeight);
                    await delay(800);
                }
                window.scrollTo(0, 0);
            }""")
            await page.wait_for_timeout(3000)

            html_content = await page.content()
            final_url = page.url

            # Extract text directly from the rendered DOM
            inner_text = await page.evaluate("document.body.innerText")

            logger.info(
                f"[Playwright] Rendered {len(html_content)} HTML chars, "
                f"{len(inner_text)} text chars from {final_url}"
            )

            return html_content.encode("utf-8"), "text/html", final_url, inner_text
        finally:
            await browser.close()


async def process_url_document(document_id: str, url: str, filename: str) -> dict:
    """Full pipeline for URL documents: download → detect type → extract → chunk → embed."""
    sb = get_supabase()
    sb.table("documents").update({"status": "processing"}).eq("id", document_id).execute()

    try:
        content_bytes, content_type_header, final_url = await download_url(url)
        doc_type = detect_content_type(final_url, content_type_header)

        if doc_type == "pdf":
            text, page_count = extract_text_from_pdf(content_bytes)
        else:
            text, page_count = extract_text_from_html(content_bytes, final_url)

        if not text.strip():
            sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            return {"error": "No text could be extracted from the URL"}

        chunks = smart_chunk(text)

        for batch_start in range(0, len(chunks), 50):
            batch = chunks[batch_start:batch_start + 50]
            records = [{
                "document_id": document_id,
                "content": c["content"],
                "chunk_index": c["chunk_index"],
                "token_count": c["token_count"],
                "page_number": c.get("page_number"),
            } for c in batch]
            sb.table("chunks").insert(records).execute()

        generate_embeddings_for_document(document_id)

        sb.table("documents").update({
            "status": "ready",
            "chunk_count": len(chunks),
            "page_count": page_count,
        }).eq("id", document_id).execute()

        return {
            "document_id": document_id,
            "filename": filename,
            "source_type": doc_type,
            "chunks_created": len(chunks),
            "page_count": page_count,
            "status": "ready",
        }

    except Exception as e:
        sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
        raise e
