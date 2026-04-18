"""Resume the ESG analysis from where it stopped."""

import sys
import os
import json
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import get_supabase
from app.services.esg_agents import (
    semantic_search, ask_agent_batch, calculate_theme_score,
    get_rating, AGENT_NAMES, _empty_answer
)

ANALYSIS_ID = "bce489aa-61ba-4126-a94f-d2f043a44ee7"
COMPANY_ID = "c4e817df-6a10-4424-8c09-7411b2ee0965"
REPORT_YEAR = 2024
SECTOR = "Financeiro"


def main():
    sb = get_supabase()
    
    # Get themes already scored
    existing_scores = sb.table("theme_scores").select("theme_id").eq(
        "analysis_id", ANALYSIS_ID
    ).execute().data
    done_theme_ids = {s["theme_id"] for s in existing_scores}
    
    print(f"Already completed: {len(done_theme_ids)} themes")
    
    # Get all themes
    themes = sb.table("esg_themes").select("*").order("display_order").execute().data
    
    # Materiality weights
    materiality = sb.table("materiality_weights").select("*").eq("sector", SECTOR).execute().data
    mat_map = {m["theme_id"]: m["weight"] for m in materiality}
    
    remaining = [t for t in themes if t["id"] not in done_theme_ids]
    print(f"Remaining: {len(remaining)} themes")
    
    dim_scores = {"environmental": [], "social": [], "governance": []}
    
    # Re-collect scores from already-done themes
    for ts in existing_scores:
        score_data = sb.table("theme_scores").select("*").eq(
            "analysis_id", ANALYSIS_ID
        ).eq("theme_id", ts["theme_id"]).execute().data
        if score_data:
            sd = score_data[0]
            # Find dimension
            theme = next((t for t in themes if t["id"] == ts["theme_id"]), None)
            if theme:
                dim_scores[theme["dimension"]].append({
                    "score": sd["raw_score"],
                    "weight": mat_map.get(ts["theme_id"], 1.0)
                })
    
    for theme in remaining:
        theme_id = theme["id"]
        dimension = theme["dimension"]
        theme_name = theme["name"]
        
        questions = sb.table("esg_questions").select("*").eq(
            "theme_id", theme_id
        ).order("display_order").execute().data
        
        if not questions:
            print(f"\n  [{theme_name}] No questions, skipping")
            continue
        
        print(f"\n  [{theme_name}] {len(questions)} questions ({dimension})")
        
        # Build search query
        search_terms = theme_name
        for q in questions[:5]:
            words = q["question_text"].split()
            key_words = [w for w in words if len(w) > 5][:3]
            search_terms += " " + " ".join(key_words)
        
        context_chunks = semantic_search(
            search_terms, COMPANY_ID, REPORT_YEAR, top_k=15
        )
        print(f"    Found {len(context_chunks)} relevant chunks")
        
        batch_size = 5
        all_agent_answers = []
        for i in range(0, len(questions), batch_size):
            batch = questions[i:i + batch_size]
            print(f"    Batch {i//batch_size + 1}/{(len(questions)-1)//batch_size + 1} ({len(batch)} questions)")
            agent_answers = ask_agent_batch(dimension, batch, context_chunks)
            all_agent_answers.extend(agent_answers)
        
        q_map = {q["question_id"]: q for q in questions}
        answer_records = []
        matched_count = 0
        
        for ans in all_agent_answers:
            q_id_str = str(ans.get("question_id", "")).strip()
            q = q_map.get(q_id_str)
            
            if not q:
                for qk, qv in q_map.items():
                    if qk.strip() == q_id_str or q_id_str in qk:
                        q = qv
                        break
            
            if not q:
                continue
            
            answer_val = ans.get("answer", "N/A")
            if answer_val in ("Nao", "nao", "NAO", "n\u00e3o"):
                answer_val = "N\u00e3o"
            elif answer_val in ("sim", "SIM"):
                answer_val = "Sim"
            elif answer_val not in ("Sim", "N\u00e3o", "N/A"):
                answer_val = "N/A"
            
            expected = q.get("expected_answer", "Sim")
            score = 10.0 if answer_val == expected else 0.0
            if answer_val == "N/A":
                score = 0.0
            
            record = {
                "analysis_id": ANALYSIS_ID,
                "question_id": q["id"],
                "answer": answer_val,
                "justification": str(ans.get("justification", ""))[:500],
                "source_reference": str(ans.get("source_reference", ""))[:200] if ans.get("source_reference") else None,
                "improvement_points": str(ans.get("improvement_points", ""))[:300] if ans.get("improvement_points") else None,
                "confidence_score": min(max(float(ans.get("confidence_score", 0)), 0), 1),
                "agent_name": AGENT_NAMES.get(dimension, "Agente ESG"),
                "score": score,
                "weighted_score": score,
            }
            answer_records.append(record)
            matched_count += 1
        
        print(f"    Matched {matched_count}/{len(all_agent_answers)} answers")
        
        if answer_records:
            for batch_start in range(0, len(answer_records), 50):
                batch = answer_records[batch_start:batch_start + 50]
                sb.table("answers").upsert(batch, on_conflict="analysis_id,question_id").execute()
        
        theme_score = calculate_theme_score(all_agent_answers, questions)
        theme_rating = get_rating(theme_score)
        print(f"    Score: {theme_score:.2f} ({theme_rating})")
        
        mat_weight = mat_map.get(theme_id, 1.0)
        
        sb.table("theme_scores").upsert({
            "analysis_id": ANALYSIS_ID,
            "theme_id": theme_id,
            "raw_score": theme_score,
            "weighted_score": theme_score * mat_weight,
            "rating": theme_rating,
        }, on_conflict="analysis_id,theme_id").execute()
        
        dim_scores[dimension].append({
            "score": theme_score,
            "weight": mat_weight,
        })
    
    # Calculate final scores
    final_scores = {}
    for dim, scores in dim_scores.items():
        if scores:
            total_weight = sum(s["weight"] for s in scores)
            if total_weight > 0:
                final_scores[dim] = sum(s["score"] * s["weight"] for s in scores) / total_weight
            else:
                final_scores[dim] = 0
        else:
            final_scores[dim] = 0
    
    overall = (
        final_scores.get("environmental", 0) * 0.35
        + final_scores.get("social", 0) * 0.30
        + final_scores.get("governance", 0) * 0.35
    )
    
    sb.table("analyses").update({
        "status": "completed",
        "overall_score": round(overall, 2),
        "overall_rating": get_rating(overall),
        "environmental_score": round(final_scores.get("environmental", 0), 2),
        "social_score": round(final_scores.get("social", 0), 2),
        "governance_score": round(final_scores.get("governance", 0), 2),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", ANALYSIS_ID).execute()
    
    print("\n" + "=" * 60)
    print("FINAL RESULTS")
    print("=" * 60)
    print(f"Overall Score: {overall:.2f} ({get_rating(overall)})")
    print(f"Environmental: {final_scores.get('environmental', 0):.2f}")
    print(f"Social:        {final_scores.get('social', 0):.2f}")
    print(f"Governance:    {final_scores.get('governance', 0):.2f}")
    
    # Run comparison
    compare_with_reference()


def compare_with_reference():
    sb = get_supabase()
    ref_path = r"c:\Users\gabri\OneDrive\Area de Trabalho\ERM\reference_answers.json"
    
    # Try alternative paths
    for p in [ref_path, 
              r"c:\Users\gabri\OneDrive\Área de Trabalho\ERM\reference_answers.json"]:
        if os.path.exists(p):
            ref_path = p
            break
    
    if not os.path.exists(ref_path):
        print(f"\nReference file not found: {ref_path}")
        return
    
    with open(ref_path, "r", encoding="utf-8") as f:
        reference = json.load(f)
    
    ai_answers = sb.table("answers").select(
        "question_id, answer, confidence_score"
    ).eq("analysis_id", ANALYSIS_ID).execute().data
    
    ai_map = {a["question_id"]: a for a in ai_answers}
    
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
            if len(mismatches) < 30:
                mismatches.append({
                    "qid": ref["question_id"],
                    "theme": ref["theme_name"],
                    "expected": ref_answer,
                    "got": ai["answer"],
                    "conf": ai.get("confidence_score", 0),
                })
    
    total = match_count + mismatch_count
    accuracy = (match_count / total * 100) if total > 0 else 0
    
    print("\n" + "=" * 60)
    print("COMPARISON WITH ANALYST REFERENCE")
    print("=" * 60)
    print(f"Total reference: {len(reference)}")
    print(f"N/A skipped: {na_skip}")
    print(f"Not in AI: {not_found}")
    print(f"Compared: {total}")
    print(f"Matches: {match_count}")
    print(f"Mismatches: {mismatch_count}")
    print(f"\n*** ACCURACY: {accuracy:.1f}% ***")
    
    if mismatches:
        print(f"\nMismatches ({len(mismatches)}):")
        for m in mismatches:
            print(f"  {m['theme'][:25]:25s} {m['qid']:10s} exp={m['expected']:3s} got={m['got']:3s} conf={m['conf']:.2f}")
    
    # Reference scores
    print("\n  REFERENCE: Env=8.53(A) Soc=7.97(B) Gov=8.22(A) Overall=8.24(A)")


if __name__ == "__main__":
    main()
