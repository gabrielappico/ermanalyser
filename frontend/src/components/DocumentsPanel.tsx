import { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  ChevronRight,
  File,
  Layers,
  FolderCheck,
  Hash,
  Calendar,
  Globe,
  Link2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
  Download,
  CheckSquare,
  Square,
  Radar,
} from 'lucide-react';
import { getDocuments, uploadDocument, deleteDocument, discoverDocuments, batchAddUrls } from '../api';
import type { Company } from '../App';
import DocumentProcessingView from './DocumentProcessingView';

interface Doc {
  id: string;
  filename: string;
  source_type: string;
  source_url?: string;
  status: string;
  chunk_count: number;
  page_count: number;
  report_year: number;
  created_at: string;
  companies?: { name: string };
}

interface Props {
  company: Company;
  onGoToAnalysis: () => void;
}

type InputMode = 'pdf' | 'url' | 'discover';

interface DiscoveredDoc {
  url: string;
  name: string;
  file_type: string;
  relevance_score: number;
  link_text: string;
}

export default function DocumentsPanel({ company, onGoToAnalysis }: Props) {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [reportYear, setReportYear] = useState(new Date().getFullYear() - 1);
  const [processingFile, setProcessingFile] = useState<File | null>(null);
  const [processingUrl, setProcessingUrl] = useState<string | null>(null);
  const [processingUrlName, setProcessingUrlName] = useState<string>('');
  const [inputMode, setInputMode] = useState<InputMode>('pdf');
  const [urlInput, setUrlInput] = useState('');
  const [urlName, setUrlName] = useState('');
  const [urlSubmitting] = useState(false);
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  // Auto-discovery state
  const [discoverUrl, setDiscoverUrl] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoveredDocs, setDiscoveredDocs] = useState<DiscoveredDoc[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [batchAdding, setBatchAdding] = useState(false);
  const [discoverError, setDiscoverError] = useState('');

  const fetchDocs = useCallback(async () => {
    try {
      const res = await getDocuments(company.id);
      setDocuments(res.data);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  }, [company.id]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  useEffect(() => {
    const processingDocs = documents.filter(d => d.status === 'processing' || d.status === 'uploading');
    if (processingDocs.length === 0) return;
    const interval = setInterval(fetchDocs, 3000);
    return () => clearInterval(interval);
  }, [documents, fetchDocs]);

  const handleUpload = async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) return;

    if (pdfFiles.length === 1) {
      setProcessingFile(pdfFiles[0]);
      return;
    }

    setUploading(true);
    try {
      for (const file of pdfFiles) {
        await uploadDocument(file, company.id, reportYear);
      }
      await fetchDocs();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleUrlSubmit = () => {
    if (!urlInput.trim()) return;
    setProcessingUrl(urlInput.trim());
    setProcessingUrlName(urlName.trim());
    setUrlInput('');
    setUrlName('');
  };

  const handleProcessingComplete = () => {
    setProcessingFile(null);
    setProcessingUrl(null);
    setProcessingUrlName('');
    fetchDocs();
  };

  const handleProcessingError = (msg: string) => {
    console.error('Processing error:', msg);
    setProcessingFile(null);
    setProcessingUrl(null);
    setProcessingUrlName('');
    fetchDocs();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) handleUpload(e.dataTransfer.files);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este documento?')) return;
    try {
      await deleteDocument(id);
      fetchDocs();
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  const toggleYear = (year: number) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  // --- Auto-discovery handlers ---
  const handleDiscover = async () => {
    if (!discoverUrl.trim()) return;
    setDiscovering(true);
    setDiscoveredDocs([]);
    setSelectedDocs(new Set());
    setDiscoverError('');
    try {
      const res = await discoverDocuments(discoverUrl.trim());
      const docs = res.data.documents || [];
      setDiscoveredDocs(docs);
      // Auto-select PDFs with high relevance
      const autoSelected = new Set<string>();
      docs.forEach((d: DiscoveredDoc) => {
        if (d.file_type === 'pdf' && d.relevance_score >= 2) {
          autoSelected.add(d.url);
        }
      });
      setSelectedDocs(autoSelected);
    } catch (err: any) {
      console.error('Discovery failed:', err);
      setDiscoverError(err?.response?.data?.detail || 'Falha ao buscar documentos. Verifique a URL.');
    } finally {
      setDiscovering(false);
    }
  };

  const toggleDocSelection = (url: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAllDocs = () => {
    if (selectedDocs.size === discoveredDocs.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(discoveredDocs.map(d => d.url)));
    }
  };

  const handleBatchAdd = async () => {
    if (selectedDocs.size === 0) return;
    setBatchAdding(true);
    try {
      const docsToAdd = discoveredDocs
        .filter(d => selectedDocs.has(d.url))
        .map(d => ({ url: d.url, name: d.name, file_type: d.file_type }));
      await batchAddUrls(company.id, reportYear, docsToAdd);
      setDiscoveredDocs([]);
      setSelectedDocs(new Set());
      setDiscoverUrl('');
      fetchDocs();
    } catch (err) {
      console.error('Batch add failed:', err);
    } finally {
      setBatchAdding(false);
    }
  };

  // Group documents by year
  const docsByYear = documents.reduce<Record<number, Doc[]>>((acc, doc) => {
    const yr = doc.report_year;
    if (!acc[yr]) acc[yr] = [];
    acc[yr].push(doc);
    return acc;
  }, {});

  const sortedYears = Object.keys(docsByYear).map(Number).sort((a, b) => b - a);

  const readyCount = documents.filter(d => d.status === 'ready').length;
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunk_count || 0), 0);
  const totalPages = documents.reduce((sum, d) => sum + (d.page_count || 0), 0);
  const urlCount = documents.filter(d => d.source_type === 'url' || d.source_url).length;

  const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
    ready: { icon: CheckCircle2, color: 'var(--color-success)', bg: 'var(--color-success-glow)', label: 'Processado' },
    processing: { icon: Loader2, color: 'var(--color-warning)', bg: 'rgba(245, 158, 11, 0.1)', label: 'Processando...' },
    uploading: { icon: Loader2, color: 'var(--color-primary-light)', bg: 'var(--color-primary-glow)', label: 'Enviando...' },
    error: { icon: XCircle, color: 'var(--color-danger)', bg: 'var(--color-danger-glow)', label: 'Erro' },
  };

  const stats = [
    { label: 'Documentos', value: documents.length, sub: `${totalPages} páginas · ${urlCount} URL${urlCount !== 1 ? 's' : ''}`, icon: Layers, iconBg: 'rgba(59, 130, 246, 0.1)', iconColor: '#3b82f6' },
    { label: 'Processados', value: readyCount, sub: 'prontos para análise', icon: FolderCheck, iconBg: 'var(--color-success-glow)', iconColor: 'var(--color-success)' },
    { label: 'Chunks', value: totalChunks, sub: 'trechos indexados', icon: Hash, iconBg: 'var(--color-primary-glow)', iconColor: 'var(--color-primary-light)' },
  ];

  const yearOptions = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  // Show processing view when actively processing a file or URL
  if (processingFile || processingUrl) {
    return (
      <div className="animate-fade-in">
        <div style={{ marginBottom: '24px' }}>
          <h2 className="gradient-text" style={{ fontSize: '28px', fontWeight: 800, margin: 0, lineHeight: 1.2 }}>
            Documentos
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
            {company.name} — {processingUrl ? 'Processando URL' : 'Processando relatório'}
          </p>
        </div>
        <DocumentProcessingView
          file={processingFile}
          url={processingUrl || undefined}
          customName={processingUrlName || undefined}
          companyId={company.id}
          reportYear={reportYear}
          onComplete={handleProcessingComplete}
          onError={handleProcessingError}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h2 className="gradient-text" style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
            Documentos
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
            {company.name} {company.ticker && `(${company.ticker})`} — Upload de relatórios ESG
          </p>
        </div>
        {readyCount > 0 && (
          <button
            onClick={onGoToAnalysis}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '13px', flexShrink: 0 }}
          >
            Analisar ESG
            <ChevronRight style={{ width: '16px', height: '16px' }} />
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 100}ms`,
                padding: '20px',
                borderRadius: '16px',
                background: 'var(--color-surface-light)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px', background: stat.iconBg }}>
                <Icon style={{ width: '18px', height: '18px', color: stat.iconColor }} />
              </div>
              <p style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-text)', margin: 0, lineHeight: 1 }}>{stat.value}</p>
              <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginTop: '4px' }}>{stat.label}</p>
              <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '2px' }}>{stat.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Year Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Calendar style={{ width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Ano do Relatório:</span>
        <select
          value={reportYear}
          onChange={e => setReportYear(Number(e.target.value))}
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Input Mode Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', padding: '4px', borderRadius: '12px', background: 'rgba(0,99,58,0.03)', border: '1px solid var(--color-border)', width: 'fit-content' }}>
        <button
          onClick={() => setInputMode('pdf')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: inputMode === 'pdf' ? 'var(--color-primary-glow)' : 'transparent',
            color: inputMode === 'pdf' ? 'var(--color-primary-light)' : 'var(--color-text-muted)',
          }}
        >
          <Upload style={{ width: '14px', height: '14px' }} />
          Upload PDF
        </button>
        <button
          onClick={() => setInputMode('url')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: inputMode === 'url' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
            color: inputMode === 'url' ? '#a78bfa' : 'var(--color-text-muted)',
          }}
        >
          <Globe style={{ width: '14px', height: '14px' }} />
          Adicionar URL
        </button>
        <button
          onClick={() => setInputMode('discover')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            background: inputMode === 'discover' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
            color: inputMode === 'discover' ? '#34d399' : 'var(--color-text-muted)',
          }}
        >
          <Radar style={{ width: '14px', height: '14px' }} />
          Auto-Discovery RI
        </button>
      </div>

      {/* PDF Drop Zone */}
      {inputMode === 'pdf' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          style={{
            marginBottom: '32px',
            padding: '40px 24px',
            borderRadius: '16px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            border: dragActive ? '2px solid var(--color-primary)' : '2px dashed var(--color-border-light)',
            background: dragActive ? 'rgba(0, 99, 58, 0.04)' : 'rgba(255, 255, 255, 0.6)',
            boxShadow: dragActive ? '0 0 30px var(--color-primary-glow)' : 'none',
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf';
            input.multiple = true;
            input.onchange = e => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleUpload(files);
            };
            input.click();
          }}
        >
          <div style={{ width: '56px', height: '56px', margin: '0 auto 16px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: uploading ? 'var(--color-primary-glow)' : 'rgba(0,99,58,0.03)', border: '1px solid var(--color-border)' }}>
            {uploading ? (
              <Loader2 style={{ width: '24px', height: '24px', color: 'var(--color-primary-light)', animation: 'spin 1s linear infinite' }} />
            ) : (
              <Upload style={{ width: '24px', height: '24px', color: 'var(--color-text-muted)' }} />
            )}
          </div>
          <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
            {uploading ? 'Enviando arquivos...' : `Arraste PDFs aqui — Ano: ${reportYear}`}
          </p>
          <p style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
            Relatórios de sustentabilidade, formulários de referência, relatórios anuais
          </p>
        </div>
      )}

      {/* URL Input Zone */}
      {inputMode === 'url' && (
        <div style={{
          marginBottom: '32px',
          padding: '24px',
          borderRadius: '16px',
          background: 'rgba(255, 255, 255, 0.6)',
          border: '2px solid var(--color-border-light)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
              <Link2 style={{ width: '20px', height: '20px', color: '#a78bfa' }} />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                Adicionar fonte HTML — Ano: {reportYear}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                Cole a URL de uma página de relatório, indicadores ou dados ESG
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://centraldesustentabilidade.suzano.com.br/indicadores/..."
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'var(--color-surface-light)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#a78bfa'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
              onKeyDown={e => { if (e.key === 'Enter' && urlInput.trim()) handleUrlSubmit(); }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={urlName}
                onChange={e => setUrlName(e.target.value)}
                placeholder="Nome personalizado (opcional)"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'var(--color-surface-light)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontSize: '12px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#a78bfa'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
              />
              <button
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim() || urlSubmitting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 20px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                  border: 'none', cursor: urlInput.trim() && !urlSubmitting ? 'pointer' : 'not-allowed',
                  background: urlInput.trim() ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : 'rgba(255,255,255,0.05)',
                  color: urlInput.trim() ? '#fff' : 'var(--color-text-faint)',
                  transition: 'all 0.2s', flexShrink: 0,
                  opacity: urlSubmitting ? 0.7 : 1,
                }}
              >
                {urlSubmitting ? (
                  <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Globe style={{ width: '14px', height: '14px' }} />
                )}
                {urlSubmitting ? 'Adicionando...' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Discovery Zone */}
      {inputMode === 'discover' && (
        <div style={{
          marginBottom: '32px',
          padding: '24px',
          borderRadius: '16px',
          background: 'rgba(255, 255, 255, 0.6)',
          border: '2px solid rgba(16, 185, 129, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <Radar style={{ width: '20px', height: '20px', color: '#34d399' }} />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                Auto-Discovery — Ano: {reportYear}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                Insira a URL da página de RI/Sustentabilidade da empresa para encontrar documentos automaticamente
              </p>
            </div>
          </div>

          {/* Search input */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: discoveredDocs.length > 0 || discoverError ? '16px' : 0 }}>
            <input
              type="url"
              value={discoverUrl}
              onChange={e => setDiscoverUrl(e.target.value)}
              placeholder="https://ri.suzano.com.br/sustentabilidade/downloads/"
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'var(--color-surface-light)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#34d399'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
              onKeyDown={e => { if (e.key === 'Enter' && discoverUrl.trim()) handleDiscover(); }}
            />
            <button
              onClick={handleDiscover}
              disabled={!discoverUrl.trim() || discovering}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 20px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                border: 'none',
                cursor: discoverUrl.trim() && !discovering ? 'pointer' : 'not-allowed',
                background: discoverUrl.trim() ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)',
                color: discoverUrl.trim() ? '#fff' : 'var(--color-text-faint)',
                transition: 'all 0.2s', flexShrink: 0,
                opacity: discovering ? 0.7 : 1,
              }}
            >
              {discovering ? (
                <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
              ) : (
                <Search style={{ width: '14px', height: '14px' }} />
              )}
              {discovering ? 'Buscando...' : 'Descobrir'}
            </button>
          </div>

          {/* Error */}
          {discoverError && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', marginBottom: '12px' }}>
              <p style={{ fontSize: '12px', color: 'var(--color-danger)', margin: 0 }}>
                <XCircle style={{ width: '12px', height: '12px', display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                {discoverError}
              </p>
            </div>
          )}

          {/* Discovered documents list */}
          {discoveredDocs.length > 0 && (
            <div>
              {/* Header with select all + batch add */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--color-border)' }}>
                <button
                  onClick={selectAllDocs}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', transition: 'color 0.2s' }}
                >
                  {selectedDocs.size === discoveredDocs.length ? (
                    <CheckSquare style={{ width: '14px', height: '14px', color: '#34d399' }} />
                  ) : (
                    <Square style={{ width: '14px', height: '14px' }} />
                  )}
                  {selectedDocs.size === discoveredDocs.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginLeft: '4px' }}>
                    ({discoveredDocs.length} encontrados · {selectedDocs.size} selecionados)
                  </span>
                </button>

                <button
                  onClick={handleBatchAdd}
                  disabled={selectedDocs.size === 0 || batchAdding}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 16px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
                    border: 'none',
                    cursor: selectedDocs.size > 0 && !batchAdding ? 'pointer' : 'not-allowed',
                    background: selectedDocs.size > 0 ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)',
                    color: selectedDocs.size > 0 ? '#fff' : 'var(--color-text-faint)',
                    transition: 'all 0.2s',
                    opacity: batchAdding ? 0.7 : 1,
                  }}
                >
                  {batchAdding ? (
                    <Loader2 style={{ width: '12px', height: '12px', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Download style={{ width: '12px', height: '12px' }} />
                  )}
                  {batchAdding ? 'Importando...' : `Importar ${selectedDocs.size} documentos`}
                </button>
              </div>

              {/* Document candidates */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '400px', overflowY: 'auto' }}>
                {discoveredDocs.map((doc, i) => {
                  const isSelected = selectedDocs.has(doc.url);
                  const isPdf = doc.file_type === 'pdf';
                  const relevanceColor = doc.relevance_score >= 5 ? '#34d399' : doc.relevance_score >= 3 ? '#fbbf24' : 'var(--color-text-faint)';

                  return (
                    <div
                      key={doc.url}
                      onClick={() => toggleDocSelection(doc.url)}
                      className="animate-fade-in"
                      style={{
                        animationDelay: `${i * 30}ms`,
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '8px',
                        background: isSelected ? 'rgba(16, 185, 129, 0.06)' : 'var(--color-surface-light)',
                        border: `1px solid ${isSelected ? 'rgba(16, 185, 129, 0.25)' : 'transparent'}`,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {/* Checkbox */}
                      {isSelected ? (
                        <CheckSquare style={{ width: '16px', height: '16px', color: '#34d399', flexShrink: 0 }} />
                      ) : (
                        <Square style={{ width: '16px', height: '16px', color: 'var(--color-text-faint)', flexShrink: 0 }} />
                      )}

                      {/* Type badge */}
                      <span style={{
                        fontSize: '9px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px',
                        textTransform: 'uppercase', flexShrink: 0,
                        background: isPdf ? 'rgba(239, 68, 68, 0.1)' : 'rgba(139, 92, 246, 0.1)',
                        color: isPdf ? '#f87171' : '#a78bfa',
                      }}>
                        {doc.file_type}
                      </span>

                      {/* Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.name}
                        </p>
                        <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {doc.url}
                        </p>
                      </div>

                      {/* Relevance score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <div style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: relevanceColor,
                        }} />
                        <span style={{ fontSize: '10px', fontWeight: 600, color: relevanceColor }}>
                          {doc.relevance_score}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state when discovering */}
          {discovering && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Loader2 style={{ width: '32px', height: '32px', color: '#34d399', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', margin: 0 }}>
                Navegando na página e buscando documentos...
              </p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                Isso pode levar de 15 a 30 segundos para páginas com JavaScript
              </p>
            </div>
          )}
        </div>
      )}

      {/* Document List — Grouped by Year */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '64px' }} />)}
        </div>
      ) : documents.length === 0 ? (
        <div className="animate-fade-in" style={{ textAlign: 'center', padding: '64px 0' }}>
          <div className="animate-float" style={{ width: '64px', height: '64px', margin: '0 auto 20px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,99,58,0.04)', border: '1px solid var(--color-border)' }}>
            <FileText style={{ width: '28px', height: '28px', color: 'var(--color-text-faint)' }} />
          </div>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Nenhum documento enviado</p>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>Faça upload de PDFs ou adicione URLs para iniciar a análise</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {sortedYears.map(year => {
            const yearDocs = docsByYear[year];
            const isCollapsed = collapsedYears.has(year);
            const yearReady = yearDocs.filter(d => d.status === 'ready').length;
            const yearUrls = yearDocs.filter(d => d.source_type === 'url' || d.source_url).length;
            const yearPdfs = yearDocs.length - yearUrls;

            return (
              <div key={year} className="animate-fade-in">
                {/* Year Header */}
                <button
                  onClick={() => toggleYear(year)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '12px 16px', marginBottom: isCollapsed ? 0 : '8px',
                    borderRadius: isCollapsed ? '12px' : '12px 12px 0 0',
                    background: 'linear-gradient(135deg, rgba(0, 99, 58, 0.05), rgba(59, 130, 246, 0.03))',
                    border: '1px solid var(--color-border)',
                    borderBottom: isCollapsed ? '1px solid var(--color-border)' : '1px solid transparent',
                    cursor: 'pointer', transition: 'all 0.2s',
                    color: 'var(--color-text)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 99, 58, 0.08), rgba(59, 130, 246, 0.06))'}
                  onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 99, 58, 0.05), rgba(59, 130, 246, 0.03))'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Calendar style={{ width: '16px', height: '16px', color: 'var(--color-primary-light)' }} />
                    <span style={{ fontSize: '15px', fontWeight: 700 }}>
                      {year}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                      {yearDocs.length} doc{yearDocs.length !== 1 ? 's' : ''}
                      {yearPdfs > 0 && ` · ${yearPdfs} PDF`}
                      {yearUrls > 0 && ` · ${yearUrls} URL`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px',
                      background: yearReady === yearDocs.length ? 'var(--color-success-glow)' : 'rgba(245, 158, 11, 0.1)',
                      color: yearReady === yearDocs.length ? 'var(--color-success)' : 'var(--color-warning)',
                    }}>
                      {yearReady}/{yearDocs.length} prontos
                    </span>
                    {isCollapsed ? (
                      <ChevronDown style={{ width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                    ) : (
                      <ChevronUp style={{ width: '16px', height: '16px', color: 'var(--color-text-muted)' }} />
                    )}
                  </div>
                </button>

                {/* Year Documents */}
                {!isCollapsed && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    padding: '8px',
                    borderRadius: '0 0 12px 12px',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid var(--color-border)',
                    borderTop: 'none',
                  }}>
                    {yearDocs.map((doc, i) => {
                      const status = statusConfig[doc.status] || statusConfig.error;
                      const StatusIcon = status.icon;
                      const isAnimating = doc.status === 'processing' || doc.status === 'uploading';
                      const isUrl = doc.source_type === 'url' || !!doc.source_url;

                      return (
                        <div
                          key={doc.id}
                          className="group animate-fade-in"
                          style={{
                            animationDelay: `${i * 40}ms`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            background: 'var(--color-surface-light)',
                            border: '1px solid transparent',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-active)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--color-surface-light)'; }}
                        >
                          {/* Icon — different for URL vs PDF */}
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '10px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            background: isUrl ? 'rgba(139, 92, 246, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                            border: `1px solid ${isUrl ? 'rgba(139, 92, 246, 0.15)' : 'rgba(239, 68, 68, 0.1)'}`,
                          }}>
                            {isUrl ? (
                              <Globe style={{ width: '18px', height: '18px', color: '#a78bfa' }} />
                            ) : (
                              <File style={{ width: '18px', height: '18px', color: '#f87171' }} />
                            )}
                          </div>

                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {doc.filename}
                              </p>
                              {isUrl && (
                                <span style={{
                                  fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px',
                                  background: 'rgba(139, 92, 246, 0.12)', color: '#a78bfa',
                                  textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                                }}>
                                  URL
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                                {doc.chunk_count > 0 ? `${doc.chunk_count} chunks · ${doc.page_count || '?'} pgs` : doc.source_type.toUpperCase()}
                                {' · '}
                                {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                              </p>
                              {doc.source_url && (
                                <a
                                  href={doc.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                  title={doc.source_url}
                                >
                                  <ExternalLink style={{ width: '11px', height: '11px', color: 'var(--color-text-faint)', transition: 'color 0.2s' }} />
                                </a>
                              )}
                            </div>
                          </div>

                          {/* Status badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: status.bg, color: status.color, flexShrink: 0 }}>
                            <StatusIcon style={{ width: '12px', height: '12px', ...(isAnimating ? { animation: 'spin 1s linear infinite' } : {}) }} />
                            {status.label}
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(doc.id)}
                            style={{ padding: '6px', borderRadius: '8px', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0, opacity: 0.3 }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-danger-glow)'; e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.opacity = '1'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.opacity = '0.3'; }}
                          >
                            <Trash2 style={{ width: '14px', height: '14px' }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
