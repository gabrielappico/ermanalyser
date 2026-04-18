"""In-memory data store for local development (no Supabase required)."""

import uuid
from datetime import datetime, timezone


_companies: dict[str, dict] = {}
_documents: dict[str, dict] = {}
_chunks: dict[str, dict] = {}
_questions: dict[str, dict] = {}
_answers: dict[str, dict] = {}


# --- Companies ---

def list_companies() -> list[dict]:
    return sorted(_companies.values(), key=lambda c: c["name"])


def create_company(data: dict) -> dict:
    record = {
        "id": str(uuid.uuid4()),
        "name": data["name"],
        "ticker": data.get("ticker"),
        "sector": data.get("sector"),
        "description": data.get("description"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _companies[record["id"]] = record
    return record


def get_company(company_id: str) -> dict | None:
    return _companies.get(company_id)


def delete_company(company_id: str) -> None:
    _companies.pop(company_id, None)
    doc_ids = [d["id"] for d in _documents.values() if d["company_id"] == company_id]
    for doc_id in doc_ids:
        delete_document(doc_id)
    answer_ids = [a["id"] for a in _answers.values() if a["company_id"] == company_id]
    for aid in answer_ids:
        _answers.pop(aid, None)


# --- Documents ---

def list_company_documents(company_id: str) -> list[dict]:
    docs = [d for d in _documents.values() if d["company_id"] == company_id]
    return sorted(docs, key=lambda d: d["created_at"], reverse=True)


def list_all_documents() -> list[dict]:
    docs = []
    for d in sorted(_documents.values(), key=lambda x: x["created_at"], reverse=True):
        enriched = {**d}
        company = _companies.get(d["company_id"])
        enriched["companies"] = {"name": company["name"]} if company else None
        docs.append(enriched)
    return docs


def create_document(data: dict) -> dict:
    record = {
        "id": str(uuid.uuid4()),
        "company_id": data["company_id"],
        "filename": data.get("filename"),
        "source_type": data.get("source_type", "pdf"),
        "source_url": data.get("source_url"),
        "status": data.get("status", "uploading"),
        "chunk_count": data.get("chunk_count", 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _documents[record["id"]] = record
    return record


def get_document(document_id: str) -> dict | None:
    doc = _documents.get(document_id)
    if not doc:
        return None
    enriched = {**doc}
    company = _companies.get(doc["company_id"])
    enriched["companies"] = {"name": company["name"]} if company else None
    return enriched


def update_document(document_id: str, data: dict) -> dict | None:
    doc = _documents.get(document_id)
    if not doc:
        return None
    doc.update(data)
    return doc


def delete_document(document_id: str) -> None:
    _documents.pop(document_id, None)
    chunk_ids = [c["id"] for c in _chunks.values() if c["document_id"] == document_id]
    for cid in chunk_ids:
        _chunks.pop(cid, None)


# --- Chunks ---

def create_chunk(data: dict) -> dict:
    record = {
        "id": str(uuid.uuid4()),
        "document_id": data["document_id"],
        "content": data["content"],
        "chunk_index": data.get("chunk_index", 0),
        "token_count": data.get("token_count", 0),
        "has_embedding": data.get("has_embedding", False),
        "embedding": data.get("embedding"),
    }
    _chunks[record["id"]] = record
    return record


def list_document_chunks(document_id: str) -> list[dict]:
    chunks = [c for c in _chunks.values() if c["document_id"] == document_id]
    return sorted(chunks, key=lambda c: c["chunk_index"])


# --- Questions ---

def list_questions() -> list[dict]:
    return sorted(_questions.values(), key=lambda q: (q["dimension"], q.get("order", 0)))


def seed_questions(questions: list[dict]) -> list[dict]:
    if _questions:
        return list(_questions.values())
    created = []
    for q in questions:
        record = {
            "id": str(uuid.uuid4()),
            "dimension": q["dimension"],
            "question_text": q["question_text"],
            "weight": q.get("weight", 1.0),
            "order": q.get("order", 0),
        }
        _questions[record["id"]] = record
        created.append(record)
    return created


def get_question(question_id: str) -> dict | None:
    return _questions.get(question_id)


# --- Answers ---

def create_answer(data: dict) -> dict:
    record = {
        "id": str(uuid.uuid4()),
        **data,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _answers[record["id"]] = record
    return record


def list_company_answers(company_id: str) -> list[dict]:
    answers = [a for a in _answers.values() if a["company_id"] == company_id]
    return sorted(answers, key=lambda a: a["created_at"], reverse=True)
