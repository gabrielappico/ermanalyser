"""Quick test: Supabase connection via anon key."""
from app.database import get_supabase

sb = get_supabase()
r = sb.table("companies").select("*").execute()
print(f"Connection OK, companies: {len(r.data)}")

r2 = sb.table("esg_themes").select("id, name").limit(3).execute()
print(f"Themes: {len(r2.data)}")
for t in r2.data:
    print(f"  - {t['name']}")

r3 = sb.table("esg_questions").select("id", count="exact").execute()
print(f"Questions: {r3.count}")
print("\nAll good!")
