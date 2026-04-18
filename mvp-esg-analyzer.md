# MVP — ERM ESG Document Analyzer

## Goal
Build a web platform where ERM analysts upload corporate documents (PDFs, URLs, news), the system extracts and organizes information by ESG dimension, and AI agents answer structured questions with evidence from the source material.

## Stack

| Layer | Tech | Why |
|-------|------|-----|
| Backend | **Python 3.12 + FastAPI** | Best ecosystem for PDF parsing, NLP, embeddings |
| LLM | **OpenAI GPT-4o** | Structured JSON output, high accuracy for analysis |
| PDF Parsing | **PyMuPDF (fitz)** | Fast, reliable PDF text extraction |
| Embeddings | **OpenAI text-embedding-3-small** | Cost-effective, 1536 dims |
| Database | **Supabase (PostgreSQL + pgvector)** | Vector search + relational in one |
| Frontend | **React 19 + Vite** | Fast dev cycle, modern DX |
| Styling | **Tailwind CSS v4** | Rapid UI development |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND (Vite + React)         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Upload   │  │ Companies│  │  Questionnaire│  │
│  │  Module   │  │  Manager │  │  + Answers    │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────┐
│                BACKEND (FastAPI)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Document  │  │ Analysis │  │   Agent       │  │
│  │ Pipeline  │  │ Engine   │  │   Orchestra   │  │
│  │ (parse,   │  │ (embed,  │  │   (ESG agents │  │
│  │  chunk)   │  │  search) │  │    + scoring) │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│           SUPABASE (PostgreSQL + pgvector)        │
│  companies | documents | chunks | questions |     │
│  answers   | evidence  | embeddings              │
└─────────────────────────────────────────────────┘
```

## Tasks

### Phase 1: Backend Foundation
- [ ] **T1**: Init FastAPI project with venv, install deps → Verify: `/health` returns 200
- [ ] **T2**: Create Supabase schema (companies, documents, chunks, questions, answers) + pgvector → Verify: tables exist
- [ ] **T3**: Document ingestion: upload PDF → extract text → smart chunking (~500 tokens) → store → Verify: chunks in DB
- [ ] **T4**: Embedding pipeline: chunk → OpenAI embedding → store vector → Verify: non-null embeddings

### Phase 2: AI Analysis Engine
- [ ] **T5**: Semantic search: question → embed → top-K cosine similarity → Verify: relevant results
- [ ] **T6**: ESG Agents (Environmental, Social, Governance, Synthesis) with structured output → Verify: JSON answer
- [ ] **T7**: Orchestration endpoint: `POST /api/analyze` → search → agents → store → Verify: structured answers

### Phase 3: Frontend
- [ ] **T8**: Init Vite + React + Tailwind, layout shell + dark theme → Verify: `npm run dev` shows UI
- [ ] **T9**: Document Upload page: drag-drop PDF + company selector + list → Verify: upload works
- [ ] **T10**: Analysis Dashboard: questions by dimension + run analysis + answer cards with evidence → Verify: E2E

### Phase 4: Verification
- [ ] **T11**: E2E: Upload sustainability report → Run analysis → Get ESG answers with evidence

## Done When
- [ ] Analyst can upload a PDF corporate report
- [ ] System extracts text and creates searchable chunks
- [ ] AI agents answer ESG questions citing specific document sections
- [ ] Dashboard shows answers organized by dimension with evidence

## Notes
- **MVP scope**: No auth, single-user, no scoring weights yet
- **Questionário placeholder**: 12 sample ESG questions (4 per dimension) until real ones arrive
- **Scale later**: Auth, multi-tenancy, URL scraping, scoring, PDF reports
