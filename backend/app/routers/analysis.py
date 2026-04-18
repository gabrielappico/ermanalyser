"""Analysis API router — run ESG analysis, get results, export, and SSE streaming."""

import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
from app.database import get_supabase
from app.schemas import AnalysisCreate
from app.services.esg_agents import run_full_analysis
from app.services.excel_exporter import export_analysis_to_excel
from app.services.sse_analysis import subscribe_analysis_sse, replay_analysis_sse
from app.services.analysis_runner import (
    start_analysis_background, is_analysis_running, cancel_analysis_task,
)

# Max time before an analysis is considered stuck (minutes)
STUCK_THRESHOLD_MINUTES = 5

router = APIRouter()


@router.get("/themes")
async def list_themes():
    """List all ESG themes grouped by dimension."""
    sb = get_supabase()
    result = sb.table("esg_themes").select("*").order("display_order").execute()
    themes = result.data

    grouped = {"environmental": [], "social": [], "governance": []}
    for t in themes:
        dim = t["dimension"]
        if dim in grouped:
            grouped[dim].append(t)
    return grouped


@router.get("/themes/{theme_id}/questions")
async def list_theme_questions(theme_id: str):
    """List all questions for a specific theme."""
    sb = get_supabase()
    result = sb.table("esg_questions").select("*").eq("theme_id", theme_id).order("display_order").execute()
    return result.data


@router.get("/questions")
async def list_all_questions():
    """List all ESG questions with their themes."""
    sb = get_supabase()
    result = sb.table("esg_questions").select("*, esg_themes(name, dimension, theme_number)").order("display_order").execute()
    return result.data


@router.post("/run")
async def create_and_run_analysis(request: AnalysisCreate, background_tasks: BackgroundTasks):
    """Create and start an ESG analysis for a company + year."""
    sb = get_supabase()

    company = sb.table("companies").select("*").eq("id", request.company_id).single().execute()
    if not company.data:
        raise HTTPException(status_code=404, detail="Company not found")

    docs = sb.table("documents").select("id").eq("company_id", request.company_id).eq(
        "report_year", request.report_year
    ).eq("status", "ready").execute()

    if not docs.data:
        raise HTTPException(
            status_code=400,
            detail=f"No processed documents found for year {request.report_year}. Upload and process documents first.",
        )

    existing = sb.table("analyses").select("id, status").eq(
        "company_id", request.company_id
    ).eq("report_year", request.report_year).execute()

    if existing.data:
        analysis = existing.data[0]
        if analysis["status"] == "running":
            return {"id": analysis["id"], "status": "running", "message": "Analysis already in progress."}
        sb.table("answers").delete().eq("analysis_id", analysis["id"]).execute()
        sb.table("theme_scores").delete().eq("analysis_id", analysis["id"]).execute()
        sb.table("analyses").update({"status": "running", "started_at": "now()"}).eq("id", analysis["id"]).execute()
        analysis_id = analysis["id"]
    else:
        result = sb.table("analyses").insert({
            "company_id": request.company_id,
            "report_year": request.report_year,
            "status": "running",
        }).execute()
        analysis_id = result.data[0]["id"]

    background_tasks.add_task(
        run_full_analysis,
        analysis_id,
        request.company_id,
        request.report_year,
        company.data["sector"],
    )

    return {"id": analysis_id, "status": "running", "message": "Analysis started in background."}


@router.get("/status/{analysis_id}")
async def get_analysis_status(analysis_id: str):
    """Get the current status and progress of an analysis."""
    sb = get_supabase()

    analysis = sb.table("analyses").select("*").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    total_questions = sb.table("esg_questions").select("id", count="exact").execute()
    answered = sb.table("answers").select("id", count="exact").eq("analysis_id", analysis_id).execute()

    return {
        **analysis.data,
        "progress": {
            "total": total_questions.count,
            "completed": answered.count,
            "percentage": round((answered.count / total_questions.count * 100) if total_questions.count else 0, 1),
        },
    }


@router.get("/results/{analysis_id}")
async def get_analysis_results(analysis_id: str):
    """Get full analysis results including theme scores and answers."""
    sb = get_supabase()

    analysis = sb.table("analyses").select("*").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    company = sb.table("companies").select("*").eq("id", analysis.data["company_id"]).single().execute()

    theme_scores = sb.table("theme_scores").select(
        "*, esg_themes(name, dimension, theme_number, display_order)"
    ).eq("analysis_id", analysis_id).execute()

    answers = sb.table("answers").select(
        "*, esg_questions(question_id, question_text, section, expected_answer, esg_themes(name, dimension))"
    ).eq("analysis_id", analysis_id).order("created_at").execute()

    return {
        "analysis": analysis.data,
        "company": company.data,
        "theme_scores": sorted(theme_scores.data, key=lambda x: x.get("esg_themes", {}).get("display_order", 0)),
        "answers": answers.data,
    }


@router.get("/history/{company_id}")
async def get_company_analysis_history(company_id: str):
    """Get all analyses for a company across years."""
    sb = get_supabase()
    result = sb.table("analyses").select("*").eq("company_id", company_id).order("report_year", desc=True).execute()
    return result.data


@router.post("/export/{analysis_id}")
async def export_analysis(analysis_id: str):
    """Export analysis results to Excel (.xlsm)."""
    import traceback
    sb = get_supabase()

    analysis = sb.table("analyses").select("*").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.data["status"] != "completed":
        raise HTTPException(status_code=400, detail="Analysis not yet completed")

    try:
        filepath = await export_analysis_to_excel(analysis_id)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

    filename = os.path.basename(filepath)
    media_type = (
        "application/vnd.ms-excel.sheet.macroEnabled.12"
        if filename.endswith(".xlsm")
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return FileResponse(filepath, media_type=media_type, filename=filename)


@router.post("/run-stream")
async def run_analysis_stream(request_body: AnalysisCreate):
    """Start ESG analysis in background + return SSE subscription stream.

    The analysis runs as an independent background task that continues
    even if the SSE connection drops. The SSE stream reads progress from
    the database and can be reconnected at any time.
    """
    sb = get_supabase()

    company = sb.table("companies").select("*").eq("id", request_body.company_id).single().execute()
    if not company.data:
        raise HTTPException(status_code=404, detail="Company not found")

    docs = sb.table("documents").select("id").eq("company_id", request_body.company_id).eq(
        "report_year", request_body.report_year
    ).eq("status", "ready").execute()

    if not docs.data:
        raise HTTPException(status_code=400, detail=f"No processed documents for year {request_body.report_year}.")

    # Create or reset analysis record
    existing = sb.table("analyses").select("id, status").eq(
        "company_id", request_body.company_id
    ).eq("report_year", request_body.report_year).execute()

    if existing.data:
        analysis_id = existing.data[0]["id"]
        # If already running in background, just subscribe
        if existing.data[0]["status"] == "running" and is_analysis_running(analysis_id):
            # Count already answered questions for catch-up
            answered = sb.table("answers").select("id", count="exact").eq("analysis_id", analysis_id).execute()
            return StreamingResponse(
                subscribe_analysis_sse(analysis_id, last_seen_count=0),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        # Reset for fresh run
        sb.table("answers").delete().eq("analysis_id", analysis_id).execute()
        sb.table("theme_scores").delete().eq("analysis_id", analysis_id).execute()
    else:
        result = sb.table("analyses").insert({
            "company_id": request_body.company_id,
            "report_year": request_body.report_year,
            "status": "pending",
        }).execute()
        analysis_id = result.data[0]["id"]

    # Start analysis in background (fire-and-forget)
    await start_analysis_background(
        analysis_id,
        request_body.company_id,
        request_body.report_year,
        company.data["sector"],
    )

    # Return SSE subscription stream (reads from DB)
    return StreamingResponse(
        subscribe_analysis_sse(analysis_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/subscribe/{analysis_id}")
async def subscribe_analysis(
    analysis_id: str,
    last_seen: int = Query(0, description="Number of answers already seen by client"),
):
    """Subscribe to an already-running analysis SSE stream.

    Use last_seen to skip answers the client already has (reconnection).
    This endpoint is for reconnecting after a dropped SSE connection.
    """
    sb = get_supabase()

    analysis = sb.table("analyses").select("status").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    status = analysis.data["status"]

    # If completed, replay instead
    if status == "completed":
        return StreamingResponse(
            replay_analysis_sse(analysis_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    if status in ("error", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Analysis is '{status}', cannot subscribe.")

    return StreamingResponse(
        subscribe_analysis_sse(analysis_id, last_seen_count=last_seen),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/replay/{analysis_id}")
async def replay_analysis(analysis_id: str):
    """Replay a completed analysis as SSE events with animated delays."""
    sb = get_supabase()

    analysis = sb.table("analyses").select("status").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.data["status"] != "completed":
        raise HTTPException(status_code=400, detail="Analysis not yet completed. Cannot replay.")

    return StreamingResponse(
        replay_analysis_sse(analysis_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/cancel/{analysis_id}")
async def cancel_analysis(analysis_id: str):
    """Cancel a running analysis — stops background task and sets status to 'cancelled'."""
    sb = get_supabase()

    analysis = sb.table("analyses").select("*").eq("id", analysis_id).single().execute()
    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    current_status = analysis.data["status"]
    if current_status not in ("running", "pending"):
        # Even if not 'running', force-set to cancelled if user insists
        if current_status in ("error", "cancelled"):
            return {"id": analysis_id, "status": current_status, "message": f"Analysis already '{current_status}'."}

    # Try to cancel the background task (may or may not exist)
    task_cancelled = cancel_analysis_task(analysis_id)

    answered = sb.table("answers").select("id", count="exact").eq("analysis_id", analysis_id).execute()
    total = sb.table("esg_questions").select("id", count="exact").execute()

    # ALWAYS update DB status regardless of whether task was found
    sb.table("analyses").update({
        "status": "cancelled",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", analysis_id).execute()

    return {
        "id": analysis_id,
        "status": "cancelled",
        "task_was_running": task_cancelled,
        "message": f"Analysis cancelled. {answered.count}/{total.count} questions were answered before cancellation.",
        "partial_progress": {
            "answered": answered.count,
            "total": total.count,
        },
    }


@router.post("/force-restart/{analysis_id}")
async def force_restart_analysis(analysis_id: str):
    """Force restart a stuck/cancelled/error analysis — wipes old answers and restarts clean."""
    sb = get_supabase()

    analysis = sb.table("analyses").select(
        "*, companies(name, ticker, sector)"
    ).eq("id", analysis_id).single().execute()

    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if analysis.data["status"] == "running":
        # Cancel any running background task
        cancel_analysis_task(analysis_id)
        sb.table("analyses").update({
            "status": "cancelled",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", analysis_id).execute()

    # Clean up old data
    sb.table("answers").delete().eq("analysis_id", analysis_id).execute()
    sb.table("theme_scores").delete().eq("analysis_id", analysis_id).execute()

    # Reset analysis record
    sb.table("analyses").update({
        "status": "pending",
        "overall_score": None,
        "overall_rating": None,
        "environmental_score": None,
        "social_score": None,
        "governance_score": None,
        "started_at": None,
        "completed_at": None,
    }).eq("id", analysis_id).execute()

    return {
        "id": analysis_id,
        "status": "pending",
        "company_id": analysis.data["company_id"],
        "report_year": analysis.data["report_year"],
        "message": "Analysis reset. You can now start a new analysis.",
    }


@router.post("/unstick")
async def unstick_analyses():
    """Detect and fix all analyses stuck in 'running' state.
    
    Uses a SHORT threshold — if no new answers in 2 minutes, it's stuck.
    """
    sb = get_supabase()

    running = sb.table("analyses").select(
        "id, company_id, report_year, started_at, status"
    ).eq("status", "running").execute()

    if not running.data:
        return {"fixed": 0, "message": "No stuck analyses found."}

    now = datetime.now(timezone.utc)
    fixed = []

    for analysis in running.data:
        analysis_id = analysis["id"]
        
        # Check if the background task is actually running
        task_alive = is_analysis_running(analysis_id)
        
        # Check last answer time to detect stalled progress
        last_answer = sb.table("answers").select(
            "created_at"
        ).eq("analysis_id", analysis_id).order(
            "created_at", desc=True
        ).limit(1).execute()

        is_stuck = False
        reason = ""

        if not task_alive:
            # No background task running — definitely stuck
            is_stuck = True
            reason = "No background task found"
        elif last_answer.data:
            # Check if last answer was more than 3 minutes ago
            try:
                last_ts = datetime.fromisoformat(last_answer.data[0]["created_at"].replace("Z", "+00:00"))
                idle_seconds = (now - last_ts).total_seconds()
                if idle_seconds > 180:  # 3 minutes without progress
                    is_stuck = True
                    reason = f"No progress for {int(idle_seconds)}s"
            except (ValueError, TypeError):
                pass
        else:
            # No answers at all — check started_at
            started_at = analysis.get("started_at")
            if started_at:
                try:
                    started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                    if (now - started).total_seconds() > 300:  # 5 min with 0 answers
                        is_stuck = True
                        reason = "No answers after 5 minutes"
                except (ValueError, TypeError):
                    is_stuck = True
                    reason = "Invalid started_at"
            else:
                is_stuck = True
                reason = "No started_at"

        if is_stuck:
            cancel_analysis_task(analysis_id)

            answered = sb.table("answers").select(
                "id", count="exact"
            ).eq("analysis_id", analysis_id).execute()

            sb.table("analyses").update({
                "status": "error",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", analysis_id).execute()

            fixed.append({
                "id": analysis_id,
                "company_id": analysis["company_id"],
                "report_year": analysis["report_year"],
                "reason": reason,
                "partial_answers": answered.count,
            })

    return {
        "fixed": len(fixed),
        "analyses": fixed,
        "message": f"{len(fixed)} stuck analysis(es) recovered." if fixed else "No stuck analyses found.",
    }


@router.post("/force-complete/{analysis_id}")
async def force_complete_analysis(analysis_id: str):
    """Force-complete a stuck analysis using whatever answers already exist.
    
    Calculates theme scores and final scores from existing answers, then marks as completed.
    """
    from app.services.esg_agents import calculate_theme_score, get_rating
    
    sb = get_supabase()

    analysis = sb.table("analyses").select(
        "*, companies(name, ticker, sector)"
    ).eq("id", analysis_id).single().execute()

    if not analysis.data:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Cancel any running task
    cancel_analysis_task(analysis_id)

    # Get existing answers
    answers = sb.table("answers").select(
        "*, esg_questions(question_id, expected_answer, theme_id)"
    ).eq("analysis_id", analysis_id).execute()

    if not answers.data:
        raise HTTPException(status_code=400, detail="No answers found. Cannot force-complete.")

    # Get themes and materiality
    themes = sb.table("esg_themes").select("*").order("display_order").execute().data
    sector = analysis.data.get("companies", {}).get("sector", "")
    materiality = sb.table("materiality_weights").select("*").eq("sector", sector).execute().data
    mat_map = {m["theme_id"]: m["weight"] for m in materiality}

    # Group answers by theme
    theme_answers: dict[str, list] = {}
    for ans in answers.data:
        q = ans.get("esg_questions", {})
        tid = q.get("theme_id")
        if tid:
            if tid not in theme_answers:
                theme_answers[tid] = []
            theme_answers[tid].append({
                "question_id": q.get("question_id"),
                "answer": ans["answer"],
            })

    # Calculate/update theme scores
    dim_scores: dict[str, list] = {"environmental": [], "social": [], "governance": []}
    
    # Delete old theme scores
    sb.table("theme_scores").delete().eq("analysis_id", analysis_id).execute()

    for theme in themes:
        tid = theme["id"]
        dim = theme["dimension"]
        t_answers = theme_answers.get(tid, [])
        if not t_answers:
            continue

        questions = sb.table("esg_questions").select("*").eq("theme_id", tid).execute().data
        score = calculate_theme_score(t_answers, questions)
        rating = get_rating(score)
        mat_weight = mat_map.get(tid, 1.0)

        try:
            sb.table("theme_scores").insert({
                "analysis_id": analysis_id,
                "theme_id": tid,
                "raw_score": score,
                "weighted_score": score * mat_weight,
                "rating": rating,
            }).execute()
        except Exception:
            pass

        dim_scores[dim].append({"score": score, "weight": mat_weight})

    # Calculate final scores
    final_scores = {}
    for dim, scores in dim_scores.items():
        if scores:
            total_weight = sum(s["weight"] for s in scores)
            final_scores[dim] = sum(s["score"] * s["weight"] for s in scores) / total_weight if total_weight > 0 else 0
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
    }).eq("id", analysis_id).execute()

    return {
        "id": analysis_id,
        "status": "completed",
        "total_answers": len(answers.data),
        "overall_score": round(overall, 2),
        "overall_rating": get_rating(overall),
        "message": f"Analysis force-completed with {len(answers.data)} answers. Score: {overall:.1f}",
    }
