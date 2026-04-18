"""Test: Does the Suzano report have enough content for all 26 ESG themes?"""
from app.database import get_supabase
from app.services.esg_agents import semantic_search, ask_agent_batch

sb = get_supabase()

# Get the Suzano analysis info
company_id = "dc190688-e2bf-4bb5-91f9-c79ff383fbb5"
report_year = 2025

# 1. Check document & chunks
docs = sb.table("documents").select("id, filename, status, chunk_count, page_count").eq(
    "company_id", company_id
).eq("report_year", report_year).execute()

print("=" * 60)
print("DOCUMENTO DA SUZANO")
print("=" * 60)
for d in docs.data:
    print(f"  Arquivo: {d['filename']}")
    print(f"  Status: {d['status']}")
    print(f"  Chunks: {d.get('chunk_count', '?')}")
    print(f"  Paginas: {d.get('page_count', '?')}")

# Count total chunks
ready_doc_ids = [d["id"] for d in docs.data if d["status"] == "ready"]
total_chunks = 0
for doc_id in ready_doc_ids:
    chunks = sb.table("chunks").select("id", count="exact").eq("document_id", doc_id).execute()
    total_chunks += chunks.count

print(f"\n  Total chunks no banco: {total_chunks}")

# 2. Check all themes and search coverage
themes = sb.table("esg_themes").select("*").order("display_order").execute().data
print(f"\n{'=' * 60}")
print(f"COBERTURA POR TEMA ({len(themes)} temas)")
print(f"{'=' * 60}")

good_coverage = 0
partial_coverage = 0
no_coverage = 0

for theme in themes:
    questions = sb.table("esg_questions").select("id, question_id").eq(
        "theme_id", theme["id"]
    ).execute().data
    
    # Search for relevant chunks
    chunks = semantic_search(theme["name"], company_id, report_year, top_k=10)
    
    # Check quality - does any chunk actually mention related keywords?
    status_icon = ""
    if len(chunks) >= 5:
        status_icon = "OK"
        good_coverage += 1
    elif len(chunks) >= 1:
        status_icon = "PARCIAL"
        partial_coverage += 1
    else:
        status_icon = "SEM DADOS"
        no_coverage += 1
    
    dim_label = {"environmental": "AMB", "social": "SOC", "governance": "GOV"}[theme["dimension"]]
    print(f"  [{dim_label}] {theme['name']:40s} | {len(questions):2d} perguntas | {len(chunks):2d} chunks | {status_icon}")

print(f"\n{'=' * 60}")
print(f"RESUMO")
print(f"{'=' * 60}")
print(f"  Boa cobertura (5+ chunks): {good_coverage}/{len(themes)} temas")
print(f"  Cobertura parcial:         {partial_coverage}/{len(themes)} temas")
print(f"  Sem dados:                 {no_coverage}/{len(themes)} temas")

# 3. Test one question from each dimension
print(f"\n{'=' * 60}")
print(f"TESTE DE RESPOSTA (1 pergunta por dimensao)")
print(f"{'=' * 60}")

for dim in ["environmental", "social", "governance"]:
    dim_themes = [t for t in themes if t["dimension"] == dim]
    if not dim_themes:
        continue
    
    theme = dim_themes[0]
    questions = sb.table("esg_questions").select("*").eq(
        "theme_id", theme["id"]
    ).order("display_order").limit(1).execute().data
    
    if not questions:
        continue
    
    chunks = semantic_search(theme["name"], company_id, report_year, top_k=10)
    
    print(f"\n  [{dim.upper()}] Tema: {theme['name']}")
    print(f"  Pergunta: {questions[0]['question_id']} - {questions[0]['question_text'][:80]}...")
    print(f"  Chunks encontrados: {len(chunks)}")
    
    if chunks:
        result = ask_agent_batch(dim, [questions[0]], chunks[:10])
        if result:
            ans = result[0]
            print(f"  Resposta: {ans.get('answer')} (confianca: {ans.get('confidence_score')})")
            print(f"  Justificativa: {ans.get('justification', '')[:120]}...")
        else:
            print(f"  ERRO: Sem resposta do agente")
    else:
        print(f"  AVISO: Nenhum chunk relevante encontrado")

print(f"\n{'=' * 60}")
print(f"CONCLUSAO")
print(f"{'=' * 60}")
if no_coverage == 0:
    print("  ✅ O documento tem cobertura para TODOS os temas. A analise vai funcionar!")
elif no_coverage <= 3:
    print(f"  ⚠️ {no_coverage} tema(s) sem dados. A analise vai funcionar, mas esses temas terao score baixo.")
else:
    print(f"  ❌ {no_coverage} temas sem dados. O documento e insuficiente para uma analise completa.")
    print("  Considere adicionar mais documentos (relatorio completo, formulario de referencia, etc).")
