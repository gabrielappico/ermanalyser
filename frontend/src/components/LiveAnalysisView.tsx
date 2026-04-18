/**
 * LiveAnalysisView — Real-time SSE-powered ESG analysis visualization.
 *
 * Architecture: The backend analysis runs independently (background task).
 * The frontend subscribes via SSE to stream progress from the database.
 * If the connection drops, the frontend automatically reconnects with
 * exponential backoff, picking up from where it left off (last_seen_count).
 *
 * Connects to either:
 * - POST /analysis/run-stream → starts analysis + subscribes to progress
 * - GET /analysis/subscribe/{id}?last_seen=N → reconnects to running analysis
 * - GET /analysis/replay/{id} → replay of completed analysis
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Leaf,
  Users,
  Shield,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  Activity,
  Zap,
  Trophy,
  Download,
  RotateCcw,
  Loader2,
  Radio,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { exportAnalysis, cancelAnalysis } from '../api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuestionEvent {
  question_id: string;
  question_text: string;
  answer: string;
  confidence_score: number;
  justification: string;
  source_reference: string | null;
  theme_name: string;
  dimension: string;
  answered_count: number;
  total_questions: number;
}

interface ThemeData {
  theme_id: string;
  theme_name: string;
  dimension: string;
  question_count: number;
  questions: QuestionEvent[];
  score?: number;
  rating?: string;
  completed: boolean;
}

interface DimensionData {
  dimension: string;
  label: string;
  themes: ThemeData[];
  score?: number;
}

interface FinalScores {
  overall_score: number;
  overall_rating: string;
  environmental_score: number;
  social_score: number;
  governance_score: number;
  total_answered: number;
}

interface Props {
  mode: 'live' | 'replay';
  companyId?: string;
  reportYear?: number;
  analysisId?: string;
  companyName: string;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DIM_CONFIG: Record<string, { label: string; icon: typeof Leaf; color: string; bg: string; gradient: string }> = {
  environmental: {
    label: 'Ambiental',
    icon: Leaf,
    color: '#00633a',
    bg: 'rgba(0,99,58,0.08)',
    gradient: 'linear-gradient(135deg, rgba(0,99,58,0.15), rgba(0,99,58,0.03))',
  },
  social: {
    label: 'Social',
    icon: Users,
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.03))',
  },
  governance: {
    label: 'Governança',
    icon: Shield,
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.03))',
  },
};

const RATING_COLORS: Record<string, string> = {
  A: '#00633a', B: '#007e4c', C: '#eab308', D: '#f97316', E: '#ef4444',
};

// Reconnection config
const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

// ─── Component ───────────────────────────────────────────────────────────────

export default function LiveAnalysisView({ mode, companyId, reportYear, analysisId, companyName, onClose }: Props) {
  const [status, setStatus] = useState<'connecting' | 'running' | 'completed' | 'error' | 'reconnecting'>('connecting');
  const [currentDimension, setCurrentDimension] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Record<string, DimensionData>>({});
  const [answeredCount, setAnsweredCount] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [finalScores, setFinalScores] = useState<FinalScores | null>(null);
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [latestQuestion, setLatestQuestion] = useState<QuestionEvent | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentThemeRef = useRef<string | null>(null);
  const analysisIdRef = useRef<string | null>(analysisId || null);
  const answeredCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);
  const receivedCompleteRef = useRef(false);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  const toggleTheme = (themeId: string) => {
    setExpandedThemes(prev => {
      const next = new Set(prev);
      if (next.has(themeId)) next.delete(themeId);
      else next.add(themeId);
      return next;
    });
  };

  // ─── SSE Event Handler ──────────────────────────────────────────────────

  const handleSSEEvent = useCallback((event: string, rawData: string) => {
    let data: any;
    try { data = JSON.parse(rawData); } catch { return; }

    switch (event) {
      case 'analysis:start':
        setTotalQuestions(data.total_questions || 380);
        if (data.analysis_id) analysisIdRef.current = data.analysis_id;
        setStatus('running');
        setReconnectAttempt(0);
        break;

      case 'dimension:start':
        setCurrentDimension(data.dimension);
        setDimensions(prev => ({
          ...prev,
          [data.dimension]: prev[data.dimension] || {
            dimension: data.dimension,
            label: data.label,
            themes: [],
          },
        }));
        break;

      case 'theme:start': {
        const newTheme: ThemeData = {
          theme_id: data.theme_id,
          theme_name: data.theme_name,
          dimension: data.dimension,
          question_count: data.question_count,
          questions: [],
          completed: false,
        };
        currentThemeRef.current = data.theme_id;
        setExpandedThemes(prev => new Set([...prev, data.theme_id]));
        setDimensions(prev => {
          const dim = prev[data.dimension] || { dimension: data.dimension, label: DIM_CONFIG[data.dimension]?.label || '', themes: [] };
          const existingIdx = dim.themes.findIndex(t => t.theme_id === data.theme_id);
          if (existingIdx >= 0) return prev;
          return { ...prev, [data.dimension]: { ...dim, themes: [...dim.themes, newTheme] } };
        });
        setTimeout(scrollToBottom, 100);
        break;
      }

      case 'question:answered': {
        const q = data as QuestionEvent;
        setAnsweredCount(q.answered_count);
        answeredCountRef.current = q.answered_count;
        setTotalQuestions(prev => q.total_questions || prev);
        setLatestQuestion(q);

        setDimensions(prev => {
          const dim = prev[q.dimension];
          if (!dim) return prev;
          const themes = dim.themes.map(t => {
            if (t.theme_id === currentThemeRef.current) {
              // Avoid duplicate questions on reconnect
              const exists = t.questions.some(eq => eq.question_id === q.question_id);
              if (exists) return t;
              return { ...t, questions: [...t.questions, q] };
            }
            return t;
          });
          return { ...prev, [q.dimension]: { ...dim, themes } };
        });
        setTimeout(scrollToBottom, 50);
        break;
      }

      case 'theme:complete': {
        currentThemeRef.current = null;
        setDimensions(prev => {
          const dim = prev[data.dimension];
          if (!dim) return prev;
          const themes = dim.themes.map(t => {
            if (t.theme_id === data.theme_id) {
              return { ...t, score: data.raw_score, rating: data.rating, completed: true };
            }
            return t;
          });
          return { ...prev, [data.dimension]: { ...dim, themes } };
        });
        setExpandedThemes(prev => {
          const next = new Set(prev);
          next.delete(data.theme_id);
          return next;
        });
        setTimeout(scrollToBottom, 100);
        break;
      }

      case 'analysis:complete':
        receivedCompleteRef.current = true;
        setFinalScores({
          overall_score: data.overall_score,
          overall_rating: data.overall_rating,
          environmental_score: data.environmental_score,
          social_score: data.social_score,
          governance_score: data.governance_score,
          total_answered: data.total_answered,
        });
        setDimensions(prev => {
          const updated = { ...prev };
          if (updated.environmental) updated.environmental.score = data.environmental_score;
          if (updated.social) updated.social.score = data.social_score;
          if (updated.governance) updated.governance.score = data.governance_score;
          return updated;
        });
        setStatus('completed');
        setReconnectAttempt(0);
        setTimeout(scrollToBottom, 200);
        break;

      case 'analysis:error':
        setStatus('error');
        setErrorMsg(data.error || 'Erro desconhecido.');
        break;
    }
  }, [scrollToBottom]);

  // ─── Reconnection Logic ─────────────────────────────────────────────────

  const reconnect = useCallback(async (attempt: number) => {
    if (isUnmountedRef.current || receivedCompleteRef.current) return;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('error');
      setErrorMsg('Número máximo de reconexões atingido. A análise continua no servidor — clique em "Voltar" e reabra para ver o progresso.');
      return;
    }

    const aid = analysisIdRef.current;
    if (!aid) {
      setStatus('error');
      setErrorMsg('ID da análise perdido. Clique em "Voltar" e reabra.');
      return;
    }

    const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(1.5, attempt), MAX_RECONNECT_DELAY_MS);
    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})...`);

    setStatus('reconnecting');
    setReconnectAttempt(attempt + 1);

    await new Promise(resolve => {
      reconnectTimerRef.current = setTimeout(resolve, delay);
    });

    if (isUnmountedRef.current) return;

    // Check if analysis is still running or already completed
    try {
      const statusRes = await fetch(`/api/analysis/status/${aid}`);
      if (!statusRes.ok) {
        // Server error — retry
        reconnect(attempt + 1);
        return;
      }
      const statusData = await statusRes.json();

      if (statusData.status === 'completed') {
        // Analysis finished while we were disconnected — replay it
        console.log('[SSE] Analysis completed while disconnected. Switching to replay.');
        connectReplay(aid);
        return;
      }

      if (statusData.status === 'error' || statusData.status === 'cancelled') {
        setStatus('error');
        setErrorMsg(`Análise ${statusData.status === 'error' ? 'com erro' : 'cancelada'}.`);
        return;
      }

      // Still running — subscribe with last_seen
      connectSubscription(aid, answeredCountRef.current, attempt);

    } catch (e) {
      console.warn('[SSE] Status check failed:', e);
      reconnect(attempt + 1);
    }
  }, [handleSSEEvent]);

  // ─── SSE Stream Reader (shared logic) ───────────────────────────────────

  const readSSEStream = useCallback(async (
    response: Response,
    onDisconnect: () => void,
  ) => {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    const processSSE = (text: string) => {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith(': keepalive')) continue;
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6).trim();
          if (eventType && eventData) {
            handleSSEEvent(eventType, eventData);
            eventType = '';
            eventData = '';
          }
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processSSE(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      console.warn('[SSE] Stream error:', e);
    }

    // Stream ended — check if analysis completed
    if (!receivedCompleteRef.current && !isUnmountedRef.current) {
      onDisconnect();
    }
  }, [handleSSEEvent]);

  // ─── Connect via POST (initial start) ──────────────────────────────────

  const connectInitial = useCallback(async () => {
    if (!companyId || !reportYear) return;

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch('/api/analysis/run-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, report_year: reportYear }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        setStatus('error');
        setErrorMsg(`Erro ${response.status}: ${await response.text()}`);
        return;
      }

      setStatus('running');

      await readSSEStream(response, () => {
        console.log('[SSE] Initial stream disconnected. Will reconnect...');
        reconnect(0);
      });

    } catch (e: any) {
      if (e.name === 'AbortError') return;
      console.warn('[SSE] Initial connection failed:', e);
      reconnect(0);
    }
  }, [companyId, reportYear, readSSEStream, reconnect]);

  // ─── Connect via GET (subscription/reconnect) ─────────────────────────

  const connectSubscription = useCallback(async (aid: string, lastSeen: number, attempt: number) => {
    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch(`/api/analysis/subscribe/${aid}?last_seen=${lastSeen}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        console.warn(`[SSE] Subscribe failed: ${response.status}`);
        reconnect(attempt + 1);
        return;
      }

      setStatus('running');
      setReconnectAttempt(0);

      await readSSEStream(response, () => {
        console.log('[SSE] Subscription stream disconnected. Will reconnect...');
        reconnect(0);
      });

    } catch (e: any) {
      if (e.name === 'AbortError') return;
      console.warn('[SSE] Subscription failed:', e);
      reconnect(attempt + 1);
    }
  }, [readSSEStream, reconnect]);

  // ─── Connect via EventSource (replay) ──────────────────────────────────

  const connectReplay = useCallback((aid: string) => {
    const es = new EventSource(`/api/analysis/replay/${aid}`);
    eventSourceRef.current = es;

    es.onopen = () => setStatus('running');

    const events = [
      'analysis:start', 'dimension:start', 'theme:start',
      'question:answered', 'theme:complete', 'analysis:complete', 'analysis:error',
    ];
    events.forEach(evt => {
      es.addEventListener(evt, (e: MessageEvent) => handleSSEEvent(evt, e.data));
    });

    es.onerror = () => {
      es.close();
      if (!receivedCompleteRef.current && !isUnmountedRef.current) {
        setStatus('error');
        setErrorMsg('Conexão perdida durante replay.');
      }
    };
  }, [handleSSEEvent]);

  // ─── Main Connection Effect ─────────────────────────────────────────────

  useEffect(() => {
    isUnmountedRef.current = false;
    receivedCompleteRef.current = false;

    if (mode === 'replay' && analysisId) {
      connectReplay(analysisId);
    } else if (mode === 'live') {
      connectInitial();
    }

    return () => {
      isUnmountedRef.current = true;
      abortControllerRef.current?.abort();
      eventSourceRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, companyId, reportYear, analysisId]);

  // ─── Helpers ───────────────────────────────────────────────────────────

  const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

  const handleExport = async () => {
    if (!analysisIdRef.current) return;
    setExporting(true);
    try {
      const res = await exportAnalysis(analysisIdRef.current);
      const contentDisposition = res.headers['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;'"\n]+)/i);
      const serverFilename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : null;
      const filename = serverFilename || `ESG_Rating_${companyName}_${reportYear}.xlsm`;
      const blob = new Blob([res.data], {
        type: res.headers['content-type'] || 'application/vnd.ms-excel.sheet.macroEnabled.12',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Falha ao exportar Excel. Verifique se a análise está completa.');
    } finally {
      setExporting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Sticky Header */}
      <div style={{
        padding: '20px 0 16px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        {/* Title Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {(status === 'running' || status === 'reconnecting') && (
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: status === 'reconnecting' ? '#f59e0b' : '#ef4444',
                boxShadow: `0 0 8px ${status === 'reconnecting' ? 'rgba(245,158,11,0.6)' : 'rgba(239,68,68,0.6)'}`,
                animation: 'pulseGlow 1.5s ease-in-out infinite',
              }} />
            )}
            <h2 className="gradient-text" style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>
              {mode === 'replay' ? '📼 Replay' : '🔴 Análise Live'} — {companyName}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {status === 'running' && (
              <button
                onClick={async () => {
                  if (!analysisIdRef.current) return;
                  setCancelling(true);
                  try {
                    await cancelAnalysis(analysisIdRef.current);
                    onClose();
                  } catch {
                    setCancelling(false);
                  }
                }}
                disabled={cancelling}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                  color: '#ef4444', fontSize: '12px', fontWeight: 600,
                  cursor: cancelling ? 'wait' : 'pointer', opacity: cancelling ? 0.6 : 1,
                }}
              >
                {cancelling
                  ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />
                  : <XCircle style={{ width: '13px', height: '13px' }} />}
                {cancelling ? 'Cancelando...' : 'Cancelar'}
              </button>
            )}
            {status === 'completed' && (
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px',
                  background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)',
                  color: 'var(--color-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {exporting
                  ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />
                  : <Download style={{ width: '13px', height: '13px' }} />}
                Excel
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px',
                background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              <RotateCcw style={{ width: '13px', height: '13px' }} />
              Voltar
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            flex: 1, height: '6px', borderRadius: '3px',
            background: 'var(--color-surface-hover)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: '3px',
              width: `${progress}%`,
              background: status === 'completed'
                ? 'linear-gradient(90deg, var(--color-success), var(--color-primary))'
                : 'linear-gradient(90deg, var(--color-primary), var(--color-primary-light))',
              transition: 'width 0.3s ease-out',
              boxShadow: status === 'running' ? '0 0 12px var(--color-primary-glow)' : 'none',
            }} />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', minWidth: '90px', textAlign: 'right' }}>
            {answeredCount}/{totalQuestions} ({progress.toFixed(0)}%)
          </span>
        </div>

        {/* Dimension mini-bars */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          {(['environmental', 'social', 'governance'] as const).map(dim => {
            const cfg = DIM_CONFIG[dim];
            const dimData = dimensions[dim];
            const theme_count = dimData?.themes.length || 0;
            const completed_themes = dimData?.themes.filter(t => t.completed).length || 0;
            const Icon = cfg.icon;
            return (
              <div key={dim} style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', borderRadius: '10px',
                background: currentDimension === dim ? cfg.bg : 'var(--color-surface-light)',
                border: `1px solid ${currentDimension === dim ? cfg.color + '30' : 'var(--color-border)'}`,
                transition: 'all 0.3s',
              }}>
                <Icon style={{ width: '14px', height: '14px', color: cfg.color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: cfg.color }}>
                  {cfg.label}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginLeft: 'auto' }}>
                  {completed_themes}/{theme_count || '—'}
                </span>
                {dimData?.score != null && (
                  <span style={{
                    fontSize: '11px', fontWeight: 800, color: cfg.color,
                    background: cfg.bg, padding: '1px 6px', borderRadius: '4px',
                  }}>
                    {dimData.score.toFixed(1)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable Content */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingTop: '20px', paddingBottom: '120px' }}>
        {/* Connecting State */}
        {status === 'connecting' && (
          <div className="animate-fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
            <Loader2 style={{ width: '36px', height: '36px', color: 'var(--color-primary-light)', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              Conectando ao servidor...
            </p>
          </div>
        )}

        {/* Reconnecting Banner */}
        {status === 'reconnecting' && (
          <div className="animate-fade-in" style={{
            padding: '16px 20px', borderRadius: '12px', marginBottom: '16px',
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <RefreshCw style={{
              width: '18px', height: '18px', color: '#f59e0b',
              animation: 'spin 2s linear infinite',
            }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', margin: 0 }}>
                Reconectando... (tentativa {reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS})
              </p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                A análise continua no servidor. Reconectando automaticamente...
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="animate-fade-in" style={{
            textAlign: 'center', padding: '48px',
            background: 'rgba(239,68,68,0.05)', borderRadius: '16px',
            border: '1px solid rgba(239,68,68,0.2)',
          }}>
            <XCircle style={{ width: '36px', height: '36px', color: 'var(--color-danger)', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-danger)', marginBottom: '8px' }}>
              Erro na análise
            </p>
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{errorMsg}</p>
          </div>
        )}

        {/* Theme Cards */}
        {(['environmental', 'social', 'governance'] as const).map(dim => {
          const dimData = dimensions[dim];
          if (!dimData || !dimData.themes.length) return null;
          const cfg = DIM_CONFIG[dim];
          const Icon = cfg.icon;

          return (
            <div key={dim} className="animate-fade-in" style={{ marginBottom: '24px' }}>
              {/* Dimension Header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 0', marginBottom: '8px',
                borderBottom: `2px solid ${cfg.color}20`,
              }}>
                <Icon style={{ width: '18px', height: '18px', color: cfg.color }} />
                <span style={{ fontSize: '14px', fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {cfg.label}
                </span>
                {dimData.score != null && (
                  <span style={{
                    fontSize: '13px', fontWeight: 800, color: cfg.color,
                    marginLeft: 'auto', background: cfg.bg, padding: '3px 10px', borderRadius: '6px',
                  }}>
                    {dimData.score.toFixed(1)}
                  </span>
                )}
              </div>

              {/* Theme Rows */}
              {dimData.themes.map(theme => {
                const isExpanded = expandedThemes.has(theme.theme_id);
                const isActive = currentThemeRef.current === theme.theme_id;

                return (
                  <div key={theme.theme_id} className="animate-fade-in" style={{
                    marginBottom: '6px',
                    borderRadius: '12px',
                    border: isActive
                      ? `1px solid ${cfg.color}40`
                      : '1px solid var(--color-border)',
                    background: isActive ? cfg.bg : 'var(--color-surface-light)',
                    overflow: 'hidden',
                    transition: 'all 0.3s',
                  }}>
                    {/* Theme Header Button */}
                    <button
                      onClick={() => toggleTheme(theme.theme_id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '12px 16px', background: 'none', border: 'none',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {isExpanded
                        ? <ChevronDown style={{ width: '14px', height: '14px', color: 'var(--color-text-muted)', flexShrink: 0 }} />
                        : <ChevronRight style={{ width: '14px', height: '14px', color: 'var(--color-text-muted)', flexShrink: 0 }} />}

                      <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', textAlign: 'left' }}>
                        {theme.theme_name}
                      </span>

                      {/* Question count */}
                      <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontWeight: 500 }}>
                        {theme.questions.length}/{theme.question_count}
                      </span>

                      {/* Active indicator */}
                      {isActive && (
                        <Radio style={{
                          width: '14px', height: '14px', color: cfg.color,
                          animation: 'pulseGlow 1.5s ease-in-out infinite',
                        }} />
                      )}

                      {/* Score bar */}
                      <div style={{
                        width: '80px', height: '5px', borderRadius: '3px',
                        background: 'rgba(255,255,255,0.05)', overflow: 'hidden', flexShrink: 0,
                      }}>
                        <div style={{
                          width: theme.score != null ? `${(theme.score / 10) * 100}%` : `${(theme.questions.length / Math.max(theme.question_count, 1)) * 100}%`,
                          height: '100%', borderRadius: '3px',
                          background: theme.completed ? cfg.color : 'var(--color-text-faint)',
                          transition: 'width 0.4s ease-out',
                        }} />
                      </div>

                      {/* Score / Rating */}
                      {theme.completed && theme.score != null ? (
                        <>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)', minWidth: '32px', textAlign: 'right' }}>
                            {theme.score.toFixed(1)}
                          </span>
                          <div style={{
                            width: '24px', height: '24px', borderRadius: '6px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: `${RATING_COLORS[theme.rating || ''] || '#666'}20`,
                            border: `1.5px solid ${RATING_COLORS[theme.rating || ''] || '#666'}`,
                            color: RATING_COLORS[theme.rating || ''] || '#666',
                            fontSize: '11px', fontWeight: 900,
                          }}>
                            {theme.rating}
                          </div>
                        </>
                      ) : isActive ? (
                        <Loader2 style={{ width: '16px', height: '16px', color: cfg.color, animation: 'spin 1s linear infinite' }} />
                      ) : null}
                    </button>

                    {/* Expanded Questions */}
                    {isExpanded && theme.questions.length > 0 && (
                      <div style={{
                        padding: '0 16px 12px 40px',
                        display: 'flex', flexDirection: 'column', gap: '3px',
                      }}>
                        {theme.questions.map((q, idx) => (
                          <div
                            key={q.question_id + idx}
                            className="animate-slide-left"
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '6px 10px', borderRadius: '6px',
                              background: idx === theme.questions.length - 1 && isActive
                                ? 'rgba(255,255,255,0.04)'
                                : 'transparent',
                              animationDelay: `${idx * 0.02}s`,
                            }}
                          >
                            {/* Answer icon */}
                            {q.answer === 'Sim' ? (
                              <CheckCircle2 style={{ width: '13px', height: '13px', color: 'var(--color-primary)', flexShrink: 0 }} />
                            ) : q.answer === 'Não' ? (
                              <XCircle style={{ width: '13px', height: '13px', color: '#ef4444', flexShrink: 0 }} />
                            ) : (
                              <MinusCircle style={{ width: '13px', height: '13px', color: '#64748b', flexShrink: 0 }} />
                            )}

                            {/* Question ID */}
                            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-faint)', minWidth: '44px', fontFamily: 'monospace' }}>
                              {q.question_id}
                            </span>

                            {/* Question text */}
                            <span style={{
                              flex: 1, fontSize: '11px', color: 'var(--color-text-secondary)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {q.question_text}
                            </span>

                            {/* Answer */}
                            <span style={{
                              fontSize: '10px', fontWeight: 700, minWidth: '28px', textAlign: 'center',
                              color: q.answer === 'Sim' ? 'var(--color-primary)' : q.answer === 'Não' ? '#ef4444' : '#64748b',
                            }}>
                              {q.answer}
                            </span>

                            {/* Confidence */}
                            <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', minWidth: '28px', textAlign: 'right' }}>
                              {(q.confidence_score * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Latest Question Banner — Fixed at bottom of scrollable area */}
        {(status === 'running' || status === 'reconnecting') && latestQuestion && (
          <div style={{
            position: 'sticky', bottom: '0',
            padding: '12px 16px', borderRadius: '12px',
            background: 'rgba(248,253,249,0.95)', backdropFilter: 'blur(12px)',
            border: '1px solid var(--color-border-light)',
            display: 'flex', alignItems: 'center', gap: '12px',
            marginTop: '12px',
          }}>
            <Activity style={{ width: '14px', height: '14px', color: 'var(--color-primary-light)', flexShrink: 0 }} />
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              <strong style={{ color: 'var(--color-text-secondary)' }}>
                [{latestQuestion.question_id}]
              </strong>{' '}
              {latestQuestion.question_text}
            </span>
            <span style={{
              fontSize: '11px', fontWeight: 700, marginLeft: 'auto', flexShrink: 0,
              color: latestQuestion.answer === 'Sim' ? 'var(--color-primary)' : latestQuestion.answer === 'Não' ? '#ef4444' : '#64748b',
            }}>
              {latestQuestion.answer}
            </span>
          </div>
        )}

        {/* Final Scores Panel */}
        {status === 'completed' && finalScores && (
          <div className="animate-fade-in-scale" style={{
            padding: '32px', borderRadius: '20px', marginTop: '24px',
            background: 'linear-gradient(135deg, var(--color-primary-glow), transparent)',
            border: '1px solid var(--color-primary-glow-strong)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
              <Trophy style={{ width: '22px', height: '22px', color: '#f59e0b' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-text)', margin: 0 }}>
                Resultado Final
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
              {/* Overall */}
              <div style={{
                padding: '20px', borderRadius: '14px', textAlign: 'center',
                background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary-glow-strong)',
              }}>
                <div style={{
                  width: '52px', height: '52px', borderRadius: '14px', margin: '0 auto 10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${RATING_COLORS[finalScores.overall_rating] || '#666'}20`,
                  border: `2.5px solid ${RATING_COLORS[finalScores.overall_rating] || '#666'}`,
                  color: RATING_COLORS[finalScores.overall_rating] || '#666',
                  fontSize: '22px', fontWeight: 900,
                }}>
                  {finalScores.overall_rating}
                </div>
                <p style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-text)', margin: 0 }}>
                  {finalScores.overall_score.toFixed(1)}
                </p>
                <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-faint)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Overall
                </p>
              </div>

              {/* Per-dimension */}
              {(['environmental', 'social', 'governance'] as const).map(dim => {
                const cfg = DIM_CONFIG[dim];
                const score = dim === 'environmental' ? finalScores.environmental_score
                  : dim === 'social' ? finalScores.social_score
                  : finalScores.governance_score;
                const Icon = cfg.icon;
                return (
                  <div key={dim} style={{
                    padding: '20px', borderRadius: '14px', textAlign: 'center',
                    background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
                  }}>
                    <div style={{
                      width: '44px', height: '44px', borderRadius: '12px', margin: '0 auto 10px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: cfg.bg,
                    }}>
                      <Icon style={{ width: '20px', height: '20px', color: cfg.color }} />
                    </div>
                    <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text)', margin: 0 }}>
                      {score.toFixed(1)}
                    </p>
                    <p style={{ fontSize: '10px', fontWeight: 700, color: cfg.color, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      {cfg.label}
                    </p>
                  </div>
                );
              })}
            </div>

            <p style={{ fontSize: '12px', color: 'var(--color-text-faint)', textAlign: 'center', marginTop: '16px' }}>
              {finalScores.total_answered} perguntas respondidas · {companyName} · {reportYear}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
