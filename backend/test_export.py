"""Quick test of the Excel export pipeline."""
import asyncio
from app.services.excel_exporter import export_analysis_to_excel
from app.database import get_supabase

def main():
    sb = get_supabase()
    analyses = sb.table("analyses").select("id, status, company_id").eq("status", "completed").limit(1).execute()
    if not analyses.data:
        print("No completed analyses found")
        return

    a = analyses.data[0]
    aid = a["id"]
    print(f"Analysis found: {aid}")

    try:
        result = asyncio.run(export_analysis_to_excel(aid))
        print(f"Export OK: {result}")
    except Exception as e:
        import traceback
        print(f"ERROR: {type(e).__name__}: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()
