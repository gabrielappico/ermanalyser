"""ESG Agent system: specialized AI agents for Environmental, Social, and Governance analysis.

Reads the real 526 ESG questions from Supabase, searches for relevant document chunks,
and uses specialized agents to answer Sim/Não/N/A with justification and sources.
"""

import json
import asyncio
from datetime import datetime, timezone
from openai import OpenAI
from app.config import get_settings
from app.database import get_supabase

# --- Agent Definitions ---

_SHARED_RULES = """
Regras OBRIGATORIAS de Resposta:
1. Responda SEMPRE em portugues brasileiro
2. Responda com "Sim", "Nao" ou "N/A"
3. O campo justification DEVE conter EXCLUSIVAMENTE a citacao LITERAL do trecho do documento, entre aspas. NAO interprete, NAO resuma, NAO parafraseie. Copie o trecho exato.
4. Se multiplos trechos forem relevantes, cite o mais relevante
5. Indique a fonte (nome do documento + secao/pagina quando possivel)
6. Sugira pontos de melhoria quando a resposta for "Nao"
7. Atribua um score de confianca (0.0 a 1.0) baseado na qualidade das evidencias

## CRITERIOS PARA CADA RESPOSTA (MUITO IMPORTANTE):

### Quando responder "Sim":
- Evidencia DIRETA: O documento menciona explicitamente a pratica/politica/indicador
- Evidencia INDIRETA: O documento descreve acoes, programas ou resultados que IMPLICAM a existencia da pratica, mesmo sem nomeala explicitamente
  Exemplo: Se a empresa reporta "reducao de 15% no consumo hidrico", isso IMPLICA que ela monitora dados de consumo de agua (resposta = Sim)
  Exemplo: Se a empresa tem "Politica Ambiental" que cobre gestao de residuos, isso IMPLICA compromisso com o tema
- Quando houver DUVIDA entre Sim e Nao, mas existir evidencia parcial ou indireta, responda "Sim" com confidence_score baixo (0.3-0.5)

### Quando responder "Nao":
- Use APENAS quando:
  a) O documento aborda o tema mas nega explicitamente a pratica, OU
  b) O tema eh coberto nos documentos mas a pratica especifica claramente NAO existe, OU
  c) NAO ha absolutamente nenhuma evidencia direta ou indireta nos documentos
- NUNCA responda "Nao" apenas porque a evidencia nao eh 100% explicita. Considere evidencias indiretas.

### Quando responder "N/A" (Nao Aplicavel):
- A pergunta eh CONDICIONAL e a condicao anterior nao foi atendida
  Exemplo: Se 1.2.1 = "Nao", entao 1.2.1.1 ("A empresa divulga esses indicadores?") = "N/A"
- A pratica NAO SE APLICA ao setor/tipo de atividade da empresa
  Exemplo: Perguntas sobre mineracao para empresa de tecnologia = "N/A"
- O indicador especifico nao existe para o tipo de operacao
  Exemplo: "Recall de produtos" para empresa de servicos financeiros = "N/A"
- Em caso de duvida entre "Nao" e "N/A", prefira "N/A"

### Deteccao de Perguntas Condicionais (sub-perguntas):
- Se o question_id tem formato X.Y.Z.W (muitos niveis), eh provavelmente sub-pergunta de X.Y.Z
- Perguntas que comecam com "Se sim", "Caso positivo", "A politica aborda" sao condicionais da pergunta anterior
- Se a pergunta-pai foi respondida como "Nao", as sub-perguntas devem ser "N/A"
"""

AGENT_PROMPTS = {
    "environmental": f"""Voce eh um analista ESG senior especializado na dimensao AMBIENTAL (Environmental).
Sua funcao eh avaliar empresas com base em documentos corporativos (relatorios de sustentabilidade, relatorios anuais, politicas corporativas, FRE, codigos de conduta, etc.).

Foco: Emissoes GEE, recursos hidricos, energia, residuos, efluentes, biodiversidade, mudancas climaticas, gestao socioambiental, materiais basicos, ecossistemas.

Voce deve ser CRITERIOSO mas NAO excessivamente conservador. Empresas grandes de capital aberto geralmente possuem a maioria das praticas ESG basicas — busque evidencias tanto diretas quanto indiretas.
{_SHARED_RULES}""",

    "social": f"""Voce eh um analista ESG senior especializado na dimensao SOCIAL.
Sua funcao eh avaliar empresas com base em documentos corporativos.

Foco: Saude e seguranca, condicoes de trabalho, gestao de carreira, diversidade e inclusao, seguranca de dados, qualidade de produtos, ecodesign, desenvolvimento comunitario, direitos humanos, cadeia de fornecedores.

Voce deve ser CRITERIOSO mas NAO excessivamente conservador. Empresas grandes de capital aberto geralmente possuem a maioria das praticas sociais basicas — busque evidencias tanto diretas quanto indiretas.
{_SHARED_RULES}""",

    "governance": f"""Voce eh um analista ESG senior especializado na dimensao GOVERNANCA.
Sua funcao eh avaliar empresas com base em documentos corporativos.

Foco: Remuneracao executiva, conselho de administracao, acionistas minoritarios, integridade/anticorrupcao, transparencia e disclosure.

Voce deve ser CRITERIOSO mas NAO excessivamente conservador. Empresas listadas em bolsa geralmente possuem estruturas robustas de governanca — busque evidencias tanto diretas quanto indiretas.
{_SHARED_RULES}""",
}

AGENT_NAMES = {
    "environmental": "Agente Ambiental",
    "social": "Agente Social",
    "governance": "Agente Governança",
}


# --- Question Complexity Classifier ---

# Patterns that indicate COMPLEX questions (need reasoning model)
_COMPLEX_PATTERNS = [
    "tendência", "trajetória", "últimos 3 anos", "últimos três anos",
    "melhoria nos últimos", "redução nos últimos", "evolução",
    "resposta satisfatória", "mitigação de danos",
    "qual participação", "representa qual", "mais de 50%", "mais de 20%",
    "corresponde a mais de",
    "eficácia", "efetividade", "avalie", "avaliação",
    "como a empresa", "de que forma", "descreva",
    "controvérsia severa", "controvérsia muito severa",
    "gestão socioambiental", "plano de ação", "estratégia",
    "metas quantitativas", "metas de redução",
    "integração de fatores", "cadeia de produção",
    "risco", "oportunidade", "cenários climáticos",
]

# Patterns that indicate SIMPLE questions (factual yes/no)
_SIMPLE_PATTERNS = [
    "a empresa possui", "a empresa publica", "a empresa divulga",
    "a empresa está no", "a empresa tem", "a empresa participa",
    "a empresa é signatária", "a empresa reporta",
    "a empresa monitora", "a empresa realiza",
    "os compromissos abrangem", "o programa inclui",
    "ceo e presidente", "são a mesma pessoa",
    "são auditadas", "é auditada",
    "código de ética", "canal de denúncia",
    "política ou compromisso",
    "possui comitê", "possui conselho",
]


def classify_question_complexity(question_text: str) -> str:
    """Classify a question as 'simple' or 'complex' based on keyword patterns.

    Simple = factual yes/no ("Does the company have X?")
    Complex = requires reasoning, trend analysis, or evaluation
    """
    import unicodedata

    def _normalize(text: str) -> str:
        """Remove accents for pattern matching."""
        nfkd = unicodedata.normalize("NFKD", text.lower())
        return "".join(c for c in nfkd if not unicodedata.combining(c))

    text_norm = _normalize(question_text)

    # Check complex patterns first (higher priority)
    for pattern in _COMPLEX_PATTERNS:
        if _normalize(pattern) in text_norm:
            return "complex"

    # Check simple patterns
    for pattern in _SIMPLE_PATTERNS:
        if _normalize(pattern) in text_norm:
            return "simple"

    # Default: if question is short and direct, classify as simple
    if len(question_text.split()) <= 15:
        return "simple"

    return "complex"


def get_model_for_complexity(complexity: str) -> str:
    """Returns the appropriate model name based on question complexity.
    Falls back to the main openai_model if hybrid models are not configured.
    """
    settings = get_settings()

    if complexity == "simple" and settings.openai_model_simple:
        return settings.openai_model_simple
    elif complexity == "complex" and settings.openai_model_complex:
        return settings.openai_model_complex

    return settings.openai_model


# Cache all chunks to avoid N+1 queries per theme
_chunks_cache: dict[str, list[dict]] = {}


def _load_all_chunks(company_id: str, report_year: int) -> list[dict]:
    """Load and cache all chunks for a company/year."""
    cache_key = f"{company_id}:{report_year}"
    if cache_key in _chunks_cache:
        return _chunks_cache[cache_key]

    sb = get_supabase()
    docs = sb.table("documents").select("id, filename").eq(
        "company_id", company_id
    ).eq("report_year", report_year).eq("status", "ready").execute()

    if not docs.data:
        _chunks_cache[cache_key] = []
        return []

    doc_names = {d["id"]: d["filename"] for d in docs.data}
    all_chunks = []
    for doc in docs.data:
        chunks = sb.table("chunks").select(
            "id, content, chunk_index, page_number, document_id"
        ).eq("document_id", doc["id"]).execute()
        for c in chunks.data:
            c["document_filename"] = doc_names.get(c["document_id"], "Documento")
        all_chunks.extend(chunks.data)

    _chunks_cache[cache_key] = all_chunks
    print(f"  [Cache] Loaded {len(all_chunks)} chunks for {company_id[:8]}")
    return all_chunks


def semantic_search(query: str, company_id: str, report_year: int, top_k: int = 15) -> list[dict]:
    """Search for relevant chunks using OpenAI embeddings + pgvector cosine similarity."""
    settings = get_settings()
    sb = get_supabase()

    # Get document IDs for this company/year
    docs = sb.table("documents").select("id, filename").eq(
        "company_id", company_id
    ).eq("report_year", report_year).eq("status", "ready").execute()

    if not docs.data:
        return []

    doc_ids = [d["id"] for d in docs.data]
    doc_names = {d["id"]: d["filename"] for d in docs.data}

    # Try embedding-based search first
    if settings.openai_api_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=settings.openai_api_key)
            emb_response = client.embeddings.create(
                model="text-embedding-3-small",
                input=[query[:8000]],
            )
            query_embedding = emb_response.data[0].embedding

            # Use pgvector similarity search via RPC
            results = sb.rpc("match_chunks", {
                "query_embedding": query_embedding,
                "match_count": top_k,
                "match_threshold": 0.3,
                "filter_document_ids": doc_ids,
            }).execute()

            if results.data:
                for r in results.data:
                    r["document_filename"] = doc_names.get(r["document_id"], "Documento")
                return results.data

        except Exception as e:
            print(f"    [Embedding search failed: {e}, falling back to keywords]")

    # Fallback: keyword search
    all_chunks = _load_all_chunks(company_id, report_year)
    if not all_chunks:
        return []

    stopwords = {"para", "como", "mais", "sobre", "qual", "quais", "pela", "pelo",
                 "seus", "suas", "esse", "essa", "esses", "esta", "este", "sido",
                 "cada", "ainda", "mesmo", "entre", "sendo", "outros", "outras",
                 "muito", "pode", "deve", "onde", "apos", "forma", "tipo", "anos",
                 "possui", "empresa", "tema", "seguintes", "temas", "relacionada"}
    query_words = {w for w in query.lower().split() if len(w) > 3 and w not in stopwords}

    scored = []
    for chunk in all_chunks:
        content_lower = chunk["content"].lower()
        word_overlap = sum(1 for w in query_words if w in content_lower)
        if word_overlap > 0:
            scored.append((word_overlap, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item[1] for item in scored[:top_k]]


def ask_agent_batch(dimension: str, questions: list[dict], context_chunks: list[dict]) -> list[dict]:
    """Ask a specialized ESG agent to answer a BATCH of questions based on document chunks.

    Uses hybrid model routing: simple factual questions go to the lightweight model,
    complex reasoning questions go to the more capable model.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return [_empty_answer(q) for q in questions]

    # Check if hybrid mode is enabled
    hybrid_enabled = bool(settings.openai_model_simple and settings.openai_model_complex)

    if not hybrid_enabled:
        # Single model mode — send all to the default model
        model = settings.openai_model
        print(f"    [Model] {model} (single mode, {len(questions)} questions)")
        answers = _call_llm_batch(dimension, questions, context_chunks, model)
        return _reorder_and_fill(questions, answers, dimension, context_chunks)

    # --- Hybrid mode: classify and split questions ---
    simple_qs = []
    complex_qs = []
    for q in questions:
        complexity = classify_question_complexity(q["question_text"])
        if complexity == "simple":
            simple_qs.append(q)
        else:
            complex_qs.append(q)

    simple_model = settings.openai_model_simple
    complex_model = settings.openai_model_complex
    print(f"    [Hybrid] {len(simple_qs)} simple → {simple_model} | {len(complex_qs)} complex → {complex_model}")

    all_answers = []

    if simple_qs:
        simple_answers = _call_llm_batch(dimension, simple_qs, context_chunks, simple_model)
        all_answers.extend(simple_answers)

    if complex_qs:
        complex_answers = _call_llm_batch(dimension, complex_qs, context_chunks, complex_model)
        all_answers.extend(complex_answers)

    return _reorder_and_fill(questions, all_answers, dimension, context_chunks)


def _normalize_qid(qid: str) -> str:
    """Normalize question_id for matching: strip, lowercase."""
    return str(qid).strip().lower()


def _reorder_and_fill(
    questions: list[dict],
    all_answers: list[dict],
    dimension: str,
    context_chunks: list[dict],
) -> list[dict]:
    """Re-order answers to match question order, retry missing ones."""
    settings = get_settings()

    # Build answer map with normalized keys
    answer_map: dict[str, dict] = {}
    for a in all_answers:
        raw_id = a.get("question_id", "")
        norm_id = _normalize_qid(raw_id)
        answer_map[norm_id] = a

    ordered = []
    missing_qs = []
    for q in questions:
        q_norm = _normalize_qid(q["question_id"])
        ans = answer_map.get(q_norm)

        # Fuzzy match fallback
        if not ans:
            for ak, av in answer_map.items():
                if q_norm in ak or ak in q_norm:
                    ans = av
                    break

        if ans:
            ans["question_id"] = q["question_id"]
            ordered.append(ans)
        else:
            missing_qs.append(q)
            ordered.append(None)  # placeholder

    # Retry missing questions individually
    if missing_qs:
        pct = len(missing_qs) / len(questions) * 100
        print(f"    ⚠️ {len(missing_qs)}/{len(questions)} questions unanswered ({pct:.0f}%), retrying...")
        model = settings.openai_model  # Use the most reliable model for retries
        retry_answers = _call_llm_batch(dimension, missing_qs, context_chunks, model)

        # Build retry map
        retry_map: dict[str, dict] = {}
        for a in retry_answers:
            retry_map[_normalize_qid(a.get("question_id", ""))] = a

        # Fill placeholders
        still_missing = 0
        for i, (slot, q) in enumerate(zip(ordered, questions)):
            if slot is None:
                q_norm = _normalize_qid(q["question_id"])
                retried = retry_map.get(q_norm)
                if not retried:
                    for rk, rv in retry_map.items():
                        if q_norm in rk or rk in q_norm:
                            retried = rv
                            break
                if retried:
                    retried["question_id"] = q["question_id"]
                    ordered[i] = retried
                else:
                    ordered[i] = _empty_answer(q)
                    still_missing += 1

        if still_missing:
            print(f"    ❌ {still_missing} questions still unanswered after retry")
        else:
            print(f"    ✅ All {len(missing_qs)} missing questions recovered on retry")
    
    return ordered


def _build_user_prompt(questions: list[dict], context_text: str) -> str:
    """Build the user prompt for the LLM call."""
    questions_text = "\n".join(
        f"{i+1}. [ID: {q['question_id']}] {_strip_qid_prefix(q['question_text'], q['question_id'])}"
        for i, q in enumerate(questions)
    )

    return f"""Com base nos seguintes trechos de documentos corporativos, responda a TODAS as {len(questions)} perguntas abaixo.
IMPORTANTE: Você DEVE responder TODAS as {len(questions)} perguntas. Retorne exatamente {len(questions)} objetos no array.

## Trechos dos Documentos:

{context_text}

## Perguntas ({len(questions)} perguntas - responda TODAS):

{questions_text}

## REGRA CRÍTICA SOBRE O CAMPO "justification":
O campo justification DEVE conter APENAS o trecho COPIADO E COLADO do documento, entre aspas duplas.
NÃO escreva nenhuma interpretação, análise ou resumo próprio.

ERRADO (interpretação — PROIBIDO):
  "justification": "A empresa possui inventário de emissões GEE e reporta anualmente ao CDP."

CERTO (citação literal — OBRIGATÓRIO):
  "justification": "\\"Em 2024, a Companhia realizou seu inventário de emissões de GEE conforme o Protocolo GHG, abrangendo os escopos 1, 2 e 3, com verificação externa pela Bureau Veritas.\\""

Se não encontrar trecho relevante nos documentos, use:
  "justification": "Informação não encontrada nos documentos analisados."

## Formato de Resposta OBRIGATORIO (JSON):
Retorne um JSON com key "answers" contendo um array com exatamente {len(questions)} entradas, uma para cada pergunta, na mesma ordem:
{{
  "answers": [
    {{
      "question_id": "1.1.1",
      "answer": "Sim",
      "justification": "\\"Trecho copiado literalmente do documento fonte.\\"",
      "source_reference": "Relatorio ESG 2024.pdf, p.45",
      "improvement_points": null,
      "confidence_score": 0.85
    }}
  ]
}}

Regras:
- answer DEVE ser exatamente "Sim", "Nao" ou "N/A"
- justification = citacao LITERAL entre aspas duplas. Copie exatamente como esta no documento. Maximo 3 frases.

## REGRA CRITICA PARA source_reference (OBRIGATORIO):
- source_reference DEVE conter o NOME EXATO do arquivo conforme aparece no cabecalho [FONTE: ...] dos trechos acima + o numero da pagina
- Formato OBRIGATORIO: "NomeDoArquivo.pdf, p.XX" (copie o nome exato do cabecalho [FONTE:])
- Se o trecho nao tem pagina, use apenas o nome do arquivo: "NomeDoArquivo.pdf"
- Se a evidencia vem de MULTIPLOS documentos, liste todos: "Relatorio ESG 2024.pdf, p.12; Politica Ambiental.pdf, p.3"
- NUNCA use termos genericos como "Documentos analisados", "Trechos fornecidos" ou "N/A" no source_reference
- Se NAO encontrou evidencia, use: "Nenhuma evidencia encontrada nos documentos"

- Se encontrou evidencia INDIRETA (a empresa menciona resultados ou acoes que implicam a pratica), responda "Sim" com confidence_score medio (0.4-0.6)
- Se NAO encontrou NENHUMA evidencia direta ou indireta, responda "Nao" com justification "Informacao nao encontrada nos documentos analisados" e confidence_score baixo
- N/A quando: (1) pergunta condicional cuja condicao-pai nao foi atendida, (2) tema nao se aplica ao setor, (3) duvida entre Nao e N/A
- PERGUNTAS CONDICIONAIS: Se uma pergunta X.Y.Z foi respondida "Nao", suas sub-perguntas X.Y.Z.W devem ser "N/A" (nao "Nao")
- Na duvida entre Nao e Sim com evidencia parcial, prefira Sim com confidence_score baixo"""


def _call_llm_batch(dimension: str, questions: list[dict], context_chunks: list[dict], model: str) -> list[dict]:
    """Core LLM call: sends a batch of questions to the specified model and returns parsed answers."""
    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    system_prompt = AGENT_PROMPTS.get(dimension, AGENT_PROMPTS["environmental"])

    context_parts = []
    for i, chunk in enumerate(context_chunks[:20], 1):
        source = chunk.get("document_filename", "Documento")
        page = chunk.get("page_number")
        page_range = chunk.get("page_range")
        if page_range and len(page_range) > 1:
            page_info = f", páginas {page_range[0]}-{page_range[-1]}"
        elif page:
            page_info = f", p.{page}"
        else:
            page_info = ""
        header = f"[FONTE: {source}{page_info}]"
        context_parts.append(f"{header}\n{chunk['content'][:1200]}")

    context_text = "\n\n---\n\n".join(context_parts) if context_parts else "Nenhum trecho relevante encontrado."
    user_prompt = _build_user_prompt(questions, context_text)

    max_retries = 3
    for attempt in range(max_retries):
        try:
            # GPT-5.x requires 'max_completion_tokens' instead of 'max_tokens'
            token_param = (
                {"max_completion_tokens": 16384}
                if model.startswith("gpt-5")
                else {"max_tokens": 16384}
            )
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                **token_param,
            )

            raw = json.loads(response.choices[0].message.content)
            answers = raw if isinstance(raw, list) else raw.get("answers", raw.get("results", raw.get("respostas", [raw])))

            if not isinstance(answers, list):
                answers = [answers]

            got = len(answers)
            expected = len(questions)
            if got < expected:
                print(f"    ⚠️ Got {got}/{expected} answers from {model} — {expected - got} MISSING")
                # Log which question_ids are missing
                answered_ids = {_normalize_qid(a.get('question_id', '')) for a in answers}
                for q in questions:
                    if _normalize_qid(q['question_id']) not in answered_ids:
                        print(f"       Missing: {q['question_id']}")
            else:
                print(f"    -> Got {got}/{expected} answers from {model}")

            # Don't fill here — let _reorder_and_fill handle missing answers with retry
            return answers

        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "rate_limit" in error_str:
                wait_time = 15 * (attempt + 1)
                print(f"    Rate limit hit on {model}, waiting {wait_time}s (attempt {attempt+1}/{max_retries})...")
                import time
                time.sleep(wait_time)
                continue

            # Model not found — fallback to the default model
            if "404" in error_str or "model_not_found" in error_str or "does not exist" in error_str:
                fallback = settings.openai_model
                if model != fallback:
                    print(f"    ⚠ Model '{model}' not found, falling back to '{fallback}'")
                    return _call_llm_batch(dimension, questions, context_chunks, fallback)

            print(f"Error calling OpenAI ({model}): {e}")
            return [_empty_answer(q) for q in questions]

    print(f"    Max retries reached for {model}, returning empty answers")
    return [_empty_answer(q) for q in questions]


def _strip_qid_prefix(text: str, qid: str) -> str:
    """Remove question_id prefix from question text if present."""
    if text.startswith(qid):
        text = text[len(qid):].lstrip(" .")
    return text


def _empty_answer(q: dict) -> dict:
    return {
        "question_id": q["question_id"],
        "answer": "N/A",
        "justification": "Não foi possível processar esta pergunta.",
        "source_reference": None,
        "improvement_points": None,
        "confidence_score": 0.0,
    }


def calculate_theme_score(answers_for_theme: list[dict], questions_for_theme: list[dict]) -> float:
    """Calculate the score for a theme based on answers.
    Each correct answer = 10 points. Score = sum(correct) / total * 10
    """
    if not answers_for_theme:
        return 0.0

    total_weight = 0
    weighted_sum = 0

    q_map = {q["question_id"]: q for q in questions_for_theme}

    for ans in answers_for_theme:
        q = q_map.get(ans.get("question_id"))
        if not q:
            continue

        if ans.get("answer") == "N/A":
            continue

        expected = q.get("expected_answer", "Sim")
        score = 10.0 if ans.get("answer") == expected else 0.0
        total_weight += 1
        weighted_sum += score

    if total_weight == 0:
        return 0.0

    return round(weighted_sum / total_weight, 2)


def get_rating(score: float) -> str:
    if score >= 8.0:
        return "A"
    elif score >= 6.0:
        return "B"
    elif score >= 4.0:
        return "C"
    elif score >= 2.0:
        return "D"
    else:
        return "E"


def run_full_analysis(analysis_id: str, company_id: str, report_year: int, sector: str):
    """Run the full ESG analysis: for each theme, search → agent → score → store."""
    sb = get_supabase()

    try:
        sb.table("analyses").update({"started_at": datetime.now(timezone.utc).isoformat()}).eq("id", analysis_id).execute()

        themes = sb.table("esg_themes").select("*").order("display_order").execute().data

        materiality = sb.table("materiality_weights").select("*").eq("sector", sector).execute().data
        mat_map = {m["theme_id"]: m["weight"] for m in materiality}

        dim_scores = {"environmental": [], "social": [], "governance": []}

        for theme in themes:
            theme_id = theme["id"]
            dimension = theme["dimension"]
            theme_name = theme["name"]

            questions = sb.table("esg_questions").select("*").eq("theme_id", theme_id).order("display_order").execute().data

            if not questions:
                print(f"  [{theme_name}] No questions, skipping")
                continue

            print(f"\n  [{theme_name}] {len(questions)} questions ({dimension})")

            # Build search query from theme name + key question terms
            search_terms = theme_name
            for q in questions[:5]:
                # Extract key nouns from questions
                words = q["question_text"].split()
                key_words = [w for w in words if len(w) > 5][:3]
                search_terms += " " + " ".join(key_words)

            context_chunks = semantic_search(
                search_terms,
                company_id,
                report_year,
                top_k=20,
            )
            print(f"    Found {len(context_chunks)} relevant chunks")

            # Smaller batch size (5) for more reliable responses
            batch_size = 5
            all_agent_answers = []
            for i in range(0, len(questions), batch_size):
                batch = questions[i:i + batch_size]
                print(f"    Batch {i//batch_size + 1}/{(len(questions)-1)//batch_size + 1} ({len(batch)} questions)")
                agent_answers = ask_agent_batch(dimension, batch, context_chunks)
                all_agent_answers.extend(agent_answers)
                # Rate limit: wait between batches
                import time
                time.sleep(3)

            # Build question lookup with flexible matching
            q_map = {q["question_id"]: q for q in questions}
            answer_records = []
            matched_count = 0

            for ans in all_agent_answers:
                q_id_str = str(ans.get("question_id", "")).strip()
                q = q_map.get(q_id_str)

                # Fallback: try with/without leading zeros, or normalized
                if not q:
                    for qk, qv in q_map.items():
                        if qk.strip() == q_id_str or q_id_str in qk:
                            q = qv
                            break

                if not q:
                    continue

                answer_val = ans.get("answer", "N/A")
                # Normalize common variations
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
                answer_records.append(record)
                matched_count += 1

            print(f"    Matched {matched_count}/{len(all_agent_answers)} answers to DB questions")

            if answer_records:
                for batch_start in range(0, len(answer_records), 50):
                    batch = answer_records[batch_start:batch_start + 50]
                    sb.table("answers").insert(batch).execute()

            theme_score = calculate_theme_score(all_agent_answers, questions)
            theme_rating = get_rating(theme_score)
            print(f"    Score: {theme_score:.2f} ({theme_rating})")

            mat_weight = mat_map.get(theme_id, 1.0)

            sb.table("theme_scores").insert({
                "analysis_id": analysis_id,
                "theme_id": theme_id,
                "raw_score": theme_score,
                "weighted_score": theme_score * mat_weight,
                "rating": theme_rating,
            }).execute()

            dim_scores[dimension].append({
                "score": theme_score,
                "weight": mat_weight,
            })

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

        sb.table("analyses").update({
            "status": "completed",
            "overall_score": round(overall, 2),
            "overall_rating": get_rating(overall),
            "environmental_score": round(final_scores.get("environmental", 0), 2),
            "social_score": round(final_scores.get("social", 0), 2),
            "governance_score": round(final_scores.get("governance", 0), 2),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", analysis_id).execute()

    except Exception as e:
        print(f"Analysis error: {e}")
        sb.table("analyses").update({
            "status": "error",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", analysis_id).execute()
        raise
