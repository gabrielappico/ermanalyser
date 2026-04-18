# ERM ESG Analyzer - Status do Projeto

## ✅ Pronto

### Backend (Python FastAPI)
```
backend/
├── app/
│   ├── main.py              # FastAPI app + CORS + health check
│   ├── config.py             # Pydantic settings (.env)
│   ├── database.py           # Supabase client singleton
│   ├── schemas.py            # Pydantic models (Company, Document, Question, Answer)
│   ├── routers/
│   │   ├── companies.py      # CRUD empresas
│   │   ├── documents.py      # Upload PDF + processamento background
│   │   └── analysis.py       # Executar análise ESG + resultados
│   └── services/
│       ├── document_processor.py  # PDF→texto→chunks→embeddings
│       └── esg_agents.py          # 3 agentes ESG + semantic search + orquestração
├── .env.example
└── requirements.txt
```

### Frontend (React + Vite + Tailwind v4)
```
frontend/
├── src/
│   ├── App.tsx               # Layout principal com sidebar
│   ├── api.ts                # API client (axios)
│   ├── index.css             # Design system dark theme
│   ├── main.tsx              # Entry point
│   └── components/
│       ├── Sidebar.tsx       # Navegação + empresa selecionada
│       ├── CompaniesPanel.tsx # Grid de empresas + CRUD
│       ├── DocumentsPanel.tsx # Upload drag-drop + status
│       └── AnalysisPanel.tsx  # Perguntas ESG + respostas + evidências
```

## ⏳ Pendente

### Supabase (Bloqueador)
- **Problema**: Limite de 2 projetos free ativos atingido
- **Solução**: Pausar um projeto existente (tshirtmenager ou autoinsta já estão INACTIVE, mas o limite conta projetos owned — pode ser necessário pausar ContaBoi ou guiagratuito temporariamente)
- **Quando resolver**: Criar o schema abaixo + configurar .env

### Schema SQL necessário (pronto para aplicar):
```sql
-- Enable pgvector
create extension if not exists vector;

-- Companies
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ticker text,
  sector text,
  description text,
  created_at timestamptz default now()
);

-- Documents
create table documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  filename text,
  source_type text default 'pdf',
  source_url text,
  status text default 'uploading',
  chunk_count int default 0,
  created_at timestamptz default now()
);

-- Chunks with vector embeddings
create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  chunk_index int not null,
  token_count int default 0,
  embedding vector(1536),
  created_at timestamptz default now()
);

-- Questions
create table questions (
  id uuid primary key default gen_random_uuid(),
  dimension text not null,
  question_text text not null,
  weight float default 1.0,
  "order" int default 0
);

-- Answers
create table answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  answer_text text,
  confidence_score float default 0,
  agent_name text,
  evidence jsonb default '[]',
  created_at timestamptz default now(),
  unique(company_id, question_id)
);

-- Vector similarity search function
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  filter_company_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  similarity float,
  document_filename text
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.filename as document_filename
  from chunks c
  join documents d on d.id = c.document_id
  where (filter_company_id is null or d.company_id = filter_company_id)
  and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Index for vector search performance
create index on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

## 🏃 Próximo passo
1. Liberar slot no Supabase (pausar projeto inativo)
2. Criar projeto ERM-ESG
3. Aplicar migration SQL acima
4. Configurar .env com credenciais
5. Testar E2E: upload PDF → análise → respostas
