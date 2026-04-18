"""Sync extracted answers from the Itaú spreadsheet into Supabase.

Steps:
1. Match question_id from spreadsheet → esg_questions in DB
2. Update expected_answer field based on actual analyst answers
3. Load reference answers for comparison after AI analysis
"""

import json
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv(r"c:\Users\gabri\OneDrive\Área de Trabalho\ERM\backend\.env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
ANSWERS_FILE = r"c:\Users\gabri\OneDrive\Área de Trabalho\ERM\Itaú Unibanco Holding S.A. 2024_answers.json"

# Map sheet names to theme names in DB
SHEET_TO_THEME = {
    "Recursos Hídricos": "Recursos Hídricos",
    "Recursos Energéticos": "Recursos Energéticos",
    "Sistema Gestão Socioambiental": "Sistema Gestão Socioambiental",
    "Materiais básicos": "Materiais básicos",
    "Resíduos Sólidos": "Resíduos Sólidos",
    "Efluentes líquidos": "Efluentes líquidos",
    "Emissões atmosféricas": "Emissões atmosféricas",
    "Mudanças Climáticas Mitigação": "Mudanças Climáticas Mitigação",
    "Mudanças Climáticas Adaptação": "Mudanças Climáticas Adaptação",
    "Ecossistemas": "Ecossistemas",
    "Saúde e segurança": "Saúde e segurança",
    "Condições de trabalho": "Condições de trabalho",
    "Gestão de carreira": "Gestão de carreira",
    "Diversidade": "Diversidade",
    "Segurança de dados": "Segurança de dados",
    "Qualidade e segurança produtos": "Qualidade e segurança produtos",
    "Ecodesign": "Ecodesign",
    "Desenvolvimento": "Desenvolvimento",
    "Direitos Humanos": "Direitos Humanos",
    "Temas sociais na cadeia": "Temas sociais na cadeia",
    "Temas ambientais na cadeia": "Temas ambientais na cadeia",
    "Remuneração executivos": "Remuneração executivos",
    "Conselho e Diretoria": "Conselho e Diretoria",
    "Minoritários": "Minoritários",
    "Integridade": "Integridade",
    "Transparência": "Transparência",
}


def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Load extracted answers
    with open(ANSWERS_FILE, "r", encoding="utf-8") as f:
        all_answers = json.load(f)
    
    # Load themes from DB
    themes = sb.table("esg_themes").select("id, name").execute().data
    theme_map = {t["name"]: t["id"] for t in themes}
    print(f"Themes in DB: {len(theme_map)}")
    print(f"Theme names: {list(theme_map.keys())}")
    
    # Load ALL questions from DB
    questions = sb.table("esg_questions").select("id, theme_id, question_id, question_text").execute().data
    print(f"\nTotal questions in DB: {len(questions)}")
    
    # Build lookup: theme_id + question_id → question
    q_lookup = {}
    for q in questions:
        key = f"{q['theme_id']}:{q['question_id']}"
        q_lookup[key] = q
    
    # Also build by question_id only (for fallback matching)
    q_by_qid = {}
    for q in questions:
        if q["question_id"] not in q_by_qid:
            q_by_qid[q["question_id"]] = []
        q_by_qid[q["question_id"]].append(q)
    
    # Stats
    total_matched = 0
    total_unmatched = 0
    total_updated = 0
    
    # Save reference answers for later comparison
    reference_answers = []
    
    for sheet_name, answers in all_answers.items():
        if sheet_name in ("Controvérsias", "Materialidade", "Resultado"):
            continue
        
        theme_name = SHEET_TO_THEME.get(sheet_name)
        if not theme_name:
            print(f"\n⚠️  Sheet '{sheet_name}' not mapped to any theme")
            continue
        
        theme_id = theme_map.get(theme_name)
        if not theme_id:
            print(f"\n⚠️  Theme '{theme_name}' not found in DB")
            continue
        
        print(f"\n--- {sheet_name} (theme: {theme_id[:8]}...) ---")
        
        for ans in answers:
            qid = ans.get("question_id")
            answer = ans.get("answer")
            source = ans.get("source")
            
            if not qid or answer is None:
                continue
            
            # Skip section headers (like "1.1", "2.2") — only process full IDs (X.Y.Z+)
            if qid.count(".") < 2 and not qid.startswith("0."):
                continue
            
            # Normalize answer
            answer_clean = answer.strip() if answer else None
            if answer_clean not in ("Sim", "Não", "N/A"):
                continue
            
            # Try to match in DB
            key = f"{theme_id}:{qid}"
            db_q = q_lookup.get(key)
            
            if not db_q:
                # Try fallback by question_id only
                candidates = q_by_qid.get(qid, [])
                for c in candidates:
                    if c["theme_id"] == theme_id:
                        db_q = c
                        break
            
            if db_q:
                total_matched += 1
                reference_answers.append({
                    "db_question_id": db_q["id"],
                    "question_id": qid,
                    "theme_name": sheet_name,
                    "answer": answer_clean,
                    "source": source,
                })
            else:
                total_unmatched += 1
                if total_unmatched <= 10:
                    print(f"  [X] No match for {qid}: {ans.get('question_text', '')[:60]}")
    
    print(f"\n{'='*60}")
    print(f"MATCHING SUMMARY")
    print(f"{'='*60}")
    print(f"Matched: {total_matched}")
    print(f"Unmatched: {total_unmatched}")
    print(f"Reference answers: {len(reference_answers)}")
    
    # Count answer distribution
    dist = {"Sim": 0, "Não": 0, "N/A": 0}
    for ra in reference_answers:
        dist[ra["answer"]] = dist.get(ra["answer"], 0) + 1
    print(f"Distribution: {dist}")
    
    # Save reference answers
    ref_path = r"c:\Users\gabri\OneDrive\Área de Trabalho\ERM\reference_answers.json"
    with open(ref_path, "w", encoding="utf-8") as f:
        json.dump(reference_answers, f, ensure_ascii=False, indent=2)
    print(f"\nReference answers saved to: {ref_path}")
    
    # Update expected_answer in DB for Não answers (default is Sim)
    nao_answers = [ra for ra in reference_answers if ra["answer"] == "Não"]
    print(f"\nUpdating {len(nao_answers)} questions with expected_answer='Não'...")
    
    for ra in nao_answers:
        try:
            sb.table("esg_questions").update(
                {"expected_answer": "Não"}
            ).eq("id", ra["db_question_id"]).execute()
            total_updated += 1
        except Exception as e:
            print(f"  Error updating {ra['question_id']}: {e}")
    
    print(f"Updated {total_updated} questions to expected_answer='Não'")
    print("\n✅ Done!")


if __name__ == "__main__":
    main()
