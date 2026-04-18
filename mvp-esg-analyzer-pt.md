# MVP — ERM ESG Analisador de Documentos

## Objetivo

Construir uma plataforma web onde analistas da ERM fazem upload de documentos corporativos (PDFs, URLs, notícias), o sistema extrai e organiza as informações por dimensão ESG, e agentes de IA respondem perguntas estruturadas com evidências do material de origem.

## Stack Tecnológica

| Camada         | Tecnologia                                 | Justificativa                                            |
| -------------- | ------------------------------------------ | -------------------------------------------------------- |
| Backend        | **Python 3.12 + FastAPI**            | Melhor ecossistema para parsing de PDF, NLP e embeddings |
| LLM            | **OpenAI GPT-4o**                    | Saída JSON estruturada, alta precisão para análise    |
| Parsing de PDF | **PyMuPDF (fitz)**                   | Extração de texto de PDF rápida e confiável          |
| Embeddings     | **OpenAI text-embedding-3-small**    | Custo-benefício, 1536 dimensões                        |
| Banco de Dados | **Supabase (PostgreSQL + pgvector)** | Busca vetorial + relacional em um só                    |
| Frontend       | **React 19 + Vite**                  | Ciclo de desenvolvimento rápido, DX moderna             |
| Estilização  | **Tailwind CSS v4**                  | Desenvolvimento de UI rápido                            |

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│               FRONTEND (Vite + React)            │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Módulo   │  │ Gestão de│  │ Questionário  │  │
│  │  Upload   │  │ Empresas │  │  + Respostas  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ API REST
┌─────────────────────▼───────────────────────────┐
│                BACKEND (FastAPI)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Pipeline  │  │ Motor de │  │  Orquestração │  │
│  │ de Docs   │  │ Análise  │  │   de Agentes  │  │
│  │ (parse,   │  │ (embed,  │  │  (agentes ESG │  │
│  │  chunk)   │  │  busca)  │  │  + pontuação) │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│           SUPABASE (PostgreSQL + pgvector)        │
│  empresas | documentos | chunks | perguntas |     │
│  respostas | evidências | embeddings              │
└─────────────────────────────────────────────────┘
```

## Tarefas

### Fase 1: Fundação do Backend

- [ ] **T1**: Inicializar projeto FastAPI com venv, instalar dependências → Verificação: `/health` retorna 200
- [ ] **T2**: Criar schema no Supabase (empresas, documentos, chunks, perguntas, respostas) + pgvector → Verificação: tabelas existem
- [ ] **T3**: Ingestão de documentos: upload PDF → extrair texto → chunking inteligente (~500 tokens) → armazenar → Verificação: chunks no BD
- [ ] **T4**: Pipeline de embeddings: chunk → embedding OpenAI → armazenar vetor → Verificação: embeddings não-nulos

### Fase 2: Motor de Análise com IA

- [ ] **T5**: Busca semântica: pergunta → embedding → top-K similaridade cosseno → Verificação: resultados relevantes
- [ ] **T6**: Agentes ESG (Ambiental, Social, Governança, Síntese) com saída estruturada → Verificação: resposta JSON
- [ ] **T7**: Endpoint de orquestração: `POST /api/analyze` → busca → agentes → armazenar → Verificação: respostas estruturadas

### Fase 3: Frontend

**T8**: Inicializar Vite + React + Tailwind, shell de layout + tema escuro → Verificação: `npm run dev` mostra a UI

* [ ] **T9**: Página de Upload de Documentos: drag-drop de PDF + seletor de empresa + lista → Verificação: upload funciona

**T10**: Dashboard de Análise: perguntas por dimensão + executar análise + cards de resposta com evidências → Verificação: E2E

### Fase 4: Verificação

**T11**: E2E: Upload de relatório de sustentabilidade → Executar análise → Obter respostas ESG com evidências

## Critérios de Conclusão

- [ ] Analista consegue fazer upload de um relatório corporativo em PDF
- [ ] Sistema extrai o texto e cria chunks pesquisáveis
- [ ] Agentes de IA respondem perguntas ESG citando seções específicas do documento
- [ ] Dashboard exibe respostas organizadas por dimensão com evidências

## Observações

- **Escopo do MVP**: Sem autenticação, usuário único, sem pesos de pontuação por enquanto
- **Questionário placeholder**: 12 perguntas ESG de exemplo (4 por dimensão) até as reais chegarem
- **Escalar depois**: Autenticação, multi-tenancy, scraping de URLs, pontuação, relatórios em PDF
