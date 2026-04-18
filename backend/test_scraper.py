# -*- coding: utf-8 -*-
"""Final scraper test with encoding fix."""
import asyncio
import sys
import io

# Force UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.services.ri_scraper import discover_documents

async def main():
    url = "https://ir.suzano.com.br/English/The-Company/Bylaws-Codes-Policies-and-Regiments/default.aspx"
    print(f"Testing: {url}\n")
    docs = await discover_documents(url)
    pdfs = [d for d in docs if d["file_type"] == "pdf"]
    print(f"\nTotal: {len(docs)} docs, {len(pdfs)} PDFs\n")
    for i, d in enumerate(docs[:25], 1):
        marker = "PDF" if d["file_type"] == "pdf" else "   "
        name = d['name'][:80]
        print(f"  [{marker}] score={d['relevance_score']:2d}  {name}")
        if d["file_type"] == "pdf":
            print(f"       {d['url'][:130]}")

if __name__ == "__main__":
    asyncio.run(main())
