"""Pydantic models for the ESG API."""

from pydantic import BaseModel, Field
from datetime import datetime


# --- Companies ---
class CompanyCreate(BaseModel):
    name: str
    ticker: str | None = None
    sector: str = "Geral"
    description: str | None = None


class Company(CompanyCreate):
    id: str
    created_at: datetime


# --- Documents ---
class DocumentUpload(BaseModel):
    company_id: str
    report_year: int
    source_type: str = Field(default="pdf", description="pdf, url, or text")
    source_url: str | None = None


class Document(BaseModel):
    id: str
    company_id: str
    filename: str | None = None
    report_year: int
    source_type: str
    source_url: str | None = None
    status: str
    chunk_count: int = 0
    page_count: int = 0
    created_at: datetime


# --- ESG Themes ---
class ESGTheme(BaseModel):
    id: str
    name: str
    dimension: str
    theme_number: int
    display_order: int
    description: str | None = None


# --- ESG Questions ---
class ESGQuestion(BaseModel):
    id: str
    theme_id: str
    question_id: str
    question_text: str
    section: str | None = None
    expected_answer: str = "Sim"
    display_order: int = 0


# --- Analysis ---
class AnalysisCreate(BaseModel):
    company_id: str
    report_year: int


class Analysis(BaseModel):
    id: str
    company_id: str
    report_year: int
    status: str
    overall_score: float | None = None
    overall_rating: str | None = None
    environmental_score: float | None = None
    social_score: float | None = None
    governance_score: float | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


# --- Answers ---
class Answer(BaseModel):
    id: str
    analysis_id: str
    question_id: str
    answer: str | None = None
    justification: str | None = None
    source_reference: str | None = None
    improvement_points: str | None = None
    confidence_score: float = 0
    agent_name: str | None = None
    score: float = 0
    weighted_score: float = 0
    created_at: datetime


class AnswerWithQuestion(Answer):
    question: ESGQuestion | None = None
    theme: ESGTheme | None = None


# --- Theme Scores ---
class ThemeScore(BaseModel):
    id: str
    analysis_id: str
    theme_id: str
    raw_score: float = 0
    weighted_score: float = 0
    rating: str | None = None
    highlights_positive: str | None = None
    highlights_negative: str | None = None


class ThemeScoreWithTheme(ThemeScore):
    theme: ESGTheme | None = None


# --- Analysis Result (full) ---
class AnalysisResult(BaseModel):
    analysis: Analysis
    company: Company
    theme_scores: list[ThemeScoreWithTheme] = []
    answers: list[AnswerWithQuestion] = []
    progress: dict | None = None


# --- Export ---
class ExportRequest(BaseModel):
    analysis_id: str


# --- Materiality ---
class MaterialityWeight(BaseModel):
    id: str
    sector: str
    theme_id: str
    weight: float = 1.0
