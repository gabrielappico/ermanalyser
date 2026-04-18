"""Document processing pipeline: PDF parsing, text chunking, embedding, and storage in Supabase."""

import fitz  # PyMuPDF
import re
import time
import traceback
from io import BytesIO

from PIL import Image
from openai import OpenAI

from app.database import get_supabase
from app.config import get_settings


# Lazy-loaded EasyOCR reader (heavy import, loaded once per process)
_ocr_reader = None


def _get_ocr_reader():
    """Lazy-load EasyOCR reader to avoid slow startup."""
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        _ocr_reader = easyocr.Reader(["pt", "en"], gpu=False, verbose=False)
    return _ocr_reader


def _ocr_page_sync(page, dpi: int = 300) -> str:
    """Convert a PyMuPDF page to image and run OCR via EasyOCR."""
    import numpy as np
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    img = Image.open(BytesIO(img_bytes))

    reader = _get_ocr_reader()
    img_array = np.array(img)
    results = reader.readtext(img_array, detail=0, paragraph=True)
    return "\n".join(results)


def extract_text_from_pdf(pdf_bytes: bytes) -> tuple[str, int, list[dict]]:
    """Extract all text from a PDF file. Falls back to OCR for scanned PDFs.

    Returns:
        (full_text, page_count, page_texts) where page_texts is a list of
        {"page": int, "text": str} with real 1-based page numbers.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_texts: list[dict] = []

    # Standard text extraction — preserve real page numbers
    for i, page in enumerate(doc):
        text = page.get_text("text")
        if text.strip():
            page_texts.append({"page": i + 1, "text": text.strip()})

    # OCR fallback for scanned/image-based PDFs
    if not page_texts:
        print(f"  [PDF] No native text — attempting OCR on {len(doc)} pages...")
        try:
            for i, page in enumerate(doc):
                text = _ocr_page_sync(page)
                if text.strip():
                    page_texts.append({"page": i + 1, "text": text.strip()})
                print(f"  [OCR] Page {i + 1}/{len(doc)} — {'text found' if text.strip() else 'empty'}")
        except Exception as e:
            print(f"  [PDF] OCR failed: {e}")
            traceback.print_exc()

    page_count = len(doc)
    doc.close()
    full_text = "\n\n".join(pt["text"] for pt in page_texts)
    return full_text, page_count, page_texts


def smart_chunk(text: str, max_tokens: int = 500, overlap: int = 50,
                page_texts: list[dict] | None = None) -> list[dict]:
    """Split text into overlapping chunks, respecting paragraph boundaries.

    If page_texts is provided (list of {"page": int, "text": str}), each
    paragraph is tagged with its real PDF page number. Otherwise falls back
    to approximate page numbering.
    """
    # Build tagged paragraphs: list of (text, page_number)
    tagged_paragraphs: list[tuple[str, int]] = []

    if page_texts:
        # Split each page's text into paragraphs, preserving the real page number
        for pt in page_texts:
            page_num = pt["page"]
            page_paras = re.split(r'\n\s*\n', pt["text"])
            page_paras = [p.strip() for p in page_paras if p.strip()]
            # If page is one giant block, split by single newlines
            if len(page_paras) <= 1 and '\n' in pt["text"]:
                page_paras = [p.strip() for p in pt["text"].split('\n') if p.strip()]
            for para in page_paras:
                tagged_paragraphs.append((para, page_num))
    else:
        # Fallback: no page-level data (URL/HTML sources)
        paragraphs = re.split(r'\n\s*\n', text)
        paragraphs = [p.strip() for p in paragraphs if p.strip()]
        if len(paragraphs) <= 1 and '\n' in text:
            paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        if len(paragraphs) <= 1 and len(text) > max_tokens * 4:
            paragraphs = re.split(r'(?<=[.!?])\s+', text)
            paragraphs = [p.strip() for p in paragraphs if p.strip()]
        tagged_paragraphs = [(p, 0) for p in paragraphs]  # 0 = unknown page

    chunks = []
    current_chunk: list[str] = []
    current_pages: set[int] = set()
    current_tokens = 0
    chunk_index = 0

    for para, page_num in tagged_paragraphs:
        para_tokens = len(para.split())

        if current_tokens + para_tokens > max_tokens and current_chunk:
            chunk_text = "\n\n".join(current_chunk)
            # Use the first (dominant) page from this chunk
            primary_page = min(current_pages) if current_pages - {0} else 0
            chunks.append({
                "content": chunk_text,
                "chunk_index": chunk_index,
                "token_count": current_tokens,
                "page_number": primary_page if primary_page > 0 else None,
                "page_range": sorted(current_pages - {0}) or None,
            })
            chunk_index += 1

            if overlap > 0 and current_chunk:
                last = current_chunk[-1]
                current_chunk = [last]
                current_tokens = len(last.split())
                # Keep the page of the overlap paragraph
                current_pages = {page_num}
            else:
                current_chunk = []
                current_tokens = 0
                current_pages = set()

        current_chunk.append(para)
        if page_num > 0:
            current_pages.add(page_num)
        current_tokens += para_tokens

    if current_chunk:
        chunk_text = "\n\n".join(current_chunk)
        primary_page = min(current_pages) if current_pages - {0} else 0
        chunks.append({
            "content": chunk_text,
            "chunk_index": chunk_index,
            "token_count": current_tokens,
            "page_number": primary_page if primary_page > 0 else None,
            "page_range": sorted(current_pages - {0}) or None,
        })

    return chunks


def generate_embeddings_for_document(document_id: str):
    """Generate OpenAI embeddings for all chunks of a document."""
    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    sb = get_supabase()

    chunks = sb.table("chunks").select("id, content").eq(
        "document_id", document_id
    ).is_("embedding", "null").order("chunk_index").execute().data

    if not chunks:
        return

    batch_size = 20
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        texts = [c["content"][:8000] for c in batch]

        try:
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=texts,
            )
            for j, emb_data in enumerate(response.data):
                sb.table("chunks").update({
                    "embedding": emb_data.embedding,
                }).eq("id", batch[j]["id"]).execute()

        except Exception as e:
            if "429" in str(e):
                time.sleep(30)
                response = client.embeddings.create(
                    model="text-embedding-3-small",
                    input=texts,
                )
                for j, emb_data in enumerate(response.data):
                    sb.table("chunks").update({
                        "embedding": emb_data.embedding,
                    }).eq("id", batch[j]["id"]).execute()
            else:
                raise

        time.sleep(0.5)


async def process_document(document_id: str, pdf_bytes: bytes, filename: str) -> dict:
    """Full pipeline: extract text → chunk → store → generate embeddings."""
    sb = get_supabase()
    sb.table("documents").update({"status": "processing"}).eq("id", document_id).execute()

    try:
        text, page_count, page_texts = extract_text_from_pdf(pdf_bytes)
        if not text.strip():
            sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            return {"error": "No text extracted from PDF"}

        chunks = smart_chunk(text, page_texts=page_texts)

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

        # Generate embeddings for all chunks
        generate_embeddings_for_document(document_id)

        sb.table("documents").update({
            "status": "ready",
            "chunk_count": len(chunks),
            "page_count": page_count,
        }).eq("id", document_id).execute()

        return {
            "document_id": document_id,
            "filename": filename,
            "chunks_created": len(chunks),
            "page_count": page_count,
            "status": "ready",
        }

    except Exception as e:
        sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
        raise e

