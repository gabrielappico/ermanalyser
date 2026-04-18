"""Documents API router — upload, list, process, and stream progress via SSE.

Supports:
  - PDF file upload (classic)
  - URL-based ingestion (HTML pages, PDF URLs)
  - Auto-discovery from IR (Investor Relations) pages
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.database import get_supabase
from app.services.document_processor import process_document
from app.services.sse_document import process_document_with_sse
from app.services.url_processor import (
    process_url_document,
    derive_filename_from_url,
    download_url,
    detect_content_type,
    extract_text_from_html,
)
from app.services.sse_url_document import process_url_with_sse
from app.services.ri_scraper import discover_documents

router = APIRouter()


class AddUrlRequest(BaseModel):
    company_id: str
    report_year: int
    url: str
    custom_name: str | None = None


class DiscoverRequest(BaseModel):
    page_url: str
    use_browser: bool = True


class BatchUrlItem(BaseModel):
    url: str
    name: str
    file_type: str = "pdf"


class BatchAddUrlsRequest(BaseModel):
    company_id: str
    report_year: int
    documents: list[BatchUrlItem]


@router.get("/")
async def list_documents(company_id: str | None = None, report_year: int | None = None):
    sb = get_supabase()
    query = sb.table("documents").select("*, companies(name)")
    if company_id:
        query = query.eq("company_id", company_id)
    if report_year:
        query = query.eq("report_year", report_year)
    result = query.order("created_at", desc=True).execute()
    return result.data


@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    company_id: str = Form(...),
    report_year: int = Form(...),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    pdf_bytes = await file.read()
    sb = get_supabase()

    # Replace existing document if same company + filename
    existing = sb.table("documents").select("id").eq(
        "company_id", company_id
    ).eq("filename", file.filename).execute()
    if existing.data:
        old_id = existing.data[0]["id"]
        sb.table("chunks").delete().eq("document_id", old_id).execute()
        sb.table("documents").delete().eq("id", old_id).execute()

    doc_record = sb.table("documents").insert({
        "company_id": company_id,
        "filename": file.filename,
        "report_year": report_year,
        "source_type": "pdf",
        "status": "processing",
    }).execute()

    doc = doc_record.data[0]
    background_tasks.add_task(process_document, doc["id"], pdf_bytes, file.filename)

    return {
        "id": doc["id"],
        "filename": file.filename,
        "report_year": report_year,
        "status": "processing",
        "message": "Document uploaded. Processing started in background.",
    }


@router.post("/add-url")
async def add_url_document(request: AddUrlRequest, background_tasks: BackgroundTasks):
    """Add a document from a URL (HTML page or PDF link)."""
    sb = get_supabase()

    filename = request.custom_name or derive_filename_from_url(request.url)

    # Replace existing document if same company + filename
    existing = sb.table("documents").select("id").eq(
        "company_id", request.company_id
    ).eq("filename", filename).execute()
    if existing.data:
        old_id = existing.data[0]["id"]
        sb.table("chunks").delete().eq("document_id", old_id).execute()
        sb.table("documents").delete().eq("id", old_id).execute()

    doc_record = sb.table("documents").insert({
        "company_id": request.company_id,
        "filename": filename,
        "report_year": request.report_year,
        "source_type": "url",
        "source_url": request.url,
        "status": "processing",
    }).execute()

    doc = doc_record.data[0]
    background_tasks.add_task(process_url_document, doc["id"], request.url, filename)

    return {
        "id": doc["id"],
        "filename": filename,
        "source_url": request.url,
        "report_year": request.report_year,
        "status": "processing",
        "message": "URL document added. Processing started in background.",
    }


@router.post("/add-url-stream")
async def add_url_document_stream(request: AddUrlRequest):
    """Add and process a URL document with SSE progress streaming."""
    sb = get_supabase()

    filename = request.custom_name or derive_filename_from_url(request.url)

    # Replace existing document if same company + filename
    existing = sb.table("documents").select("id").eq(
        "company_id", request.company_id
    ).eq("filename", filename).execute()
    if existing.data:
        old_id = existing.data[0]["id"]
        sb.table("chunks").delete().eq("document_id", old_id).execute()
        sb.table("documents").delete().eq("id", old_id).execute()

    doc_record = sb.table("documents").insert({
        "company_id": request.company_id,
        "filename": filename,
        "report_year": request.report_year,
        "source_type": "url",
        "source_url": request.url,
        "status": "processing",
    }).execute()

    doc = doc_record.data[0]

    return StreamingResponse(
        process_url_with_sse(doc["id"], request.url, filename),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{document_id}")
async def get_document(document_id: str):
    sb = get_supabase()
    result = sb.table("documents").select("*, companies(name)").eq("id", document_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found")
    return result.data


@router.get("/{document_id}/chunks")
async def list_document_chunks(document_id: str):
    sb = get_supabase()
    result = sb.table("chunks").select("id, content, chunk_index, token_count, page_number").eq(
        "document_id", document_id
    ).order("chunk_index").execute()
    return result.data


@router.delete("/{document_id}")
async def delete_document(document_id: str):
    sb = get_supabase()
    sb.table("documents").delete().eq("id", document_id).execute()
    return {"status": "deleted"}


@router.post("/upload-stream")
async def upload_document_stream(
    file: UploadFile = File(...),
    company_id: str = Form(...),
    report_year: int = Form(...),
):
    """Upload and process a document with SSE progress streaming."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        pdf_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {e}")

    sb = get_supabase()

    # Check if a document with the same company_id + filename already exists
    existing = sb.table("documents").select("id").eq(
        "company_id", company_id
    ).eq("filename", file.filename).execute()

    if existing.data:
        old_id = existing.data[0]["id"]
        print(f"  [upload-stream] Replacing existing doc {old_id} for '{file.filename}'")
        # Delete old chunks first, then the document record
        sb.table("chunks").delete().eq("document_id", old_id).execute()
        sb.table("documents").delete().eq("id", old_id).execute()

    try:
        doc_record = sb.table("documents").insert({
            "company_id": company_id,
            "filename": file.filename,
            "report_year": report_year,
            "source_type": "pdf",
            "status": "processing",
        }).execute()
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create document record: {e}")

    doc = doc_record.data[0]
    print(f"  [upload-stream] Created doc {doc['id']} for '{file.filename}' ({len(pdf_bytes)/1024/1024:.1f} MB)")

    return StreamingResponse(
        process_document_with_sse(doc["id"], pdf_bytes, file.filename),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/discover-documents")
async def discover_ir_documents(request: DiscoverRequest):
    """Crawl an IR page and return discovered ESG document links."""
    try:
        candidates = await discover_documents(
            page_url=request.page_url,
            use_browser=request.use_browser,
        )
        return {
            "page_url": request.page_url,
            "total_found": len(candidates),
            "documents": candidates,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to crawl page: {str(e)}")


@router.post("/batch-add-urls")
async def batch_add_url_documents(request: BatchAddUrlsRequest, background_tasks: BackgroundTasks):
    """Add multiple documents from discovered URLs in one batch."""
    sb = get_supabase()
    added = []

    for doc_item in request.documents:
        filename = doc_item.name or derive_filename_from_url(doc_item.url)
        # Add extension if missing
        if doc_item.file_type == "pdf" and not filename.lower().endswith(".pdf"):
            filename += ".pdf"

        # Skip duplicates
        existing = sb.table("documents").select("id").eq(
            "company_id", request.company_id
        ).eq("filename", filename).execute()
        if existing.data:
            old_id = existing.data[0]["id"]
            sb.table("chunks").delete().eq("document_id", old_id).execute()
            sb.table("documents").delete().eq("id", old_id).execute()

        doc_record = sb.table("documents").insert({
            "company_id": request.company_id,
            "filename": filename,
            "report_year": request.report_year,
            "source_type": "url",
            "source_url": doc_item.url,
            "status": "processing",
        }).execute()

        doc = doc_record.data[0]
        background_tasks.add_task(process_url_document, doc["id"], doc_item.url, filename)

        added.append({
            "id": doc["id"],
            "filename": filename,
            "source_url": doc_item.url,
            "status": "processing",
        })

    return {
        "total_added": len(added),
        "documents": added,
    }

