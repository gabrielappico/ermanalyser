"""Background analysis runner — fully decoupled from SSE.

The analysis runs in an independent asyncio.Task stored in ACTIVE_ANALYSES.
Progress is saved to DB (answers, theme_scores) as it goes.
SSE endpoints just subscribe to progress — if the client disconnects mid-stream,
the analysis keeps running. When the client reconnects, it catches up from DB.
"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Optional

from app.database import get_supabase
from app.services.esg_agents import (
    semantic_search, ask_agent_batch, calculate_theme_score,
    get_rating, AGENT_NAMES, _empty_answer,
)

# ─── Global registry of running analyses ──────────────────────────────────────
# Maps analysis_id → asyncio.Task
ACTIVE_ANALYSES: dict[str, asyncio.Task] = {}


def is_analysis_running(analysis_id: str) -> bool:
    """Check if an analysis task is actively running."""
    task = ACTIVE_ANALYSES.get(analysis_id)
    return task is not None and not task.done()


def cancel_analysis_task(analysis_id: str) -> bool:
    """Cancel a running analysis task."""
    task = ACTIVE_ANALYSES.get(analysis_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


async def start_analysis_background(
    analysis_id: str,
    company_id: str,
    report_year: int,
    sector: str,
) -> None:
    """Launch the analysis as a background task (fire-and-forget)."""
    # If already running, don't start again
    if is_analysis_running(analysis_id):
        print(f"  [Runner] Analysis {analysis_id[:8]} already running, skipping")
        return

    task = asyncio.create_task(
        _run_analysis(analysis_id, company_id, report_year, sector),
        name=f"analysis-{analysis_id[:8]}",
    )
    ACTIVE_ANALYSES[analysis_id] = task

    # Cleanup when done
    def _cleanup(t: asyncio.Task):
        ACTIVE_ANALYSES.pop(analysis_id, None)
    task.add_done_callback(_cleanup)


async def _run_analysis(
    analysis_id: str,
    company_id: str,
    report_year: int,
    sector: str,
) -> None:
    """Core analysis loop — runs independently of any SSE connection."""
    sb = get_supabase()

    try:
        await asyncio.to_thread(
            lambda: sb.table("analyses").update({
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", analysis_id).execute()
        )

        themes = (await asyncio.to_thread(
            lambda: sb.table("esg_themes").select("*").order("display_order").execute()
        )).data
        materiality = (await asyncio.to_thread(
            lambda: sb.table("materiality_weights").select("*").eq("sector", sector).execute()
        )).data
        mat_map = {m["theme_id"]: m["weight"] for m in materiality}

        dim_scores: dict[str, list] = {"environmental": [], "social": [], "governance": []}

        for theme in themes:
            theme_id = theme["id"]
            dimension = theme["dimension"]
            theme_name = theme["name"]

            questions = (await asyncio.to_thread(
                lambda tid=theme_id: sb.table("esg_questions").select("*").eq(
                    "theme_id", tid
                ).order("display_order").execute()
            )).data

            if not questions:
                continue

            print(f"\n  [{theme_name}] {len(questions)} questions ({dimension})")

            # Check which questions already have answers (for resuming)
            existing_answers = (await asyncio.to_thread(
                lambda tid=theme_id: sb.table("answers").select("question_id").eq(
                    "analysis_id", analysis_id
                ).execute()
            )).data
            existing_q_ids = {a["question_id"] for a in existing_answers}
            remaining_questions = [q for q in questions if q["id"] not in existing_q_ids]

            if not remaining_questions:
                print(f"    All {len(questions)} questions already answered, skipping")
                continue
            elif len(remaining_questions) < len(questions):
                already = len(questions) - len(remaining_questions)
                print(f"    {already} already answered, processing {len(remaining_questions)} remaining")
                questions = remaining_questions

            # Semantic search
            search_terms = theme_name
            for q in questions[:5]:
                words = q["question_text"].split()
                key_words = [w for w in words if len(w) > 5][:3]
                search_terms += " " + " ".join(key_words)

            context_chunks = await asyncio.to_thread(
                semantic_search, search_terms, company_id, report_year, 20
            )

            # Process in batches
            batch_size = 5
            seen_question_ids = set()
            theme_answers = []

            for i in range(0, len(questions), batch_size):
                batch = questions[i:i + batch_size]
                agent_answers = await asyncio.to_thread(
                    ask_agent_batch, dimension, batch, context_chunks
                )

                saved = 0
                for ans, batch_q in zip(agent_answers, batch):
                    q = batch_q
                    if q["id"] in seen_question_ids:
                        continue
                    seen_question_ids.add(q["id"])

                    answer_val = ans.get("answer", "N/A")
                    if answer_val in ("Nao", "nao", "NAO", "não"):
                        answer_val = "Não"
                    elif answer_val in ("sim", "SIM"):
                        answer_val = "Sim"
                    elif answer_val not in ("Sim", "Não", "N/A"):
                        answer_val = "N/A"

                    expected = q.get("expected_answer", "Sim")
                    score = 10.0 if answer_val == expected else 0.0
                    if answer_val == "N/A":
                        score = 0.0

                    record = {
                        "analysis_id": analysis_id,
                        "question_id": q["id"],
                        "answer": answer_val,
                        "justification": str(ans.get("justification", ""))[:800],
                        "source_reference": str(ans.get("source_reference", ""))[:200] if ans.get("source_reference") else None,
                        "improvement_points": str(ans.get("improvement_points", ""))[:300] if ans.get("improvement_points") else None,
                        "confidence_score": min(max(float(ans.get("confidence_score", 0)), 0), 1),
                        "agent_name": AGENT_NAMES.get(dimension, "Agente ESG"),
                        "score": score,
                        "weighted_score": score,
                    }

                    try:
                        await asyncio.to_thread(
                            lambda r=record: sb.table("answers").insert(r).execute()
                        )
                    except Exception as insert_err:
                        err_str = str(insert_err)
                        if "duplicate" in err_str.lower() or "unique" in err_str.lower():
                            pass  # Already exists, skip silently
                        else:
                            print(f"    ⚠️ Failed to insert answer for {q['question_id']}: {err_str[:120]}")

                    theme_answers.append({"question_id": q["question_id"], "answer": answer_val})
                    saved += 1

                print(f"    Batch {i//batch_size + 1}: {saved}/{len(batch)} answers saved")
                # Brief pause between batches to avoid rate limits
                await asyncio.sleep(0.5)

            # Calculate and store theme score
            theme_score = calculate_theme_score(theme_answers, questions)
            theme_rating = get_rating(theme_score)
            mat_weight = mat_map.get(theme_id, 1.0)

            try:
                await asyncio.to_thread(
                    lambda: sb.table("theme_scores").insert({
                        "analysis_id": analysis_id,
                        "theme_id": theme_id,
                        "raw_score": theme_score,
                        "weighted_score": theme_score * mat_weight,
                        "rating": theme_rating,
                    }).execute()
                )
            except Exception as ts_err:
                print(f"    ⚠️ Failed to insert theme score for {theme_name}: {ts_err}")

            dim_scores[dimension].append({
                "score": theme_score,
                "weight": mat_weight,
            })

            print(f"    Score: {theme_score:.2f} ({theme_rating})")

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

        await asyncio.to_thread(
            lambda: sb.table("analyses").update({
                "status": "completed",
                "overall_score": round(overall, 2),
                "overall_rating": get_rating(overall),
                "environmental_score": round(final_scores.get("environmental", 0), 2),
                "social_score": round(final_scores.get("social", 0), 2),
                "governance_score": round(final_scores.get("governance", 0), 2),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", analysis_id).execute()
        )

        print(f"\n  ✅ Analysis {analysis_id[:8]} completed! Overall: {overall:.2f}")

    except asyncio.CancelledError:
        print(f"  [Runner] Analysis {analysis_id[:8]} cancelled")
        try:
            await asyncio.to_thread(
                lambda: sb.table("analyses").update({
                    "status": "cancelled",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", analysis_id).execute()
            )
        except Exception:
            pass

    except Exception as e:
        import traceback
        print(f"\n  ❌ Analysis {analysis_id[:8]} error: {e}")
        traceback.print_exc()
        try:
            await asyncio.to_thread(
                lambda: sb.table("analyses").update({
                    "status": "error",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", analysis_id).execute()
            )
        except Exception:
            pass
