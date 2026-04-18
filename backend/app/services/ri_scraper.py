"""Auto-discovery of ESG documents from company IR (Investor Relations) pages.

Crawls a given IR page URL, extracts all PDF and relevant document links,
and returns them as candidates for processing. Works generically for any
Brazilian listed company's IR website.
"""

import re
import logging
from urllib.parse import urljoin, urlparse, unquote
import httpx

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Keywords that indicate ESG-relevant documents (Portuguese + English)
_ESG_KEYWORDS = [
    # Sustainability
    "sustentabilidade", "sustainability", "esg", "relatorio", "relat\u00f3rio",
    # Policies
    "politica", "pol\u00edtica", "policy", "codigo", "c\u00f3digo", "code",
    # Governance
    "governanca", "governan\u00e7a", "governance", "estatuto", "bylaws",
    "conselho", "board", "diretoria",
    # Compliance
    "etica", "\u00e9tica", "ethics", "conduta", "conduct", "compliance",
    "integridade", "integrity", "anticorrup",
    # Social
    "diversidade", "diversity", "direitos humanos", "human rights",
    "saude", "sa\u00fade", "seguranca", "seguran\u00e7a", "safety",
    "fornecedor", "supplier", "cadeia",
    # Environmental
    "ambiental", "environmental", "clima", "climate", "emiss",
    "residuo", "res\u00edduo", "waste", "hidric", "h\u00eddric", "water",
    "energia", "energy", "biodiversidade",
    # Reports
    "fre", "formulario", "formul\u00e1rio", "anual", "annual",
    "integrado", "integrated", "indicador", "cvm",
    "inventario", "invent\u00e1rio", "ghg", "gee",
]

# File extensions to look for
_DOCUMENT_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".docx"]

# URL path patterns that indicate document download sections
_IR_SECTION_PATTERNS = [
    "download", "documento", "publicac", "arquivo", "relatorio",
    "politica", "codigo", "sustainability", "esg", "governan",
]


def _is_document_url(url: str) -> bool:
    """Check if URL points to a downloadable document."""
    path_lower = url.lower().split("?")[0]
    return any(path_lower.endswith(ext) for ext in _DOCUMENT_EXTENSIONS)


def _is_esg_relevant(text: str, url: str) -> bool:
    """Check if a link's text or URL contains ESG-relevant keywords."""
    combined = (text + " " + unquote(url)).lower()
    return any(kw in combined for kw in _ESG_KEYWORDS)


def _extract_doc_name(url: str, link_text: str) -> str:
    """Extract a clean document name from URL or link text."""
    # Prefer link text if it's descriptive enough
    if link_text and len(link_text.strip()) > 5 and len(link_text.strip()) < 200:
        name = link_text.strip()
        # Remove common suffixes
        name = re.sub(r'\s*\(?\d+\s*(kb|mb|gb)\)?$', '', name, flags=re.IGNORECASE)
        name = re.sub(r'\s*-\s*download$', '', name, flags=re.IGNORECASE)
        return name.strip()

    # Fallback to filename from URL
    path = urlparse(url).path
    filename = path.split("/")[-1] if path else ""
    filename = unquote(filename)
    # Remove extension for display name
    name = re.sub(r'\.(pdf|xlsx|docx)$', '', filename, flags=re.IGNORECASE)
    # Replace separators with spaces
    name = name.replace("-", " ").replace("_", " ")
    return name.strip() or "Documento"


async def discover_documents(page_url: str, use_browser: bool = True) -> list[dict]:
    """Crawl an IR page and discover all downloadable ESG-related documents.

    Args:
        page_url: URL of the IR/sustainability downloads page
        use_browser: Whether to use Playwright for JS-rendered pages (recommended)

    Returns:
        List of dicts with keys: url, name, file_type, relevance_score
    """
    logger.info(f"[RI Scraper] Discovering documents from: {page_url}")
    print(f"[RI Scraper] Starting discovery: {page_url}")

    html_content = ""

    if use_browser:
        try:
            print("[RI Scraper] Attempting Playwright browser fetch...")
            html_content = await _fetch_with_browser(page_url)
            print(f"[RI Scraper] Browser fetch OK: {len(html_content)} chars")
        except Exception as e:
            print(f"[RI Scraper] Browser fetch failed: {e}")
            logger.warning(f"[RI Scraper] Browser fetch failed: {e}, trying static")
            try:
                html_content = await _fetch_static(page_url)
                print(f"[RI Scraper] Static fetch OK: {len(html_content)} chars")
            except Exception as e2:
                print(f"[RI Scraper] Static fetch also failed: {e2}")
                logger.error(f"[RI Scraper] Both fetch methods failed: {e2}")
                return []
    else:
        try:
            html_content = await _fetch_static(page_url)
        except Exception as e:
            print(f"[RI Scraper] Static fetch failed: {e}")
            return []

    if not html_content or len(html_content) < 100:
        print(f"[RI Scraper] No useful HTML content retrieved ({len(html_content)} chars)")
        return []

    # Parse HTML and extract links
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_content, "lxml")

    base_url = page_url
    # Check for <base> tag
    base_tag = soup.find("base", href=True)
    if base_tag:
        base_url = base_tag["href"]

    candidates = []
    seen_urls = set()

    def _add_candidate(url: str, text: str):
        """Helper to add a candidate document."""
        normalized = url.split("#")[0].rstrip("/")
        if normalized in seen_urls:
            return
        seen_urls.add(normalized)

        is_doc = _is_document_url(url)
        is_relevant = _is_esg_relevant(text, url)

        if not is_doc and not is_relevant:
            return

        score = 0
        combined_text = (text + " " + unquote(url)).lower()
        for kw in _ESG_KEYWORDS:
            if kw in combined_text:
                score += 1
        if url.lower().split("?")[0].endswith(".pdf"):
            score += 3

        url_lower = url.lower().split("?")[0]
        if url_lower.endswith(".pdf"):
            file_type = "pdf"
        elif any(url_lower.endswith(ext) for ext in [".xlsx", ".xls"]):
            file_type = "excel"
        elif url_lower.endswith(".docx"):
            file_type = "word"
        else:
            file_type = "html"

        doc_name = _extract_doc_name(url, text)
        candidates.append({
            "url": url,
            "name": doc_name,
            "file_type": file_type,
            "relevance_score": score,
            "link_text": text[:200] if text else "",
        })

    # 1. Standard <a href> links
    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        full_url = urljoin(base_url, href)
        link_text = link.get_text(strip=True)
        _add_candidate(full_url, link_text)

    # 2. PDF URLs in onclick, data-href, data-url, data-src attributes
    for tag in soup.find_all(True):
        for attr_name in ["onclick", "data-href", "data-url", "data-src", "data-file", "data-download"]:
            attr_val = tag.get(attr_name, "")
            if not attr_val:
                continue
            # Find PDF URLs in attribute values
            pdf_urls = re.findall(r'(https?://[^\s\'"<>]+\.pdf[^\s\'"<>]*)', str(attr_val), re.IGNORECASE)
            for pdf_url in pdf_urls:
                text = tag.get_text(strip=True) or ""
                _add_candidate(pdf_url, text)

    # 3. Iframes that might embed documents
    for iframe in soup.find_all("iframe", src=True):
        src = iframe["src"].strip()
        if src and (".pdf" in src.lower() or "document" in src.lower()):
            full_url = urljoin(base_url, src)
            _add_candidate(full_url, "Embedded Document")

    # 4. Raw PDF URLs in the HTML source (catches JS variables, API responses, etc.)
    raw_pdf_urls = re.findall(
        r'(https?://[^\s\'"<>\\]+\.pdf(?:\?[^\s\'"<>\\]*)?)',
        html_content,
        re.IGNORECASE,
    )
    for pdf_url in raw_pdf_urls:
        # Clean up escaped characters
        pdf_url = pdf_url.replace("\\/", "/").replace("\\u002F", "/")
        _add_candidate(pdf_url, "")

    # Sort by relevance (highest first)
    candidates.sort(key=lambda x: x["relevance_score"], reverse=True)

    print(f"[RI Scraper] Found {len(candidates)} document candidates ({sum(1 for c in candidates if c['file_type'] == 'pdf')} PDFs)")
    logger.info(f"[RI Scraper] Found {len(candidates)} document candidates")
    return candidates


async def _fetch_static(url: str) -> str:
    """Fetch page HTML via httpx (no JS rendering)."""
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30,
        headers={"User-Agent": USER_AGENT},
        verify=False,
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


async def _fetch_with_browser(url: str) -> str:
    """Fetch page HTML using Playwright (renders JavaScript).
    
    Also intercepts network requests to find PDF download URLs
    that aren't in the DOM.
    """
    from playwright.async_api import async_playwright

    logger.info(f"[RI Scraper] Using Playwright for: {url}")
    intercepted_urls = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1920, "height": 1080},
                locale="pt-BR",
                accept_downloads=True,
            )
            page = await context.new_page()

            # Intercept network requests for document URLs
            def on_response(response):
                resp_url = response.url.lower()
                if any(resp_url.endswith(ext) or f"{ext}?" in resp_url 
                       for ext in [".pdf", ".xlsx", ".xls", ".docx"]):
                    intercepted_urls.append(response.url)
                # Also check for API responses that might contain PDF URLs
                content_type = response.headers.get("content-type", "")
                if "json" in content_type or "javascript" in content_type:
                    try:
                        # Will be captured via raw HTML regex
                        pass
                    except Exception:
                        pass

            page.on("response", on_response)

            await page.goto(url, wait_until="domcontentloaded", timeout=60000)

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass

            # Wait for dynamic content
            await page.wait_for_timeout(3000)

            # Try to click on common expandable elements to reveal hidden PDFs
            try:
                # Click tabs, accordions, "see more" buttons
                expandable_selectors = [
                    "button:has-text('Ver')", "button:has-text('Download')",
                    "button:has-text('Todos')", "button:has-text('All')",
                    ".accordion-header", ".tab-link", ".expand",
                    "[data-toggle]", "[role='tab']",
                    "a:has-text('Ver mais')", "a:has-text('See more')",
                ]
                for selector in expandable_selectors:
                    try:
                        elements = await page.query_selector_all(selector)
                        for el in elements[:5]:  # Max 5 clicks per selector
                            try:
                                await el.click(timeout=2000)
                                await page.wait_for_timeout(500)
                            except Exception:
                                continue
                    except Exception:
                        continue
            except Exception:
                pass

            # Scroll to load lazy content
            await page.evaluate("""async () => {
                for (let i = 0; i < 10; i++) {
                    window.scrollBy(0, window.innerHeight);
                    await new Promise(r => setTimeout(r, 500));
                }
                window.scrollTo(0, 0);
            }""")
            await page.wait_for_timeout(2000)

            html = await page.content()

            # Inject intercepted URLs into HTML as hidden links for the parser to find
            if intercepted_urls:
                print(f"[RI Scraper] Intercepted {len(intercepted_urls)} document URLs from network")
                extra_links = "\n".join(
                    f'<a href="{u}" class="intercepted-doc">{u.split("/")[-1]}</a>'
                    for u in intercepted_urls
                )
                html += f"\n<!-- Intercepted document URLs -->\n<div>{extra_links}</div>"

            return html
        finally:
            await browser.close()

