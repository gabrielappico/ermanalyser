"""SSE-powered URL document processing — streams progress events during the URL ingestion pipeline.

Stages:
  1. downloading  → fetching content from URL
  2. parsing      → extracting text from HTML/PDF
  3. chunking     → splitting into chunks
  4. storing      → saving chunks to DB
  5. embedding    → generating OpenAI embeddings (batch by batch)
  6. complete     → document ready
"""

import json
import asyncio
import logging
from typing import AsyncGenerator

from openai import OpenAI

from app.database import get_supabase
from app.config import get_settings
from app.services.document_processor import extract_text_from_pdf, smart_chunk
from app.services.url_processor import (
    download_url,
    download_url_with_browser,
    detect_content_type,
    extract_text_from_html,
    _is_spa_garbage,
    _clean_text,
)

logger = logging.getLogger(__name__)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def process_url_with_sse(
    document_id: str,
    url: str,
    filename: str,
) -> AsyncGenerator[str, None]:
    """Process a URL document, yielding SSE events at each stage."""
    sb = get_supabase()
    settings = get_settings()

    sb.table("documents").update({"status": "processing"}).eq("id", document_id).execute()

    yield _sse("stage:start", {
        "stage": "downloading",
        "label": f"Baixando conteúdo de {url[:80]}...",
        "filename": filename,
        "url": url,
        "document_id": document_id,
    })
    await asyncio.sleep(0.1)

    try:
        # ── Stage 1: Download URL ──────────────────────────────────
        content_bytes, content_type_header, final_url = await download_url(url)
        doc_type = detect_content_type(final_url, content_type_header)

        yield _sse("stage:complete", {
            "stage": "downloading",
            "size_bytes": len(content_bytes),
            "content_type": doc_type,
            "final_url": final_url,
        })
        await asyncio.sleep(0.1)

        # ── Stage 2: Parse content ────────────────────────────────
        yield _sse("stage:start", {
            "stage": "parsing",
            "label": f"Extraindo texto ({doc_type.upper()})...",
        })
        await asyncio.sleep(0.1)

        if doc_type == "pdf":
            text, page_count = extract_text_from_pdf(content_bytes)
        else:
            text, page_count = extract_text_from_html(content_bytes, final_url)

            # Check if static extraction returned SPA garbage
            html_str = content_bytes.decode("utf-8", errors="replace")
            if _is_spa_garbage(text, html_str):
                logger.info(f"[SSE-URL] Static extraction returned SPA garbage for {url}, falling back to Playwright")
                yield _sse("stage:start", {
                    "stage": "downloading",
                    "label": "🔄 Página dinâmica detectada — renderizando com navegador...",
                })
                await asyncio.sleep(0.1)

                try:
                    browser_bytes, _, browser_url, inner_text = await download_url_with_browser(url)

                    # Use innerText directly from the browser DOM — bypasses trafilatura
                    # which would pick up garbage JSON coexisting with real content
                    if inner_text and len(inner_text.strip()) > 500:
                        text = _clean_text(inner_text)
                        page_count = max(1, len(text) // 3000)
                        logger.info(f"[SSE-URL] Playwright innerText: {len(text)} chars, {page_count} pages")
                    else:
                        # Fallback to HTML extraction if innerText is too short
                        text, page_count = extract_text_from_html(browser_bytes, browser_url)

                    yield _sse("stage:complete", {
                        "stage": "downloading",
                        "size_bytes": len(browser_bytes),
                        "content_type": "html (rendered)",
                        "final_url": browser_url,
                    })
                    await asyncio.sleep(0.1)
                except Exception as e:
                    logger.warning(f"[SSE-URL] Playwright fallback failed: {e}")
                    # Keep the static text as-is, it's better than nothing

        if not text.strip():
            sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            yield _sse("processing:error", {"error": "Nenhum texto extraído da URL."})
            return

        yield _sse("stage:complete", {
            "stage": "parsing",
            "pages": page_count,
            "text_length": len(text),
            "source_type": doc_type,
        })
        await asyncio.sleep(0.1)

        # Update source_type in DB based on what was actually detected
        sb.table("documents").update({"source_type": doc_type}).eq("id", document_id).execute()

        # ── Stage 3: Chunk ──────────────────────────────────────
        yield _sse("stage:start", {
            "stage": "chunking",
            "label": "Dividindo texto em chunks...",
        })
        await asyncio.sleep(0.1)

        chunks = smart_chunk(text)

        yield _sse("stage:complete", {
            "stage": "chunking",
            "total_chunks": len(chunks),
            "avg_tokens": round(sum(c["token_count"] for c in chunks) / max(len(chunks), 1)),
        })
        await asyncio.sleep(0.1)

        # ── Stage 4: Store chunks in DB ─────────────────────────
        yield _sse("stage:start", {
            "stage": "storing",
            "label": "Salvando chunks no banco...",
            "total_chunks": len(chunks),
        })
        await asyncio.sleep(0.1)

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
            result = sb.table("chunks").insert(records).execute()
            chunk_ids.extend([r["id"] for r in result.data])

            yield _sse("storing:progress", {
                "stored": min(batch_start + len(batch), len(chunks)),
                "total": len(chunks),
                "percentage": round(min(batch_start + len(batch), len(chunks)) / len(chunks) * 100, 1),
            })
            await asyncio.sleep(0.05)

        yield _sse("stage:complete", {
            "stage": "storing",
            "total_stored": len(chunk_ids),
        })
        await asyncio.sleep(0.1)

        # ── Stage 5: Generate embeddings ────────────────────────
        yield _sse("stage:start", {
            "stage": "embedding",
            "label": "Gerando embeddings com OpenAI...",
            "total_chunks": len(chunk_ids),
        })
        await asyncio.sleep(0.1)

        client = OpenAI(api_key=settings.openai_api_key)
        db_chunks = sb.table("chunks").select("id, content").eq(
            "document_id", document_id
        ).is_("embedding", "null").order("chunk_index").execute().data

        batch_size = 20
        embedded_count = 0
        total_to_embed = len(db_chunks)

        for i in range(0, total_to_embed, batch_size):
            batch = db_chunks[i:i + batch_size]
            texts = [c["content"][:8000] for c in batch]
            batch_num = i // batch_size + 1
            total_batches = (total_to_embed - 1) // batch_size + 1

            try:
                response = client.embeddings.create(
                    model="text-embedding-3-small",
                    input=texts,
                )
                for j, emb_data in enumerate(response.data):
                    sb.table("chunks").update({
                        "embedding": emb_data.embedding,
                    }).eq("id", batch[j]["id"]).execute()

                embedded_count += len(batch)

            except Exception as e:
                if "429" in str(e):
                    yield _sse("embedding:rate_limit", {
                        "message": "Rate limit atingido. Aguardando 30s...",
                        "batch": batch_num,
                    })
                    await asyncio.sleep(30)

                    response = client.embeddings.create(
                        model="text-embedding-3-small",
                        input=texts,
                    )
                    for j, emb_data in enumerate(response.data):
                        sb.table("chunks").update({
                            "embedding": emb_data.embedding,
                        }).eq("id", batch[j]["id"]).execute()
                    embedded_count += len(batch)
                else:
                    raise

            yield _sse("embedding:progress", {
                "embedded": embedded_count,
                "total": total_to_embed,
                "percentage": round(embedded_count / total_to_embed * 100, 1),
                "batch": batch_num,
                "total_batches": total_batches,
            })
            await asyncio.sleep(0.5)

        yield _sse("stage:complete", {
            "stage": "embedding",
            "total_embedded": embedded_count,
        })
        await asyncio.sleep(0.1)

        # ── Finalize ────────────────────────────────────────────
        sb.table("documents").update({
            "status": "ready",
            "chunk_count": len(chunks),
            "page_count": page_count,
        }).eq("id", document_id).execute()

        yield _sse("processing:complete", {
            "document_id": document_id,
            "filename": filename,
            "source_url": url,
            "source_type": doc_type,
            "page_count": page_count,
            "chunk_count": len(chunks),
            "embedded_count": embedded_count,
            "status": "ready",
        })

    except Exception as e:
        sb.table("documents").update({"status": "error"}).eq("id", document_id).execute()

        error_msg = str(e)
        # Provide user-friendly messages for common connection errors
        error_lower = error_msg.lower()
        if "connect" in error_lower or "timeout" in error_lower or "name resolution" in error_lower:
            error_msg = f"Não foi possível acessar a URL (falha de conexão após 3 tentativas). Verifique se a URL está acessível e tente novamente. Detalhe: {error_msg}"
        elif "403" in error_msg or "forbidden" in error_lower:
            error_msg = "Acesso negado pelo servidor (403 Forbidden). O site pode estar bloqueando acessos automatizados."
        elif "404" in error_msg:
            error_msg = "Página não encontrada (404). Verifique se a URL está correta."

        yield _sse("processing:error", {
            "error": error_msg,
            "document_id": document_id,
        })
