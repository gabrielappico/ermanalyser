"""Run the full ESG analysis for Itau directly, then compare with reference answers."""

import sys
import os
import json
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import get_supabase
from app.services.esg_agents import run_full_analysis, get_rating

COMPANY_ID = "c4e817df-6a10-4424-8c09-7411b2ee0965"
REPORT_YEAR = 2024
SECTOR = "Financeiro"


def main():
    sb = get_supabase()
    
    # 1. Create analysis record
    print("=" * 60)
    print("ERM ESG ANALYZER - Full E2E Test")
    print("=" * 60)
    print(f"Company: Itau Unibanco (ITUB4)")
    print(f"Year: {REPORT_YEAR}")
    print(f"Sector: {SECTOR}")
    print(f"Start: {datetime.now()}")
    print("=" * 60)
    
    analysis_record = sb.table("analyses").insert({
        "company_id": COMPANY_ID,
        "report_year": REPORT_YEAR,
        "status": "running",
    }).execute()
    
    analysis_id = analysis_record.data[0]["id"]
    print(f"\nAnalysis ID: {analysis_id}")
    print("\nStarting analysis (this will take several minutes)...\n")
    
    # 2. Run analysis
    try:
        run_full_analysis(analysis_id, COMPANY_ID, REPORT_YEAR, SECTOR)
        print("\n\nAnalysis completed!")
    except Exception as e:
        print(f"\nAnalysis FAILED: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # 3. Get results
    analysis = sb.table("analyses").select("*").eq("id", analysis_id).execute().data[0]
    
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Overall Score: {analysis.get('overall_score', 0):.2f} ({analysis.get('overall_rating', 'N/A')})")
    print(f"Environmental: {analysis.get('environmental_score', 0):.2f}")
    print(f"Social:        {analysis.get('social_score', 0):.2f}")
    print(f"Governance:    {analysis.get('governance_score', 0):.2f}")
    print(f"Status:        {analysis.get('status')}")
    
    # 4. Compare with reference
    ref_path = r"c:\Users\gabri\OneDrive\Área de Trabalho\ERM\reference_answers.json"
    if os.path.exists(ref_path):
        print("\n" + "=" * 60)
        print("COMPARISON WITH REFERENCE (Analyst Spreadsheet)")
        print("=" * 60)
        
        with open(ref_path, "r", encoding="utf-8") as f:
            reference = json.load(f)
        
        # Get all AI answers
        ai_answers = sb.table("answers").select(
            "question_id, answer, confidence_score"
        ).eq("analysis_id", analysis_id).execute().data
        
        # Build AI answer map: question_id (UUID) -> answer
        ai_map = {a["question_id"]: a for a in ai_answers}
        
        # Compare
        match_count = 0
        mismatch_count = 0
        na_skip = 0
        not_found = 0
        mismatches = []
        
        for ref in reference:
            ref_answer = ref["answer"]
            db_qid = ref["db_question_id"]
            
            if ref_answer == "N/A":
                na_skip += 1
                continue
            
            ai = ai_map.get(db_qid)
            if not ai:
                not_found += 1
                continue
            
            if ai["answer"] == ref_answer:
                match_count += 1
            else:
                mismatch_count += 1
                if len(mismatches) < 20:
                    mismatches.append({
                        "question_id": ref["question_id"],
                        "theme": ref["theme_name"],
                        "expected": ref_answer,
                        "got": ai["answer"],
                        "confidence": ai.get("confidence_score", 0),
                    })
        
        total_compared = match_count + mismatch_count
        accuracy = (match_count / total_compared * 100) if total_compared > 0 else 0
        
        print(f"\nTotal reference answers: {len(reference)}")
        print(f"N/A skipped: {na_skip}")
        print(f"Not found in AI: {not_found}")
        print(f"Compared: {total_compared}")
        print(f"Matches: {match_count}")
        print(f"Mismatches: {mismatch_count}")
        print(f"\n*** ACCURACY: {accuracy:.1f}% ***")
        
        if mismatches:
            print(f"\nSample mismatches (first {len(mismatches)}):")
            for m in mismatches:
                print(f"  {m['theme']}/{m['question_id']}: expected={m['expected']}, got={m['got']} (conf={m['confidence']:.2f})")
        
        # Reference scores from spreadsheet
        print("\n" + "=" * 60)
        print("REFERENCE SCORES (from analyst spreadsheet)")
        print("=" * 60)
        print(f"Environmental: 8.53 (A)")
        print(f"Social:        7.97 (B)")
        print(f"Governance:    8.22 (A)")
        print(f"Overall:       8.24 (A)")
        print(f"\nAI vs Reference delta:")
        print(f"  Environmental: {abs(analysis.get('environmental_score', 0) - 8.53):.2f}")
        print(f"  Social:        {abs(analysis.get('social_score', 0) - 7.97):.2f}")
        print(f"  Governance:    {abs(analysis.get('governance_score', 0) - 8.22):.2f}")
        print(f"  Overall:       {abs(analysis.get('overall_score', 0) - 8.24):.2f}")
    
    print(f"\n\nDone! Completed at {datetime.now()}")


if __name__ == "__main__":
    main()
