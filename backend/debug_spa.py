"""Debug SPA detection for Suzano URL."""
import asyncio, re
from app.services.url_processor import download_url, extract_text_from_html

URL = "https://centraldesustentabilidade.suzano.com.br/indicadores/?ind=consumo-de-energia-dentro-e-fora-da-organizacao-6562072b3a4e7"

async def main():
    content, ct, final_url = await download_url(URL)
    html_str = content.decode("utf-8", errors="replace")
    html_lower = html_str.lower()
    text, pages = extract_text_from_html(content, final_url)

    script_count = html_lower.count("<script")
    spa_frameworks = ["react", "vue", "angular", "nuxt", "next", "__nuxt", "data-v-", "ng-app"]
    detected = [fw for fw in spa_frameworks if fw in html_lower]
    has_table = "<table" in html_lower
    numbers = re.findall(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", text)

    print(f"Script tags: {script_count}")
    print(f"SPA frameworks detected: {detected}")
    print(f"Has <table>: {has_table}")
    print(f"Text length: {len(text)}")
    print(f"Numbers in text (br format): {len(numbers)}")
    if numbers:
        print(f"  Sample: {numbers[:5]}")

asyncio.run(main())
