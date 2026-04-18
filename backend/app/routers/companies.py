"""Companies API router — CRUD for companies using Supabase."""

from fastapi import APIRouter, HTTPException
from app.database import get_supabase
from app.schemas import CompanyCreate

router = APIRouter()


@router.get("/")
async def list_companies():
    sb = get_supabase()
    result = sb.table("companies").select("*").order("name").execute()
    return result.data


@router.post("/")
async def create_company(data: CompanyCreate):
    sb = get_supabase()
    result = sb.table("companies").insert(data.model_dump()).execute()
    return result.data[0]


@router.get("/{company_id}")
async def get_company(company_id: str):
    sb = get_supabase()
    result = sb.table("companies").select("*").eq("id", company_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return result.data


@router.put("/{company_id}")
async def update_company(company_id: str, data: CompanyCreate):
    sb = get_supabase()
    result = sb.table("companies").update(data.model_dump()).eq("id", company_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Company not found")
    return result.data[0]


@router.delete("/{company_id}")
async def delete_company(company_id: str):
    sb = get_supabase()
    sb.table("companies").delete().eq("id", company_id).execute()
    return {"status": "deleted"}
