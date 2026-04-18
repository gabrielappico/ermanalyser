import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  BarChart3,
  Leaf,
  Users,
  Shield,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
  Radio,
  RotateCcw,
} from 'lucide-react';
import {
  runAnalysis,
  getAnalysisStatus,
  getAnalysisResults,
  getAnalysisHistory,
  getDocuments,
  exportAnalysis,
  cancelAnalysis,
  forceRestartAnalysis,
  unstickAnalyses,
  forceCompleteAnalysis,
} from '../api';
import type { Company } from '../App';
import LiveAnalysisView from './LiveAnalysisView';

interface Analysis {
  id: string;
  company_id: string;
  report_year: number;
  status: string;
  overall_score: number | null;
  overall_rating: string | null;
  environmental_score: number | null;
  social_score: number | null;
  governance_score: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  progress?: { total: number; completed: number; percentage: number };
}

interface ThemeScore {
  id: string;
  theme_id: string;
  raw_score: number;
  weighted_score: number;
  rating: string;
  esg_themes: {
    name: string;
    dimension: string;
    theme_number: number;
    display_order: number;
  };
}

interface AnswerItem {
  id: string;
  answer: string;
  justification: string;
  source_reference: string | null;
  improvement_points: string | null;
  confidence_score: number;
  agent_name: string;
  esg_questions: {
    question_id: string;
    question_text: string;
    section: string;
    esg_themes: { name: string; dimension: string };
  };
}

interface Props {
  company: Company;
}

const DIM_CONFIG = {
  environmental: { label: 'Ambiental', icon: Leaf, color: '#00633a', bg: 'rgba(0,99,58,0.1)' },
  social: { label: 'Social', icon: Users, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  governance: { label: 'Governança', icon: Shield, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
};

const RATING_COLORS: Record<string, string> = {
  A: '#00633a', B: '#007e4c', C: '#eab308', D: '#f97316', E: '#ef4444',
};

function RatingBadge({ rating, size = 'md' }: { rating: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const r = rating || '—';
  const color = RATING_COLORS[r] || 'var(--color-text-muted)';
  const sizes = { sm: { w: '28px', f: '12px' }, md: { w: '40px', f: '16px' }, lg: { w: '56px', f: '24px' } };
  const s = sizes[size];
  return (
    <div style={{
      width: s.w, height: s.w, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${color}20`, border: `2px solid ${color}`, color, fontSize: s.f, fontWeight: 900, letterSpacing: '-0.02em',
    }}>
      {r}
    </div>
  );
}

export default function AnalysisPanel({ company }: Props) {
  const [reportYear, setReportYear] = useState(new Date().getFullYear() - 1);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [themeScores, setThemeScores] = useState<ThemeScore[]>([]);
  const [answers, setAnswers] = useState<AnswerItem[]>([]);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const [hasDocuments, setHasDocuments] = useState(false);
  const [liveView, setLiveView] = useState<{ mode: 'live' | 'replay'; analysisId?: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [unsticking, setUnsticking] = useState(false);
  const [forceCompleting, setForceCompleting] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const [histRes, docRes] = await Promise.all([
        getAnalysisHistory(company.id),
        getDocuments(company.id),
      ]);
      setHistory(histRes.data);
      const readyDocs = docRes.data.filter((d: any) => d.status === 'ready' && d.report_year === reportYear);
      setHasDocuments(readyDocs.length > 0);

      const current = histRes.data.find((a: Analysis) => a.report_year === reportYear);
      if (current) {
        setAnalysis(current);
        if (current.status === 'completed') {
          const results = await getAnalysisResults(current.id);
          setThemeScores(results.data.theme_scores || []);
          setAnswers(results.data.answers || []);
        }
      } else {
        setAnalysis(null);
        setThemeScores([]);
        setAnswers([]);
      }
    } catch (err) {
      console.error('Failed to fetch analysis data:', err);
    } finally {
      setLoading(false);
    }
  }, [company.id, reportYear]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    if (analysis?.status === 'running') {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await getAnalysisStatus(analysis.id);
          setAnalysis(res.data);
          if (res.data.status === 'completed' || res.data.status === 'error') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (res.data.status === 'completed') {
              const results = await getAnalysisResults(analysis.id);
              setThemeScores(results.data.theme_scores || []);
              setAnswers(results.data.answers || []);
            }
          }
        } catch { /* retry */ }
      }, 5000);
      return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }
  }, [analysis?.status, analysis?.id]);

  const handleStart = async () => {
    // Launch SSE live view directly
    setLiveView({ mode: 'live' });
  };

  const handleReplay = () => {
    if (analysis?.id) {
      setLiveView({ mode: 'replay', analysisId: analysis.id });
    }
  };

  const handleCloseLiveView = () => {
    setLiveView(null);
    setLoading(true);
    fetchHistory();
  };

  const handleCancel = async () => {
    if (!analysis) return;
    setCancelling(true);
    setActionMessage(null);
    try {
      const res = await cancelAnalysis(analysis.id);
      setActionMessage({ type: 'success', text: res.data.message });
      if (pollingRef.current) clearInterval(pollingRef.current);
      setLoading(true);
      fetchHistory();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.response?.data?.detail || 'Falha ao cancelar.' });
    } finally {
      setCancelling(false);
    }
  };

  const handleForceRestart = async () => {
    if (!analysis) return;
    setRestarting(true);
    setActionMessage(null);
    try {
      const res = await forceRestartAnalysis(analysis.id);
      setActionMessage({ type: 'success', text: res.data.message });
      setLoading(true);
      fetchHistory();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.response?.data?.detail || 'Falha ao reiniciar.' });
    } finally {
      setRestarting(false);
    }
  };

  const handleUnstick = async () => {
    setUnsticking(true);
    setActionMessage(null);
    try {
      const res = await unstickAnalyses();
      setActionMessage({ type: 'success', text: res.data.message });
      if (res.data.fixed > 0) {
        setLoading(true);
        fetchHistory();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.response?.data?.detail || 'Falha ao destravar.' });
    } finally {
      setUnsticking(false);
    }
  };

  const handleForceComplete = async () => {
    if (!analysis) return;
    setForceCompleting(true);
    setActionMessage(null);
    try {
      const res = await forceCompleteAnalysis(analysis.id);
      setActionMessage({ type: 'success', text: res.data.message });
      if (pollingRef.current) clearInterval(pollingRef.current);
      setLoading(true);
      fetchHistory();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.response?.data?.detail || 'Falha ao forçar conclusão.' });
    } finally {
      setForceCompleting(false);
    }
  };

  const handleExport = async () => {
    if (!analysis) return;
    setExporting(true);
    try {
      const res = await exportAnalysis(analysis.id);
      const contentDisposition = res.headers['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;'"\n]+)/i);
      const serverFilename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : null;
      const filename = serverFilename || `ESG_Rating_${company.name}_${reportYear}.xlsm`;
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

  const yearOptions = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  const dimScores = analysis?.status === 'completed' ? [
    { key: 'environmental', score: analysis.environmental_score },
    { key: 'social', score: analysis.social_score },
    { key: 'governance', score: analysis.governance_score },
  ] : [];

  const groupedThemes: Record<string, ThemeScore[]> = {};
  themeScores.forEach(ts => {
    const dim = ts.esg_themes?.dimension || 'environmental';
    if (!groupedThemes[dim]) groupedThemes[dim] = [];
    groupedThemes[dim].push(ts);
  });

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '80px' }} />)}
      </div>
    );
  }

  // Show live view if active
  if (liveView) {
    return (
      <LiveAnalysisView
        mode={liveView.mode}
        companyId={company.id}
        reportYear={reportYear}
        analysisId={liveView.analysisId}
        companyName={company.name}
        onClose={handleCloseLiveView}
      />
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h2 className="gradient-text" style={{ fontSize: '28px', fontWeight: 800, margin: 0, lineHeight: 1.2 }}>
            Análise ESG
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
            {company.name} — 380 perguntas · 26 temas · Rating A-E
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Unstick all button */}
          <button
            onClick={handleUnstick}
            disabled={unsticking}
            title="Destravar análises travadas"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '10px',
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)',
              color: '#f59e0b', fontSize: '12px', fontWeight: 600,
              cursor: unsticking ? 'wait' : 'pointer', opacity: unsticking ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            {unsticking
              ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />
              : <AlertCircle style={{ width: '13px', height: '13px' }} />}
            {unsticking ? 'Destravando...' : 'Destravar'}
          </button>
          <select
            value={reportYear}
            onChange={e => { setReportYear(Number(e.target.value)); setLoading(true); }}
            style={{
              padding: '8px 14px', borderRadius: '10px', background: 'var(--color-surface-light)',
              border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {yearOptions.map(y => {
              const done = history.some(h => h.report_year === y && h.status === 'completed');
              return <option key={y} value={y}>{y} {done ? '✓' : ''}</option>;
            })}
          </select>

          {analysis?.status === 'completed' && (
            <>
              <button
                onClick={handleReplay}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '10px',
                  background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary-glow-strong)', color: 'var(--color-primary-light)',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Radio style={{ width: '14px', height: '14px' }} />
                Replay
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '10px',
                  background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary-glow-strong)', color: 'var(--color-primary)',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {exporting ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} /> : <Download style={{ width: '14px', height: '14px' }} />}
                Exportar Excel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Start / Status Card */}
      {!analysis || analysis.status === 'pending' ? (
        <div style={{
          padding: '48px', borderRadius: '20px', textAlign: 'center',
          background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
          marginBottom: '32px',
        }}>
          <div style={{ width: '64px', height: '64px', margin: '0 auto 20px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary-glow-strong)' }}>
            <BarChart3 style={{ width: '28px', height: '28px', color: 'var(--color-primary-light)' }} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '8px' }}>
            Iniciar Análise ESG — {reportYear}
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '24px', maxWidth: '500px', margin: '0 auto 24px' }}>
            {hasDocuments
              ? 'Documentos prontos. A análise processará 380 perguntas em 26 temas usando agentes especializados de IA.'
              : `Nenhum documento processado para ${reportYear}. Faça upload na aba Documentos primeiro.`}
          </p>
          <button
            onClick={handleStart}
            disabled={starting || !hasDocuments}
            className="btn-primary"
            style={{ padding: '12px 32px', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            {starting ? <Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} /> : <Play style={{ width: '16px', height: '16px' }} />}
            {starting ? 'Iniciando...' : 'Iniciar Análise'}
          </button>
        </div>
      ) : analysis.status === 'running' ? (
        <div style={{
          padding: '32px', borderRadius: '20px',
          background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
          marginBottom: '32px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <Loader2 style={{ width: '20px', height: '20px', color: 'var(--color-primary-light)', animation: 'spin 1s linear infinite' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', margin: 0, flex: 1 }}>Análise em andamento...</h3>
            <button
              onClick={handleForceComplete}
              disabled={forceCompleting}
              title="Finalizar análise com as respostas já coletadas"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px',
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                color: '#f59e0b', fontSize: '12px', fontWeight: 600, cursor: forceCompleting ? 'wait' : 'pointer',
                opacity: forceCompleting ? 0.6 : 1, transition: 'all 0.2s',
              }}
            >
              {forceCompleting
                ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />
                : <CheckCircle2 style={{ width: '13px', height: '13px' }} />}
              {forceCompleting ? 'Finalizando...' : 'Forçar Conclusão'}
            </button>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444', fontSize: '12px', fontWeight: 600, cursor: cancelling ? 'wait' : 'pointer',
                opacity: cancelling ? 0.6 : 1, transition: 'all 0.2s',
              }}
            >
              {cancelling
                ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />
                : <XCircle style={{ width: '13px', height: '13px' }} />}
              {cancelling ? 'Cancelando...' : 'Cancelar'}
            </button>
          </div>
          <div style={{ height: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{
              height: '100%', borderRadius: '4px', transition: 'width 0.5s ease',
              width: `${analysis.progress?.percentage || 5}%`,
              background: 'linear-gradient(90deg, var(--color-primary), var(--color-primary-light))',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            <span>{analysis.progress?.completed || 0} de {analysis.progress?.total || 380} perguntas</span>
            <span>{analysis.progress?.percentage || 0}%</span>
          </div>
        </div>
      ) : analysis.status === 'error' || analysis.status === 'cancelled' ? (
        <div style={{
          padding: '32px', borderRadius: '20px', marginBottom: '32px',
          background: analysis.status === 'cancelled' ? 'rgba(245,158,11,0.05)' : 'rgba(239,68,68,0.05)',
          border: `1px solid ${analysis.status === 'cancelled' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <AlertCircle style={{
              width: '24px', height: '24px', flexShrink: 0,
              color: analysis.status === 'cancelled' ? '#f59e0b' : 'var(--color-danger)',
            }} />
            <div style={{ flex: 1 }}>
              <p style={{
                fontSize: '14px', fontWeight: 600, margin: 0,
                color: analysis.status === 'cancelled' ? '#f59e0b' : 'var(--color-danger)',
              }}>
                {analysis.status === 'cancelled' ? 'Análise cancelada' : 'Erro na análise'}
              </p>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {analysis.status === 'cancelled'
                  ? 'A análise foi interrompida. Você pode reiniciar do zero.'
                  : 'Ocorreu um erro. Tente reiniciar a análise.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={handleForceRestart}
                disabled={restarting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px',
                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                  color: '#f59e0b', fontSize: '13px', fontWeight: 600,
                  cursor: restarting ? 'wait' : 'pointer', opacity: restarting ? 0.6 : 1,
                }}
              >
                {restarting
                  ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                  : <RotateCcw style={{ width: '14px', height: '14px' }} />}
                Resetar
              </button>
              <button
                onClick={handleStart}
                disabled={restarting || !hasDocuments}
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Play style={{ width: '14px', height: '14px' }} />
                Recomeçar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Action Message Toast */}
      {actionMessage && (
        <div className="animate-fade-in" style={{
          padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
          background: actionMessage.type === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${actionMessage.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          {actionMessage.type === 'success'
            ? <CheckCircle2 style={{ width: '16px', height: '16px', color: 'var(--color-primary)', flexShrink: 0 }} />
            : <AlertCircle style={{ width: '16px', height: '16px', color: '#ef4444', flexShrink: 0 }} />}
          <span style={{
            fontSize: '13px', fontWeight: 500, flex: 1,
            color: actionMessage.type === 'success' ? 'var(--color-primary)' : 'var(--color-danger)',
          }}>
            {actionMessage.text}
          </span>
          <button
            onClick={() => setActionMessage(null)}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-faint)',
              cursor: 'pointer', fontSize: '16px', padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Results */}
      {analysis?.status === 'completed' && (
        <>
          {/* Overall Score */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', marginBottom: '32px',
          }}>
            {/* Overall */}
            <div style={{
              padding: '24px', borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--color-primary-glow), transparent)',
              border: '1px solid var(--color-primary-glow-strong)',
              display: 'flex', alignItems: 'center', gap: '16px',
            }}>
              <RatingBadge rating={analysis.overall_rating} size="lg" />
              <div>
                <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-faint)', margin: 0 }}>Rating Geral</p>
                <p style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-text)', margin: 0, lineHeight: 1 }}>{analysis.overall_score?.toFixed(1)}</p>
                <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', margin: 0 }}>/ 10.0</p>
              </div>
            </div>

            {/* Dimension scores */}
            {dimScores.map(({ key, score }) => {
              const cfg = DIM_CONFIG[key as keyof typeof DIM_CONFIG];
              const Icon = cfg.icon;
              return (
                <div key={key} style={{
                  padding: '24px', borderRadius: '16px',
                  background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', gap: '14px',
                }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: cfg.bg }}>
                    <Icon style={{ width: '20px', height: '20px', color: cfg.color }} />
                  </div>
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-faint)', margin: 0 }}>{cfg.label}</p>
                    <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text)', margin: 0, lineHeight: 1.1 }}>{score?.toFixed(1) || '—'}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Theme Scores */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp style={{ width: '18px', height: '18px', color: 'var(--color-primary-light)' }} />
              Notas por Tema ({themeScores.length} temas)
            </h3>

            {(['environmental', 'social', 'governance'] as const).map(dim => {
              const cfg = DIM_CONFIG[dim];
              const themes = groupedThemes[dim] || [];
              if (!themes.length) return null;

              return (
                <div key={dim} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <cfg.icon style={{ width: '14px', height: '14px', color: cfg.color }} />
                    <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color }}>{cfg.label}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {themes.sort((a, b) => (a.esg_themes?.display_order || 0) - (b.esg_themes?.display_order || 0)).map(ts => {
                      const isExpanded = expandedTheme === ts.theme_id;
                      const themeAnswers = answers.filter(a => a.esg_questions?.esg_themes?.name === ts.esg_themes?.name);

                      return (
                        <div key={ts.id}>
                          <button
                            onClick={() => setExpandedTheme(isExpanded ? null : ts.theme_id)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                              padding: '12px 16px', borderRadius: '10px',
                              background: isExpanded ? 'rgba(255,255,255,0.04)' : 'var(--color-surface-light)',
                              border: '1px solid var(--color-border)', cursor: 'pointer', fontFamily: 'inherit',
                              transition: 'all 0.2s',
                            }}
                          >
                            {isExpanded ? <ChevronDown style={{ width: '14px', height: '14px', color: 'var(--color-text-muted)', flexShrink: 0 }} /> : <ChevronRight style={{ width: '14px', height: '14px', color: 'var(--color-text-muted)', flexShrink: 0 }} />}
                            <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', textAlign: 'left' }}>
                              {ts.esg_themes?.name}
                            </span>
                            {/* Score bar */}
                            <div style={{ width: '120px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden', flexShrink: 0 }}>
                              <div style={{ width: `${(ts.raw_score / 10) * 100}%`, height: '100%', borderRadius: '3px', background: cfg.color, transition: 'width 0.5s' }} />
                            </div>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-text)', minWidth: '36px', textAlign: 'right' }}>
                              {ts.raw_score.toFixed(1)}
                            </span>
                            <RatingBadge rating={ts.rating} size="sm" />
                          </button>

                          {/* Expanded answers */}
                          {isExpanded && themeAnswers.length > 0 && (
                            <div style={{ margin: '4px 0 8px 32px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {themeAnswers.map(ans => (
                                <div key={ans.id} style={{
                                  padding: '12px 16px', borderRadius: '8px',
                                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)',
                                  fontSize: '12px',
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                    <span style={{
                                      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, flexShrink: 0,
                                      background: ans.answer === 'Sim' ? 'rgba(34,197,94,0.15)' : ans.answer === 'Não' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                                      color: ans.answer === 'Sim' ? 'var(--color-primary)' : ans.answer === 'Não' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                                    }}>
                                      {ans.answer}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                      <p style={{ fontWeight: 600, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                                        <span style={{ color: 'var(--color-text-faint)', marginRight: '6px' }}>[{ans.esg_questions?.question_id}]</span>
                                        {ans.esg_questions?.question_text}
                                      </p>
                                      {ans.justification && <p style={{ color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: 1.5 }}>{ans.justification}</p>}
                                      {ans.source_reference && <p style={{ color: 'var(--color-primary-light)', marginTop: '4px', fontSize: '11px' }}>📄 {ans.source_reference}</p>}
                                      {ans.improvement_points && <p style={{ color: 'var(--color-warning)', marginTop: '4px', fontSize: '11px' }}>💡 {ans.improvement_points}</p>}
                                    </div>
                                    <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', flexShrink: 0 }}>
                                      {(ans.confidence_score * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Metadata */}
          <div style={{
            padding: '16px 20px', borderRadius: '12px',
            background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
            display: 'flex', gap: '24px', fontSize: '12px', color: 'var(--color-text-muted)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock style={{ width: '12px', height: '12px' }} />
              Concluída: {analysis.completed_at ? new Date(analysis.completed_at).toLocaleString('pt-BR') : '—'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileSpreadsheet style={{ width: '12px', height: '12px' }} />
              {answers.length} respostas
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BarChart3 style={{ width: '12px', height: '12px' }} />
              {themeScores.length} temas avaliados
            </span>
          </div>
        </>
      )}

      {/* History */}
      {history.length > 1 && (
        <div style={{ marginTop: '32px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
            Histórico de Análises
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {history.filter(h => h.report_year !== reportYear).map(h => (
              <button
                key={h.id}
                onClick={() => { setReportYear(h.report_year); setLoading(true); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                  borderRadius: '10px', background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
                  cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{h.report_year}</span>
                <span style={{ flex: 1, fontSize: '12px', color: 'var(--color-text-muted)' }}>{h.status}</span>
                {h.overall_rating && <RatingBadge rating={h.overall_rating} size="sm" />}
                <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{h.overall_score?.toFixed(1) || '—'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
