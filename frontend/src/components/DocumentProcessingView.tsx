/**
 * DocumentProcessingView — SSE-powered real-time document processing visualization.
 *
 * Supports two modes:
 *   - PDF upload (file prop)    → POST /documents/upload-stream
 *   - URL ingestion (url prop)  → POST /documents/add-url-stream (JSON body)
 *
 * Shows animated progress through pipeline stages with guaranteed minimum
 * display duration per stage so the animation is always visible (~20s minimum).
 *
 * Stages:
 * 0. Downloading (URL mode only)
 * 1. Parsing PDF/HTML pages
 * 2. Chunking text
 * 3. Storing in database
 * 4. Generating embeddings (the slow part — shows batch-by-batch progress)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  ScanSearch,
  Layers,
  Database,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Zap,
  Globe,
  Download,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────

interface StageInfo {
  id: string;
  label: string;
  icon: typeof FileText;
  color: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  detail?: string;
  progress?: number;
  stats?: Record<string, string | number>;
}

interface Props {
  file?: File | null;
  url?: string;
  customName?: string;
  companyId: string;
  reportYear: number;
  onComplete: () => void;
  onError: (msg: string) => void;
}

type ProcessingMode = 'pdf' | 'url';

// ─── Minimum visual durations per stage (ms) ─────────────────────────────
const MIN_STAGE_DURATION: Record<string, number> = {
  downloading: 3000,
  parsing:     4500,
  chunking:    4000,
  storing:     4000,
  embedding:   5000,
};

// Simulated sub-steps shown during minimum wait per stage
const STAGE_SUBSTEPS: Record<string, string[]> = {
  downloading: [
    'Conectando ao servidor...',
    'Baixando conteúdo da página...',
    'Detectando tipo de conteúdo...',
    'Download concluído. Preparando extração...',
  ],
  parsing: [
    'Inicializando leitor...',
    'Analisando estrutura do documento...',
    'Extraindo texto das páginas...',
    'Identificando tabelas e figuras...',
    'Consolidando conteúdo extraído...',
  ],
  chunking: [
    'Analisando estrutura semântica...',
    'Calculando limites de tokens...',
    'Dividindo em segmentos inteligentes...',
    'Otimizando sobreposição de chunks...',
    'Finalizando chunking...',
  ],
  storing: [
    'Preparando registros para inserção...',
    'Gravando chunks no banco de dados...',
    'Validando integridade dos dados...',
    'Indexando para busca vetorial...',
  ],
  embedding: [
    'Conectando com OpenAI API...',
    'Preparando batches de texto...',
    'Gerando vetores de embedding...',
    'Salvando embeddings no banco...',
  ],
};

// ─── Component ───────────────────────────────────────────────────────────

export default function DocumentProcessingView({ file, url, customName, companyId, reportYear, onComplete, onError }: Props) {
  const mode: ProcessingMode = url ? 'url' : 'pdf';

  const buildInitialStages = (): StageInfo[] => {
    const stages: StageInfo[] = [];
    if (mode === 'url') {
      stages.push({ id: 'downloading', label: 'Baixando conteúdo da URL', icon: Download, color: '#a78bfa', status: 'pending' });
    }
    stages.push(
      { id: 'parsing', label: mode === 'url' ? 'Extraindo texto do conteúdo' : 'Extraindo texto do PDF', icon: ScanSearch, color: '#3b82f6', status: 'pending' },
      { id: 'chunking', label: 'Dividindo em chunks', icon: Layers, color: '#8b5cf6', status: 'pending' },
      { id: 'storing', label: 'Salvando no banco', icon: Database, color: '#f59e0b', status: 'pending' },
      { id: 'embedding', label: 'Gerando embeddings', icon: Brain, color: '#00633a', status: 'pending' },
    );
    return stages;
  };

  const [stages, setStages] = useState<StageInfo[]>(buildInitialStages);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalStats, setFinalStats] = useState<Record<string, any> | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const startTime = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stageStartedAt = useRef<Record<string, number>>({});
  const pendingCompletes = useRef<Record<string, { stats: Record<string, string | number> }>>({});
  const pendingDone = useRef<{ data: Record<string, any> } | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const substepIdxRef = useRef<Record<string, number>>({});
  const documentIdRef = useRef<string | null>(null);

  // Display label
  const displayName = mode === 'url'
    ? (customName || url || 'URL')
    : (file?.name || '?');
  const displaySize = mode === 'url'
    ? (url || '')
    : `${((file?.size || 0) / 1024 / 1024).toFixed(1)} MB`;

  // Elapsed timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Update stage helper
  const updateStage = useCallback((stageId: string, updates: Partial<StageInfo>) => {
    setStages(prev => prev.map(s => s.id === stageId ? { ...s, ...updates } : s));
  }, []);

  // Smooth overall progress from stage weights
  const calcOverall = useCallback((stageId: string, stageProgress: number) => {
    const urlWeights: Record<string, { base: number; weight: number }> = {
      downloading: { base: 0,  weight: 10 },
      parsing:     { base: 10, weight: 15 },
      chunking:    { base: 25, weight: 15 },
      storing:     { base: 40, weight: 15 },
      embedding:   { base: 55, weight: 45 },
    };
    const pdfWeights: Record<string, { base: number; weight: number }> = {
      parsing:   { base: 0,  weight: 20 },
      chunking:  { base: 20, weight: 15 },
      storing:   { base: 35, weight: 15 },
      embedding: { base: 50, weight: 50 },
    };
    const weights = mode === 'url' ? urlWeights : pdfWeights;
    const w = weights[stageId];
    if (w) {
      setOverallProgress(w.base + (stageProgress / 100) * w.weight);
    }
  }, [mode]);

  // ─── Animated stage lifecycle manager ──────────────────────────────────
  useEffect(() => {
    const TICK = 200;

    const tick = () => {
      const now = Date.now();

      for (const [stageId, startedAt] of Object.entries(stageStartedAt.current)) {
        const minDuration = MIN_STAGE_DURATION[stageId] || 3000;
        const elapsed = now - startedAt;
        const visualPct = Math.min((elapsed / minDuration) * 100, 95);
        const substeps = STAGE_SUBSTEPS[stageId] || [];
        const substepIdx = Math.min(
          Math.floor((elapsed / minDuration) * substeps.length),
          substeps.length - 1
        );

        if (
          substeps.length > 0 &&
          (substepIdxRef.current[stageId] ?? -1) !== substepIdx
        ) {
          substepIdxRef.current[stageId] = substepIdx;
          updateStage(stageId, { detail: substeps[substepIdx] });
        }

        if (!pendingCompletes.current[stageId]) {
          if (stageId !== 'embedding') {
            updateStage(stageId, { progress: Math.round(visualPct) });
            calcOverall(stageId, visualPct);
          }
        }

        if (pendingCompletes.current[stageId] && elapsed >= minDuration) {
          const { stats } = pendingCompletes.current[stageId];
          updateStage(stageId, { status: 'complete', progress: 100, stats });
          calcOverall(stageId, 100);
          delete pendingCompletes.current[stageId];
          delete stageStartedAt.current[stageId];
          delete substepIdxRef.current[stageId];
        }
      }

      if (
        pendingDone.current &&
        Object.keys(pendingCompletes.current).length === 0 &&
        Object.keys(stageStartedAt.current).length === 0
      ) {
        const data = pendingDone.current.data;
        pendingDone.current = null;
        setIsDone(true);
        setOverallProgress(100);
        setCurrentStage(null);
        setFinalStats(data);
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => onComplete(), 5000);
        return;
      }

      animFrameRef.current = window.setTimeout(tick, TICK) as unknown as number;
    };

    animFrameRef.current = window.setTimeout(tick, TICK) as unknown as number;
    return () => {
      if (animFrameRef.current) clearTimeout(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── SSE connection ────────────────────────────────────────────────────
  // Uses AbortController to prevent React StrictMode double-mount from
  // sending two requests (which causes the second to delete the first's doc).
  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    const processSSE = async () => {
      try {
        let response: Response;

        if (mode === 'url') {
          response = await fetch('/api/documents/add-url-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: companyId,
              report_year: reportYear,
              url: url,
              custom_name: customName || null,
            }),
            signal,
          });
        } else {
          const formData = new FormData();
          formData.append('file', file!);
          formData.append('company_id', companyId);
          formData.append('report_year', reportYear.toString());

          response = await fetch('/api/documents/upload-stream', {
            method: 'POST',
            body: formData,
            signal,
          });
        }

        if (signal.aborted) return;

        if (!response.ok) {
          const text = await response.text();
          if (signal.aborted) return;
          setIsError(true);
          setErrorMessage(`Erro ${response.status}: ${text}`);
          if (timerRef.current) clearInterval(timerRef.current);
          if (animFrameRef.current) clearTimeout(animFrameRef.current);
          return;
        }

        setSseConnected(true);
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        const handleEvent = (eventType: string, data: any) => {
          if (signal.aborted) return;
          switch (eventType) {
            case 'stage:start':
              setCurrentStage(data.stage);
              updateStage(data.stage, { status: 'running', detail: data.label, progress: 0 });
              stageStartedAt.current[data.stage] = Date.now();
              if (data.document_id) documentIdRef.current = data.document_id;
              substepIdxRef.current[data.stage] = -1;
              break;

            case 'parsing:progress': {
              const minDur = MIN_STAGE_DURATION['parsing'] || 4500;
              const elapsedSinceStart = Date.now() - (stageStartedAt.current['parsing'] || Date.now());
              const visualPct = (elapsedSinceStart / minDur) * 100;
              if (data.percentage > visualPct) {
                updateStage('parsing', {
                  progress: data.percentage,
                  detail: `Página ${data.current_page} de ${data.total_pages}`,
                });
                calcOverall('parsing', data.percentage);
              }
              break;
            }

            case 'stage:complete': {
              const stats: Record<string, string | number> = {};
              if (data.stage === 'downloading') {
                stats['Tamanho'] = data.size_bytes
                  ? `${(data.size_bytes / 1024).toFixed(0)} KB`
                  : '—';
                stats['Tipo'] = (data.content_type || '—').toUpperCase();
              } else if (data.stage === 'parsing') {
                stats['Páginas'] = data.pages;
                stats['Caracteres'] = data.text_length?.toLocaleString() || '—';
              } else if (data.stage === 'chunking') {
                stats['Chunks'] = data.total_chunks;
                stats['Média tokens'] = data.avg_tokens;
              } else if (data.stage === 'storing') {
                stats['Salvos'] = data.total_stored;
              } else if (data.stage === 'embedding') {
                stats['Embeddings'] = data.total_embedded;
              }

              const startedAt = stageStartedAt.current[data.stage];
              const minDuration = MIN_STAGE_DURATION[data.stage] || 3000;
              const elapsed = startedAt ? Date.now() - startedAt : Infinity;

              if (elapsed >= minDuration) {
                updateStage(data.stage, { status: 'complete', progress: 100, stats });
                calcOverall(data.stage, 100);
                delete stageStartedAt.current[data.stage];
                delete substepIdxRef.current[data.stage];
              } else {
                pendingCompletes.current[data.stage] = { stats };
              }
              break;
            }

            case 'storing:progress': {
              const minDur = MIN_STAGE_DURATION['storing'] || 4000;
              const elapsedSinceStart = Date.now() - (stageStartedAt.current['storing'] || Date.now());
              const visualPct = (elapsedSinceStart / minDur) * 100;
              if (data.percentage > visualPct) {
                updateStage('storing', {
                  progress: data.percentage,
                  detail: `${data.stored} de ${data.total} chunks`,
                });
                calcOverall('storing', data.percentage);
              }
              break;
            }

            case 'embedding:progress':
              updateStage('embedding', {
                progress: data.percentage,
                detail: `Batch ${data.batch}/${data.total_batches} — ${data.embedded}/${data.total}`,
              });
              calcOverall('embedding', data.percentage);
              break;

            case 'embedding:rate_limit':
              updateStage('embedding', {
                detail: '⏳ Rate limit — aguardando 30s...',
              });
              break;

            case 'processing:complete':
              pendingDone.current = { data };
              break;

            case 'processing:error':
              setIsError(true);
              setErrorMessage(data.error || 'Erro desconhecido');
              setCurrentStage(null);
              if (timerRef.current) clearInterval(timerRef.current);
              if (animFrameRef.current) clearTimeout(animFrameRef.current);
              break;
          }
        };

        while (true) {
          if (signal.aborted) { reader.cancel(); return; }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventType) {
              try {
                const data = JSON.parse(line.slice(6).trim());
                handleEvent(eventType, data);
              } catch {}
              eventType = '';
            }
          }
        }

        if (signal.aborted) return;

        // Stream ended — fallback check
        const docId = documentIdRef.current;
        if (!pendingDone.current && !isError && docId) {
          console.log('[SSE] Stream ended without explicit complete/error. Checking document status for', docId);
          try {
            const checkRes = await fetch(`/api/documents/${docId}`, { signal });
            if (checkRes.ok) {
              const docData = await checkRes.json();
              if (docData.status === 'ready') {
                pendingDone.current = { data: {
                  document_id: docData.id,
                  filename: docData.filename,
                  page_count: docData.page_count || 0,
                  chunk_count: docData.chunk_count || 0,
                  embedded_count: docData.chunk_count || 0,
                  status: 'ready',
                }};
              }
            }
          } catch (pollErr) {
            if (!signal.aborted) console.warn('[SSE] Could not verify document status:', pollErr);
          }
        }
      } catch (e: any) {
        if (signal.aborted || e?.name === 'AbortError') return; // expected on StrictMode unmount
        console.error('SSE connection error:', e);
        setIsError(true);
        setErrorMessage(`Erro de conexão: ${String(e)}. Verifique se o backend está rodando em localhost:8000`);
        if (timerRef.current) clearInterval(timerRef.current);
        if (animFrameRef.current) clearTimeout(animFrameRef.current);
      }
    };

    processSSE();

    return () => {
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in" style={{
      padding: '32px', borderRadius: '20px',
      background: 'var(--color-surface-light)',
      border: `1px solid ${isDone ? 'rgba(0,99,58,0.3)' : isError ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {!isDone && !isError && (
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: mode === 'url' ? '#a78bfa' : '#3b82f6',
              boxShadow: `0 0 8px ${mode === 'url' ? 'rgba(167,139,250,0.6)' : 'rgba(59,130,246,0.6)'}`,
              animation: 'pulseGlow 1.5s ease-in-out infinite',
            }} />
          )}
          {isDone && <CheckCircle2 style={{ width: '20px', height: '20px', color: 'var(--color-primary)' }} />}
          {isError && <XCircle style={{ width: '20px', height: '20px', color: '#ef4444' }} />}
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              {isDone ? '✅ Documento pronto!' : isError ? '❌ Erro no processamento' : mode === 'url' ? '🌐 Processando URL...' : '📄 Processando documento...'}
            </h3>
            <p style={{
              fontSize: '12px', color: 'var(--color-text-muted)', margin: '2px 0 0',
              maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {displayName} · {displaySize}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-faint)' }}>
          <Clock style={{ width: '12px', height: '12px' }} />
          {formatTime(elapsed)}
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Progresso geral
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text)' }}>
            {overallProgress.toFixed(0)}%
          </span>
        </div>
        <div style={{
          height: '8px', borderRadius: '4px',
          background: 'var(--color-surface-hover)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: '4px',
            width: `${overallProgress}%`,
            background: isDone
              ? 'linear-gradient(90deg, var(--color-primary), var(--color-primary-dark))'
              : isError
                ? '#ef4444'
                : mode === 'url'
                  ? 'linear-gradient(90deg, #a78bfa, #3b82f6, var(--color-primary))'
                  : 'linear-gradient(90deg, #3b82f6, #8b5cf6, var(--color-primary))',
            backgroundSize: isDone ? '100%' : '300% 100%',
            animation: isDone ? 'none' : 'gradientShift 3s ease infinite',
            transition: 'width 0.6s ease-out',
          }} />
        </div>
      </div>

      {/* Stages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isActive = stage.status === 'running';
          const isComplete = stage.status === 'complete';

          return (
            <div
              key={stage.id}
              className={stage.status !== 'pending' ? 'animate-fade-in' : ''}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '14px 18px', borderRadius: '12px',
                background: isActive
                  ? `${stage.color}10`
                  : isComplete
                    ? 'rgba(0,99,58,0.04)'
                    : 'var(--color-surface-lighter)',
                border: `1px solid ${isActive ? stage.color + '30' : isComplete ? 'rgba(0,99,58,0.15)' : 'var(--color-border)'}`,
                transition: 'all 0.4s ease',
                opacity: stage.status === 'pending' ? 0.4 : 1,
              }}
            >
              {/* Icon */}
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                background: isComplete
                  ? 'rgba(0,99,58,0.15)'
                  : isActive
                    ? `${stage.color}20`
                    : 'var(--color-surface-lighter)',
                transition: 'background 0.3s ease',
              }}>
                {isComplete ? (
                  <CheckCircle2 style={{ width: '18px', height: '18px', color: 'var(--color-primary)' }} />
                ) : isActive ? (
                  <Icon style={{ width: '18px', height: '18px', color: stage.color }} />
                ) : (
                  <Icon style={{ width: '18px', height: '18px', color: 'var(--color-text-faint)' }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '13px', fontWeight: 600,
                    color: isComplete ? 'var(--color-primary)' : isActive ? 'var(--color-text)' : 'var(--color-text-faint)',
                    transition: 'color 0.3s ease',
                  }}>
                    {stage.label}
                  </span>
                  {isActive && (
                    <Loader2 style={{
                      width: '13px', height: '13px', color: stage.color,
                      animation: 'spin 1s linear infinite',
                    }} />
                  )}
                </div>
                {stage.detail && stage.status !== 'pending' && (
                  <p style={{
                    fontSize: '11px', color: 'var(--color-text-muted)', margin: '2px 0 0',
                    transition: 'opacity 0.3s ease',
                  }}>
                    {stage.detail}
                  </p>
                )}
                {/* Stage mini progress bar */}
                {isActive && stage.progress != null && (
                  <div style={{
                    height: '3px', borderRadius: '2px', marginTop: '6px',
                    background: 'var(--color-surface-hover)', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${stage.progress}%`,
                      height: '100%', borderRadius: '2px',
                      background: stage.color,
                      transition: 'width 0.5s ease-out',
                    }} />
                  </div>
                )}
              </div>

              {/* Stats */}
              {isComplete && stage.stats && (
                <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
                  {Object.entries(stage.stats).map(([k, v]) => (
                    <div key={k} style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>{v}</p>
                      <p style={{ fontSize: '9px', color: 'var(--color-text-faint)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Active percentage */}
              {isActive && stage.progress != null && (
                <span style={{ fontSize: '12px', fontWeight: 700, color: stage.color, flexShrink: 0 }}>
                  {stage.progress.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Final Stats */}
      {isDone && finalStats && (
        <div className="animate-fade-in-scale" style={{
          marginTop: '16px', padding: '16px 20px', borderRadius: '12px',
          background: 'rgba(0,99,58,0.06)', border: '1px solid rgba(0,99,58,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-primary)', margin: 0 }}>{finalStats.page_count}</p>
            <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Páginas</p>
          </div>
          <div style={{ width: '1px', height: '32px', background: 'var(--color-border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-primary)', margin: 0 }}>{finalStats.chunk_count}</p>
            <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Chunks</p>
          </div>
          <div style={{ width: '1px', height: '32px', background: 'var(--color-border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-primary)', margin: 0 }}>{finalStats.embedded_count}</p>
            <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Embeddings</p>
          </div>
          <div style={{ width: '1px', height: '32px', background: 'var(--color-border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-primary)', margin: 0 }}>{formatTime(elapsed)}</p>
            <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tempo</p>
          </div>
        </div>
      )}

      {/* Error Panel */}
      {isError && errorMessage && (
        <div className="animate-fade-in" style={{
          marginTop: '16px', padding: '20px', borderRadius: '12px',
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
            <XCircle style={{ width: '20px', height: '20px', color: '#ef4444', flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444', margin: 0 }}>Erro no processamento</p>
              <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
                {errorMessage}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => onError(errorMessage)}
              style={{
                padding: '8px 20px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                background: 'var(--color-surface-lighter)', border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)', cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface-lighter)'}
            >
              ← Voltar
            </button>
          </div>
        </div>
      )}

      {/* Completed — auto-return info */}
      {isDone && (
        <p className="animate-fade-in" style={{
          marginTop: '12px', textAlign: 'center',
          fontSize: '11px', color: 'var(--color-text-faint)',
        }}>
          Voltando automaticamente em alguns segundos...
        </p>
      )}
    </div>
  );
}
