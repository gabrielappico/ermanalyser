"""Quick diagnostic script to check analysis status."""
from app.database import get_supabase

sb = get_supabase()

# Get all analyses
analyses = sb.table("analyses").select(
    "id, status, company_id, report_year, started_at, completed_at, overall_score"
).order("created_at", desc=True).limit(5).execute()

print("=== ANALYSES ===")
for a in analyses.data:
    print(f"  ID: {a['id'][:12]}...")
    print(f"  Status: {a['status']}")
    print(f"  Year: {a['report_year']}")
    print(f"  Score: {a.get('overall_score')}")
    print(f"  Started: {a.get('started_at')}")
    print(f"  Completed: {a.get('completed_at')}")
    
    # Check answers count
    ans = sb.table("answers").select("id", count="exact").eq("analysis_id", a["id"]).execute()
    print(f"  Answers: {ans.count}")
    print()

# Check if there are any questions
qs = sb.table("esg_questions").select("id", count="exact").execute()
print(f"=== Total ESG questions in DB: {qs.count}")

# Check themes
themes = sb.table("esg_themes").select("id", count="exact").execute()
print(f"=== Total ESG themes in DB: {themes.count}")

# Check documents
docs = sb.table("documents").select("id, status, company_id, report_year, filename").eq("status", "ready").execute()
print(f"\n=== Ready documents: {len(docs.data)}")
for d in docs.data:
    print(f"  {d['filename']} (year={d['report_year']}, company={d['company_id'][:8]}...)")

# Check if OpenAI key works
from app.config import get_settings
settings = get_settings()
print(f"\n=== OpenAI key set: {bool(settings.openai_api_key)}")
print(f"=== OpenAI model: {settings.openai_model}")
print(f"=== Supabase URL: {settings.supabase_url[:30]}...")
