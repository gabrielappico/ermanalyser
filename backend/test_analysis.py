"""Quick test: try the first API call to see what error occurs."""
from app.database import get_supabase
from app.services.esg_agents import semantic_search, ask_agent_batch
from app.config import get_settings

sb = get_supabase()

# The stuck analysis
analysis_id = "99476fdc-486"  # partial, get full
analysis = sb.table("analyses").select("*").eq("status", "running").limit(1).execute()
if not analysis.data:
    print("No running analysis found")
    exit()

a = analysis.data[0]
print(f"Analysis: {a['id']}")
print(f"Company: {a['company_id']}")
print(f"Year: {a['report_year']}")

# Check if company has documents for this year
docs = sb.table("documents").select("id, filename, status").eq(
    "company_id", a["company_id"]
).eq("report_year", a["report_year"]).execute()

print(f"\nDocuments for company + year:")
for d in docs.data:
    print(f"  {d['filename']} - status: {d['status']}")

ready_docs = [d for d in docs.data if d["status"] == "ready"]
if not ready_docs:
    print("\n!!! NO READY DOCUMENTS for this company + year !!!")
    print("This is likely why the analysis is stuck.")
    exit()

# Try to get first theme + questions
themes = sb.table("esg_themes").select("*").order("display_order").limit(1).execute()
if themes.data:
    theme = themes.data[0]
    print(f"\nFirst theme: {theme['name']} ({theme['dimension']})")
    
    questions = sb.table("esg_questions").select("*").eq(
        "theme_id", theme["id"]
    ).order("display_order").limit(2).execute()
    
    if questions.data:
        print(f"First questions ({len(questions.data)}):")
        for q in questions.data:
            print(f"  {q['question_id']}: {q['question_text'][:80]}")
        
        # Try semantic search
        print("\nTrying semantic search...")
        try:
            chunks = semantic_search(theme["name"], a["company_id"], a["report_year"], top_k=5)
            print(f"  Found {len(chunks)} chunks")
            if chunks:
                print(f"  First chunk preview: {chunks[0]['content'][:100]}...")
        except Exception as e:
            print(f"  SEARCH ERROR: {e}")
        
        # Try asking the agent
        print("\nTrying agent batch (1 question only)...")
        try:
            result = ask_agent_batch(theme["dimension"], [questions.data[0]], chunks[:5] if chunks else [])
            print(f"  Agent result: {result}")
        except Exception as e:
            print(f"  AGENT ERROR: {e}")
