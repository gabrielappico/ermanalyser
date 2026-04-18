from app.database import get_supabase
sb = get_supabase()
docs = sb.table("documents").select(
    "id, filename, source_url, source_type, status, chunk_count, page_count"
).order("created_at", desc=True).limit(5).execute()

for d in docs.data:
    fn = d["filename"] or "?"
    url = d.get("source_url") or "N/A"
    print(f"Filename: {fn}")
    print(f"  URL:    {url}")
    print(f"  Type:   {d['source_type']} | Status: {d['status']} | Chunks: {d['chunk_count']} | Pages: {d['page_count']}")
    print()
