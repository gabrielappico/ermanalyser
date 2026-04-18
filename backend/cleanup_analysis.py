"""Clean up all Suzano analysis data for a fresh start."""
from app.database import get_supabase

sb = get_supabase()
company_id = "dc190688-e2bf-4bb5-91f9-c79ff383fbb5"

analyses = sb.table("analyses").select("id, status").eq("company_id", company_id).execute()
for a in analyses.data:
    aid = a["id"]
    status = a["status"]
    print(f"Analysis {aid} - status: {status}")
    
    ans = sb.table("answers").delete().eq("analysis_id", aid).execute()
    ts = sb.table("theme_scores").delete().eq("analysis_id", aid).execute()
    print(f"  Deleted {len(ans.data)} answers, {len(ts.data)} theme_scores")
    
    sb.table("analyses").update({
        "status": "pending",
        "started_at": None,
        "completed_at": None,
        "overall_score": None,
        "overall_rating": None,
        "environmental_score": None,
        "social_score": None,
        "governance_score": None,
    }).eq("id", aid).execute()
    print(f"  Reset to pending")

print("Done! Ready for fresh analysis.")
