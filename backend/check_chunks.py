from app.database import get_supabase

sb = get_supabase()
docs = sb.table("documents").select(
    "id, filename, source_type, source_url, status, chunk_count, page_count"
).order("created_at", desc=True).limit(10).execute()

print(f"{'Filename':60s} | {'Type':5s} | {'Status':10s} | Chunks | Pages")
print("-" * 110)
for d in docs.data:
    fn = (d["filename"] or "?")[:60]
    src = d["source_type"] or "?"
    st = d["status"] or "?"
    ch = d["chunk_count"] or 0
    pg = d["page_count"] or 0
    print(f"{fn:60s} | {src:5s} | {st:10s} | {ch:6d} | {pg:5d}")

# For the most recent URL doc, show chunk content lengths
url_docs = [d for d in docs.data if d.get("source_type") == "url" or d.get("source_url")]
if url_docs:
    latest = url_docs[0]
    print(f"\n--- Chunks do documento URL mais recente: {latest['filename']} ---")
    chunks = sb.table("chunks").select(
        "id, chunk_index, token_count, content"
    ).eq("document_id", latest["id"]).order("chunk_index").execute()
    for c in chunks.data:
        preview = c["content"][:120].replace("\n", " ")
        print(f"  Chunk {c['chunk_index']:3d} | {c['token_count']:5d} tokens | {preview}...")
    print(f"\n  Total: {len(chunks.data)} chunks")
