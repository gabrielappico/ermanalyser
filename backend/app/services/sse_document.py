"""SSE-powered document processing — streams progress events during upload pipeline.

Stages:
  1. upload      → file received
  2. parsing     → extracting text from PDF
  3. chunking    → splitting into chunks
  4. storing     → saving chunks to DB
  5. embedding   → generating OpenAI embeddings (batch by batch)
  6. complete    → document ready
"""

import json
import asyncio
import traceback
from typing import AsyncGenerator
from io import BytesIO

import fitz  # PyMuPDF
from PIL import Image
from openai import OpenAI

from app.database import get_supabase
from app.config import get_settings
from app.services.document_processor import smart_chunk

# Lazy-loaded EasyOCR reader (heavy import, loaded once)
_ocr_reader = None


def _get_ocr_reader():
    """Lazy-load EasyOCR reader to avoid slow startup."""
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        _ocr_reader = easyocr.Reader(["pt", "en"], gpu=False, verbose=False)
    return _ocr_reader


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _ocr_page(page, dpi: int = 300) -> str:
    """Convert a PyMuPDF page to image and run OCR via EasyOCR."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    img = Image.open(BytesIO(img_bytes))

    reader = _get_ocr_reader()
    import numpy as np
    img_array = np.array(img)
    results = reader.readtext(img_array, detail=0, paragraph=True)
    return "\n".join(results)


def _parse_pdf_sync(pdf_bytes: bytes) -> tuple[list[str], int]:
    """CPU-bound PDF parsing — runs in a thread to avoid blocking the event loop.

    Falls back to OCR (via EasyOCR) for scanned/image-based PDFs.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(doc)
    pages_text = []

    # Pass 1: standard text extraction
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages_text.append(text.strip())

    # Pass 2: OCR fallback for scanned/image-based PDFs
    if not pages_text:
        print(f"  [PDF] No native text found in {page_count} pages — attempting OCR...")
        try:
            for i, page in enumerate(doc):
                text = _ocr_page(page)
                if text.strip():
                    pages_text.append(text.strip())
                print(f"  [OCR] Page {i + 1}/{page_count} — {'text found' if text.strip() else 'empty'}")
        except Exception as e:
            print(f"  [PDF] OCR fallback failed: {e}")
            traceback.print_exc()

    doc.close()
    return pages_text, page_count


def _generate_embeddings_sync(texts: list[str], api_key: str) -> list[list[float]]:
    """IO-bound embedding call — runs in a thread."""
    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts,
    )
    return [emb_data.embedding for emb_data in response.data]


async def process_document_with_sse(
    document_id: str,
    pdf_bytes: bytes,
    filename: str,
) -> AsyncGenerator[str, None]:
    """Process a PDF document, yielding SSE events at each stage."""
    sb = get_supabase()
    settings = get_settings()

    try:
        await asyncio.to_thread(
            lambda: sb.table("documents").update({"status": "processing"}).eq("id", document_id).execute()
        )
    except Exception as e:
        print(f"  [SSE] Warning: status update failed: {e}")

    yield _sse("stage:start", {
        "stage": "parsing",
        "label": "Extraindo texto do PDF...",
        "filename": filename,
        "document_id": document_id,
    })
    await asyncio.sleep(0.05)

    try:
        # ── Stage 1: Parse PDF (offloaded to thread) ────────────
        pages_text, page_count = await asyncio.to_thread(_parse_pdf_sync, pdf_bytes)

        # Emit page-by-page progress after parsing (fast)
        for i in range(page_count):
            if i % 5 == 0 or i == page_count - 1:
                yield _sse("parsing:progress", {
                    "current_page": i + 1,
                    "total_pages": page_count,
                    "percentage": round((i + 1) / page_count * 100, 1),
                })
                await asyncio.sleep(0.01)

        full_text = "\n\n".join(pages_text)

        if not full_text.strip():
            await asyncio.to_thread(
                lambda: sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            )
            yield _sse("processing:error", {"error": "Nenhum texto extraído do PDF."})
            return

        yield _sse("stage:complete", {
            "stage": "parsing",
            "pages": page_count,
            "text_length": len(full_text),
        })
        await asyncio.sleep(0.05)

        # ── Stage 2: Chunk ──────────────────────────────────────
        yield _sse("stage:start", {
            "stage": "chunking",
            "label": "Dividindo texto em chunks...",
        })
        await asyncio.sleep(0.05)

        chunks = await asyncio.to_thread(smart_chunk, full_text)

        yield _sse("stage:complete", {
            "stage": "chunking",
            "total_chunks": len(chunks),
            "avg_tokens": round(sum(c["token_count"] for c in chunks) / max(len(chunks), 1)),
        })
        await asyncio.sleep(0.05)

        # ── Stage 3: Store chunks in DB ─────────────────────────
        yield _sse("stage:start", {
            "stage": "storing",
            "label": "Salvando chunks no banco...",
            "total_chunks": len(chunks),
        })
        await asyncio.sleep(0.05)

        chunk_ids = []
        for batch_start in range(0, len(chunks), 50):
            batch = chunks[batch_start:batch_start + 50]
            records = [{
                "document_id": document_id,
                "content": c["content"],
                "chunk_index": c["chunk_index"],
                "token_count": c["token_count"],
                "page_number": c.get("page_number"),
            } for c in batch]

            result = await asyncio.to_thread(
                lambda recs=records: sb.table("chunks").insert(recs).execute()
            )
            chunk_ids.extend([r["id"] for r in result.data])

            yield _sse("storing:progress", {
                "stored": min(batch_start + len(batch), len(chunks)),
                "total": len(chunks),
                "percentage": round(min(batch_start + len(batch), len(chunks)) / len(chunks) * 100, 1),
            })
            await asyncio.sleep(0.02)

        yield _sse("stage:complete", {
            "stage": "storing",
            "total_stored": len(chunk_ids),
        })
        await asyncio.sleep(0.05)

        # ── Stage 4: Generate embeddings ────────────────────────
        yield _sse("stage:start", {
            "stage": "embedding",
            "label": "Gerando embeddings com OpenAI...",
            "total_chunks": len(chunk_ids),
        })
        await asyncio.sleep(0.05)

        db_chunks = await asyncio.to_thread(
            lambda: sb.table("chunks").select("id, content").eq(
                "document_id", document_id
            ).is_("embedding", "null").order("chunk_index").execute().data
        )

        batch_size = 20
        embedded_count = 0
        total_to_embed = len(db_chunks)

        for i in range(0, total_to_embed, batch_size):
            batch = db_chunks[i:i + batch_size]
            texts = [c["content"][:8000] for c in batch]
            batch_num = i // batch_size + 1
            total_batches = (total_to_embed - 1) // batch_size + 1

            try:
                embeddings = await asyncio.to_thread(
                    _generate_embeddings_sync, texts, settings.openai_api_key
                )
                for j, embedding in enumerate(embeddings):
                    chunk_id = batch[j]["id"]
                    await asyncio.to_thread(
                        lambda cid=chunk_id, emb=embedding: sb.table("chunks").update({
                            "embedding": emb,
                        }).eq("id", cid).execute()
                    )

                embedded_count += len(batch)

            except Exception as e:
                if "429" in str(e):
                    yield _sse("embedding:rate_limit", {
                        "message": "Rate limit atingido. Aguardando 30s...",
                        "batch": batch_num,
                    })
                    await asyncio.sleep(30)

                    embeddings = await asyncio.to_thread(
                        _generate_embeddings_sync, texts, settings.openai_api_key
                    )
                    for j, embedding in enumerate(embeddings):
                        chunk_id = batch[j]["id"]
                        await asyncio.to_thread(
                            lambda cid=chunk_id, emb=embedding: sb.table("chunks").update({
                                "embedding": emb,
                            }).eq("id", cid).execute()
                        )
                    embedded_count += len(batch)
                else:
                    raise

            yield _sse("embedding:progress", {
                "embedded": embedded_count,
                "total": total_to_embed,
                "percentage": round(embedded_count / max(total_to_embed, 1) * 100, 1),
                "batch": batch_num,
                "total_batches": total_batches,
            })
            await asyncio.sleep(0.3)

        yield _sse("stage:complete", {
            "stage": "embedding",
            "total_embedded": embedded_count,
        })
        await asyncio.sleep(0.05)

        # ── Finalize ────────────────────────────────────────────
        print(f"  [SSE] Finalizing document {document_id}...")
        try:
            await asyncio.to_thread(
                lambda: sb.table("documents").update({
                    "status": "ready",
                    "chunk_count": len(chunks),
                    "page_count": page_count,
                }).eq("id", document_id).execute()
            )
            print(f"  [SSE] Document {document_id} marked as ready")
        except Exception as fin_err:
            print(f"  [SSE] Warning: Failed to update document status: {fin_err}")
            # Non-fatal — the processing itself succeeded

        yield _sse("processing:complete", {
            "document_id": document_id,
            "filename": filename,
            "page_count": page_count,
            "chunk_count": len(chunks),
            "embedded_count": embedded_count,
            "status": "ready",
        })

    except Exception as e:
        print(f"  [SSE] ERROR processing {document_id}: {e}")
        traceback.print_exc()
        try:
            await asyncio.to_thread(
                lambda: sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            )
        except Exception:
            pass
        yield _sse("processing:error", {
            "error": str(e),
            "document_id": document_id,
        })
