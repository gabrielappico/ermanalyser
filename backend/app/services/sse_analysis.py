"""SSE subscriber for ESG analysis progress — reads from DB, never runs analysis.

The actual analysis runs in analysis_runner.py (background task).
This module provides two SSE generators:
  1. subscribe_analysis_sse() — polls DB for new answers and streams them to the client.
     If the client disconnects and reconnects, it picks up where it left off.
  2. replay_analysis_sse() — replays a completed analysis from DB.

Yields Server-Sent Events:
  - analysis:start     → analysis initiated
  - dimension:start    → starting a new dimension
  - theme:start        → starting a new theme
  - question:answered  → single question answered
  - theme:complete     → theme score calculated
  - analysis:complete  → final scores
  - analysis:error     → error occurred
"""

import json
import asyncio
from typing import AsyncGenerator

from app.database import get_supabase


def _sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event string."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


SSE_KEEPALIVE = ": keepalive\n\n"

# Poll interval for checking new answers in DB
POLL_INTERVAL_SECONDS = 2.0


async def subscribe_analysis_sse(
    analysis_id: str,
    last_seen_count: int = 0,
) -> AsyncGenerator[str, None]:
    """Subscribe to a running analysis — polls DB for new answers and streams them.

    This is completely decoupled from the analysis process.
    If the client disconnects and reconnects with last_seen_count,
    it picks up exactly where it left off.
    """
    sb = get_supabase()

    # Load analysis info
    analysis = (await asyncio.to_thread(
        lambda: sb.table("analyses").select(
            "*, companies(name, ticker, sector)"
        ).eq("id", analysis_id).single().execute()
    )).data

    if not analysis:
        yield _sse_event("analysis:error", {"error": "Analysis not found"})
        return

    # Load structural data
    themes = (await asyncio.to_thread(
        lambda: sb.table("esg_themes").select("*").order("display_order").execute()
    )).data
    all_questions = (await asyncio.to_thread(
        lambda: sb.table("esg_questions").select("*").order("display_order").execute()
    )).data

    # Build lookups
    theme_map = {t["id"]: t for t in themes}
    question_map = {q["id"]: q for q in all_questions}
    theme_questions: dict[str, list] = {}
    for q in all_questions:
        tid = q["theme_id"]
        if tid not in theme_questions:
            theme_questions[tid] = []
        theme_questions[tid].append(q)

    total_questions = sum(len(qs) for qs in theme_questions.values())

    # Emit start event
    yield _sse_event("analysis:start", {
        "analysis_id": analysis_id,
        "company_name": analysis.get("companies", {}).get("name", ""),
        "report_year": analysis.get("report_year"),
        "total_themes": len(themes),
        "total_questions": total_questions,
    })
    await asyncio.sleep(0.1)

    # Track what we've already sent
    sent_answer_ids: set[str] = set()
    sent_themes: set[str] = set()
    sent_dimensions: set[str] = set()
    last_keepalive = 0
    answered_count = last_seen_count

    # If reconnecting, load already-sent answers to skip them
    if last_seen_count > 0:
        existing = (await asyncio.to_thread(
            lambda: sb.table("answers").select("id, question_id").eq(
                "analysis_id", analysis_id
            ).limit(last_seen_count).execute()
        )).data
        sent_answer_ids = {a["id"] for a in existing}

    # Main poll loop — keep checking DB for new answers
    stale_count = 0
    max_stale = 450  # 450 polls * 2s = 15 minutes without progress = give up

    while True:
        # Check analysis status + heartbeat
        status_row = (await asyncio.to_thread(
            lambda: sb.table("analyses").select("status, heartbeat_at").eq("id", analysis_id).single().execute()
        )).data

        if not status_row:
            yield _sse_event("analysis:error", {"error": "Analysis not found"})
            return

        current_status = status_row["status"]

        # If the runner sent a recent heartbeat, it's alive — reset stale counter
        heartbeat_at = status_row.get("heartbeat_at")
        if heartbeat_at and stale_count > 0:
            from datetime import datetime, timezone
            try:
                hb_time = datetime.fromisoformat(heartbeat_at.replace("Z", "+00:00"))
                age_seconds = (datetime.now(timezone.utc) - hb_time).total_seconds()
                if age_seconds < 600:  # Heartbeat within last 10 minutes
                    stale_count = 0  # Runner is alive, just processing LLM batch
            except Exception:
                pass

        # Fetch new answers since last check
        new_answers = (await asyncio.to_thread(
            lambda: sb.table("answers").select(
                "id, question_id, answer, confidence_score, justification, source_reference"
            ).eq("analysis_id", analysis_id).order("created_at").execute()
        )).data

        # Determine which are new
        new_unsent = [a for a in new_answers if a["id"] not in sent_answer_ids]

        if new_unsent:
            stale_count = 0  # Reset stale counter

            for answer in new_unsent:
                sent_answer_ids.add(answer["id"])
                answered_count += 1

                q = question_map.get(answer["question_id"])
                if not q:
                    continue

                theme = theme_map.get(q["theme_id"])
                if not theme:
                    continue

                dimension = theme["dimension"]
                theme_id = theme["id"]

                # Emit dimension:start if needed
                if dimension not in sent_dimensions:
                    sent_dimensions.add(dimension)
                    yield _sse_event("dimension:start", {
                        "dimension": dimension,
                        "label": {
                            "environmental": "Ambiental",
                            "social": "Social",
                            "governance": "Governança",
                        }[dimension],
                    })
                    await asyncio.sleep(0.05)

                # Emit theme:start if needed
                if theme_id not in sent_themes:
                    sent_themes.add(theme_id)
                    yield _sse_event("theme:start", {
                        "theme_id": theme_id,
                        "theme_name": theme["name"],
                        "theme_number": theme.get("theme_number", 0),
                        "dimension": dimension,
                        "question_count": len(theme_questions.get(theme_id, [])),
                    })
                    await asyncio.sleep(0.05)

                # Emit question
                q_text = q.get("question_text", "")
                q_id = q.get("question_id", "")
                if q_text.startswith(q_id):
                    q_text = q_text[len(q_id):].lstrip(" .")

                yield _sse_event("question:answered", {
                    "question_id": q_id,
                    "question_text": q_text[:120],
                    "answer": answer["answer"],
                    "confidence_score": answer.get("confidence_score", 0),
                    "justification": (answer.get("justification") or "")[:200],
                    "source_reference": answer.get("source_reference"),
                    "theme_name": theme["name"],
                    "dimension": dimension,
                    "answered_count": answered_count,
                    "total_questions": total_questions,
                })
                await asyncio.sleep(0.15)  # Visual pacing

            # Check for completed themes
            theme_scores = (await asyncio.to_thread(
                lambda: sb.table("theme_scores").select("*").eq("analysis_id", analysis_id).execute()
            )).data

            for ts in theme_scores:
                tid = ts["theme_id"]
                if tid in sent_themes:
                    theme = theme_map.get(tid)
                    if theme:
                        yield _sse_event("theme:complete", {
                            "theme_id": tid,
                            "theme_name": theme["name"],
                            "dimension": theme["dimension"],
                            "raw_score": ts.get("raw_score", 0),
                            "rating": ts.get("rating", "?"),
                            "answered_count": answered_count,
                            "total_questions": total_questions,
                        })
                        await asyncio.sleep(0.05)
        else:
            stale_count += 1

        # Check terminal states
        if current_status == "completed":
            # Load final scores from analysis row
            final = (await asyncio.to_thread(
                lambda: sb.table("analyses").select("*").eq("id", analysis_id).single().execute()
            )).data

            # Emit any remaining theme:complete events
            theme_scores = (await asyncio.to_thread(
                lambda: sb.table("theme_scores").select("*").eq("analysis_id", analysis_id).execute()
            )).data
            for ts in theme_scores:
                tid = ts["theme_id"]
                theme = theme_map.get(tid)
                if theme:
                    yield _sse_event("theme:complete", {
                        "theme_id": tid,
                        "theme_name": theme["name"],
                        "dimension": theme["dimension"],
                        "raw_score": ts.get("raw_score", 0),
                        "rating": ts.get("rating", "?"),
                        "answered_count": answered_count,
                        "total_questions": total_questions,
                    })

            yield _sse_event("analysis:complete", {
                "analysis_id": analysis_id,
                "overall_score": final.get("overall_score", 0),
                "overall_rating": final.get("overall_rating", "?"),
                "environmental_score": final.get("environmental_score", 0),
                "social_score": final.get("social_score", 0),
                "governance_score": final.get("governance_score", 0),
                "total_answered": answered_count,
            })
            return

        if current_status in ("error", "cancelled"):
            yield _sse_event("analysis:error", {
                "analysis_id": analysis_id,
                "error": f"Analysis {current_status}.",
            })
            return

        # Give up if no progress for too long
        if stale_count >= max_stale:
            yield _sse_event("analysis:error", {
                "analysis_id": analysis_id,
                "error": "Analysis appears stalled. Try reopening.",
            })
            return

        # Send keepalive to prevent connection timeout
        yield SSE_KEEPALIVE
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def replay_analysis_sse(analysis_id: str) -> AsyncGenerator[str, None]:
    """Replay a completed analysis as SSE events (reads from DB)."""
    sb = get_supabase()

    analysis = sb.table("analyses").select(
        "*, companies(name, ticker, sector)"
    ).eq("id", analysis_id).single().execute().data

    if not analysis:
        yield _sse_event("analysis:error", {"error": "Analysis not found"})
        return

    themes = sb.table("esg_themes").select("*").order("display_order").execute().data
    questions = sb.table("esg_questions").select("*").order("display_order").execute().data
    answers = sb.table("answers").select("*").eq("analysis_id", analysis_id).execute().data
    theme_scores = sb.table("theme_scores").select("*").eq("analysis_id", analysis_id).execute().data

    answer_map = {a["question_id"]: a for a in answers}
    score_map = {ts["theme_id"]: ts for ts in theme_scores}

    theme_questions: dict[str, list] = {}
    for q in questions:
        tid = q["theme_id"]
        if tid not in theme_questions:
            theme_questions[tid] = []
        theme_questions[tid].append(q)

    total_questions = len(answers)

    yield _sse_event("analysis:start", {
        "analysis_id": analysis_id,
        "company_name": analysis.get("companies", {}).get("name", ""),
        "report_year": analysis.get("report_year"),
        "total_themes": len(themes),
        "total_questions": total_questions,
        "replay": True,
    })
    await asyncio.sleep(0.3)

    answered_count = 0
    current_dim = None

    for theme in themes:
        theme_id = theme["id"]
        dimension = theme["dimension"]
        qs = theme_questions.get(theme_id, [])

        if not qs:
            continue

        has_answers = any(q["id"] in answer_map for q in qs)
        if not has_answers:
            continue

        if dimension != current_dim:
            current_dim = dimension
            yield _sse_event("dimension:start", {
                "dimension": dimension,
                "label": {"environmental": "Ambiental", "social": "Social", "governance": "Governança"}[dimension],
            })
            await asyncio.sleep(0.2)

        yield _sse_event("theme:start", {
            "theme_id": theme_id,
            "theme_name": theme["name"],
            "theme_number": theme.get("theme_number", 0),
            "dimension": dimension,
            "question_count": len(qs),
        })
        await asyncio.sleep(0.15)

        for q in qs:
            answer = answer_map.get(q["id"])
            if not answer:
                continue

            q_text = q.get("question_text", "")
            q_id = q.get("question_id", "")
            if q_text.startswith(q_id):
                q_text = q_text[len(q_id):].lstrip(" .")

            answered_count += 1
            yield _sse_event("question:answered", {
                "question_id": q_id,
                "question_text": q_text[:120],
                "answer": answer["answer"],
                "confidence_score": answer.get("confidence_score", 0),
                "justification": (answer.get("justification") or "")[:200],
                "source_reference": answer.get("source_reference"),
                "theme_name": theme["name"],
                "dimension": dimension,
                "answered_count": answered_count,
                "total_questions": total_questions,
            })
            await asyncio.sleep(0.08)

        ts = score_map.get(theme_id)
        if ts:
            yield _sse_event("theme:complete", {
                "theme_id": theme_id,
                "theme_name": theme["name"],
                "dimension": dimension,
                "raw_score": ts.get("raw_score", 0),
                "rating": ts.get("rating", "?"),
                "answered_count": answered_count,
                "total_questions": total_questions,
            })
            await asyncio.sleep(0.15)

    yield _sse_event("analysis:complete", {
        "analysis_id": analysis_id,
        "overall_score": analysis.get("overall_score", 0),
        "overall_rating": analysis.get("overall_rating", "?"),
        "environmental_score": analysis.get("environmental_score", 0),
        "social_score": analysis.get("social_score", 0),
        "governance_score": analysis.get("governance_score", 0),
        "total_answered": answered_count,
        "replay": True,
    })
