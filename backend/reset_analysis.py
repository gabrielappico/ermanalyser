"""Reset the stuck analysis to allow re-running."""
from app.database import get_supabase

sb = get_supabase()

analysis = sb.table("analyses").select("id, status").eq("status", "running").execute()
if not analysis.data:
    print("No stuck analyses found")
else:
    for a in analysis.data:
        print(f"Resetting analysis {a['id']} from 'running' to 'error'")
        sb.table("analyses").update({"status": "error"}).eq("id", a["id"]).execute()
    print("Done! You can now restart the analysis from the UI.")
