from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.routers import documents, companies, analysis

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description="ESG Document Analysis Platform for ERM — 380 questions across 26 themes",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router, prefix="/api/companies", tags=["Companies"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["Analysis"])


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": settings.app_name, "version": "0.3.0"}
