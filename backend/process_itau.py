"""Process the Itau ESG 2024 PDF directly (bypassing HTTP upload for large files)."""

import asyncio
import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import get_supabase
from app.services.document_processor import process_document

COMPANY_ID = "c4e817df-6a10-4424-8c09-7411b2ee0965"
REPORT_YEAR = 2024
PDF_PATH = r"C:\Users\gabri\OneDrive\Área de Trabalho\ERM\Relatório ESG 2024 - Itaú.pdf"


async def main():
    sb = get_supabase()

    # Check if document already exists
    existing = sb.table("documents").select("id, status, chunk_count").eq(
        "company_id", COMPANY_ID
    ).eq("report_year", REPORT_YEAR).execute()

    if existing.data:
        doc = existing.data[0]
        print(f"Document already exists: {doc['id']} (status: {doc['status']}, chunks: {doc['chunk_count']})")
        if doc["status"] == "ready":
            print("Already processed! No need to re-process.")
            return
        print("Re-processing...")
        doc_id = doc["id"]
        # Clear old chunks
        sb.table("chunks").delete().eq("document_id", doc_id).execute()
    else:
        # Create document record first
        doc_record = sb.table("documents").insert({
            "company_id": COMPANY_ID,
            "filename": "Relatório ESG 2024 - Itaú.pdf",
            "report_year": REPORT_YEAR,
            "source_type": "pdf",
            "status": "processing",
        }).execute()
        doc_id = doc_record.data[0]["id"]
        print(f"Document record created: {doc_id}")

    # Read the PDF
    print(f"Reading PDF from: {PDF_PATH}")
    file_size = os.path.getsize(PDF_PATH)
    print(f"File size: {file_size / (1024*1024):.1f} MB")

    with open(PDF_PATH, "rb") as f:
        pdf_bytes = f.read()

    print("Processing document (extracting text + chunking + storing)...")
    result = await process_document(doc_id, pdf_bytes, "Relatório ESG 2024 - Itaú.pdf")
    print(f"\nResult: {result}")
    print("\nDone! You can now run the ESG analysis on Itaú.")


if __name__ == "__main__":
    asyncio.run(main())
