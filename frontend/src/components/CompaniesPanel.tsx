import { useState, useEffect, useRef, useCallback } from 'react';
import { Building2, Plus, Search, Trash2, ArrowRight, TrendingUp, X, ChevronDown, Check } from 'lucide-react';
import { getCompanies, createCompany, deleteCompany } from '../api';
import { BOVESPA_UNIQUE, B3_SECTORS } from '../data/bovespa';
import type { BovespaCompany } from '../data/bovespa';
import type { Company } from '../App';

interface Props {
  onSelectCompany: (company: Company) => void;
}

const SECTOR_STYLES: Record<string, { gradient: string; color: string; bg: string }> = {
  'Energia':                          { gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  'Mineração':                        { gradient: 'linear-gradient(135deg, #ea580c, #c2410c)', color: '#ea580c', bg: 'rgba(234,88,12,0.1)' },
  'Financeiro':                       { gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  'Tecnologia da Informação':         { gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
  'Saúde':                            { gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)', color: '#f43f5e', bg: 'rgba(244,63,94,0.1)' },
  'Varejo':                           { gradient: 'linear-gradient(135deg, #10b981, #059669)', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  'Agronegócio':                      { gradient: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  'Petróleo, Gás e Biocombustíveis':  { gradient: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  'Materiais Básicos':                { gradient: 'linear-gradient(135deg, #64748b, #475569)', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  'Bens Industriais':                 { gradient: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)' },
  'Consumo Não Cíclico':              { gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)', color: '#14b8a6', bg: 'rgba(20,184,166,0.1)' },
  'Consumo Cíclico':                  { gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  'Telecomunicações':                 { gradient: 'linear-gradient(135deg, #ec4899, #db2777)', color: '#ec4899', bg: 'rgba(236,72,153,0.1)' },
  'Utilidade Pública':                { gradient: 'linear-gradient(135deg, #eab308, #ca8a04)', color: '#eab308', bg: 'rgba(234,179,8,0.1)' },
  'Imobiliário':                      { gradient: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  'Transporte e Logística':           { gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
  'Saneamento':                       { gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#22d3ee', bg: 'rgba(34,211,238,0.1)' },
  'Seguros':                          { gradient: 'linear-gradient(135deg, #f472b6, #ec4899)', color: '#f472b6', bg: 'rgba(244,114,182,0.1)' },
  'Construção Civil':                 { gradient: 'linear-gradient(135deg, #fb923c, #f97316)', color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
  'Educação':                         { gradient: 'linear-gradient(135deg, #a3e635, #84cc16)', color: '#a3e635', bg: 'rgba(163,230,53,0.1)' },
};

const DEFAULT_STYLE = { gradient: 'linear-gradient(135deg, #64748b, #475569)', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };

function getSectorStyle(name: string) {
  return SECTOR_STYLES[name] || DEFAULT_STYLE;
}

// --- Combobox for Company selection (autocomplete with Bovespa data) ---
function CompanyCombobox({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (company: BovespaCompany) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = value.trim().length > 0
    ? BOVESPA_UNIQUE.filter(
        c =>
          c.name.toLowerCase().includes(value.toLowerCase()) ||
          c.ticker.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 15)
    : BOVESPA_UNIQUE.slice(0, 15);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      onSelect(filtered[highlightIdx]);
      setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Scroll into view
  useEffect(() => {
    if (listRef.current && highlightIdx >= 0) {
      const el = listRef.current.children[highlightIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Digite nome ou ticker (ex: PETR4, Itaú...)"
          autoComplete="off"
          style={{
            width: '100%',
            padding: '10px 36px 10px 16px',
            borderRadius: '10px',
            fontSize: '13px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-light)',
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
          }}
        />
        <ChevronDown
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            width: '14px',
            height: '14px',
            color: 'var(--color-text-muted)',
            transition: 'transform 0.2s',
            pointerEvents: 'none',
          }}
        />
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '280px',
            overflowY: 'auto',
            borderRadius: '12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-light)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 100,
            padding: '4px',
          }}
        >
          {filtered.map((company, idx) => {
            const sectorStyle = getSectorStyle(company.sector);
            const isHighlighted = idx === highlightIdx;
            return (
              <button
                key={company.ticker}
                type="button"
                onClick={() => { onSelect(company); setOpen(false); }}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isHighlighted ? 'rgba(0, 99, 58, 0.06)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--color-primary-light)',
                    background: 'rgba(0, 99, 58, 0.08)',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    minWidth: '56px',
                    textAlign: 'center',
                    letterSpacing: '0.04em',
                  }}
                >
                  {company.ticker}
                </span>
                <span style={{ flex: 1, fontSize: '13px', color: 'var(--color-text)', fontWeight: 500 }}>
                  {company.name}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: sectorStyle.color,
                    background: sectorStyle.bg,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {company.sector}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Combobox for Sector (allows custom entry) ---
function SectorCombobox({
  value,
  onChange,
  extraSectors,
}: {
  value: string;
  onChange: (v: string) => void;
  extraSectors: string[];
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allSectors = [...new Set([...B3_SECTORS, ...extraSectors])].sort();

  const filtered = inputValue.trim().length > 0
    ? allSectors.filter(s => s.toLowerCase().includes(inputValue.toLowerCase()))
    : allSectors;

  const isNewSector = inputValue.trim().length > 0 && !allSectors.some(s => s.toLowerCase() === inputValue.toLowerCase());

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (inputValue.trim()) onChange(inputValue.trim());
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [inputValue, onChange]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [inputValue]);

  const totalItems = filtered.length + (isNewSector ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isNewSector && highlightIdx === 0) {
        onChange(inputValue.trim());
        setOpen(false);
      } else {
        const adjustedIdx = isNewSector ? highlightIdx - 1 : highlightIdx;
        if (adjustedIdx >= 0 && adjustedIdx < filtered.length) {
          onChange(filtered[adjustedIdx]);
          setInputValue(filtered[adjustedIdx]);
          setOpen(false);
        }
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (listRef.current && highlightIdx >= 0) {
      const el = listRef.current.children[highlightIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  const selectSector = useCallback((sector: string) => {
    onChange(sector);
    setInputValue(sector);
    setOpen(false);
  }, [onChange]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Selecione ou digite um setor..."
          autoComplete="off"
          style={{
            width: '100%',
            padding: '10px 36px 10px 16px',
            borderRadius: '10px',
            fontSize: '13px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-light)',
            color: value ? 'var(--color-text)' : 'var(--color-text-muted)',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
          }}
        />
        <ChevronDown
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            width: '14px',
            height: '14px',
            color: 'var(--color-text-muted)',
            transition: 'transform 0.2s',
            pointerEvents: 'none',
          }}
        />
      </div>

      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '240px',
            overflowY: 'auto',
            borderRadius: '12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-light)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 100,
            padding: '4px',
          }}
        >
          {isNewSector && (
            <button
              type="button"
              onClick={() => selectSector(inputValue.trim())}
              onMouseEnter={() => setHighlightIdx(0)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: 'none',
                background: highlightIdx === 0 ? 'rgba(0, 99, 58, 0.06)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: '13px',
                color: 'var(--color-primary-light)',
                fontWeight: 600,
                transition: 'background 0.15s',
              }}
            >
              <Plus style={{ width: '14px', height: '14px' }} />
              Criar setor: "{inputValue.trim()}"
            </button>
          )}

          {filtered.map((sector, idx) => {
            const adjustedIdx = isNewSector ? idx + 1 : idx;
            const isHighlighted = adjustedIdx === highlightIdx;
            const isSelected = sector === value;
            const style = getSectorStyle(sector);
            return (
              <button
                key={sector}
                type="button"
                onClick={() => selectSector(sector)}
                onMouseEnter={() => setHighlightIdx(adjustedIdx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isHighlighted ? 'rgba(0, 99, 58, 0.06)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: style.gradient,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: '13px', color: 'var(--color-text)', fontWeight: isSelected ? 600 : 400 }}>
                  {sector}
                </span>
                {isSelected && (
                  <Check style={{ width: '14px', height: '14px', color: 'var(--color-primary-light)' }} />
                )}
              </button>
            );
          })}

          {filtered.length === 0 && !isNewSector && (
            <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Nenhum setor encontrado
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main CompaniesPanel ---
export default function CompaniesPanel({ onSelectCompany }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', ticker: '', sector: '' });
  const [customSectors, setCustomSectors] = useState<string[]>([]);

  const fetchCompanies = async () => {
    try {
      const res = await getCompanies();
      setCompanies(res.data);

      // Collect custom sectors from existing companies
      const existingSectors = new Set(B3_SECTORS as readonly string[]);
      const extras = res.data
        .map((c: Company) => c.sector)
        .filter((s: string | undefined): s is string => !!s && !existingSectors.has(s));
      setCustomSectors([...new Set<string>(extras)]);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompanies(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const payload: { name: string; ticker?: string; sector?: string } = {
        name: form.name.trim(),
      };
      if (form.ticker.trim()) payload.ticker = form.ticker.trim();
      if (form.sector.trim()) payload.sector = form.sector.trim();
      await createCompany(payload);
      setForm({ name: '', ticker: '', sector: '' });
      setShowForm(false);
      fetchCompanies();
    } catch (err) {
      console.error('Failed to create company:', err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Excluir esta empresa e todos os seus documentos?')) return;
    try {
      await deleteCompany(id);
      fetchCompanies();
    } catch (err) {
      console.error('Failed to delete company:', err);
    }
  };

  const handleSelectBovespa = (company: BovespaCompany) => {
    setForm({
      name: company.name,
      ticker: company.ticker,
      sector: company.sector,
    });
  };

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.ticker || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.sector || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: '32px',
        }}
      >
        <div>
          <h2 className="gradient-text" style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
            Empresas
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
            Gerencie as empresas listadas em bolsa para análise ESG
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            fontSize: '13px',
            flexShrink: 0,
          }}
        >
          {showForm ? <X style={{ width: '16px', height: '16px' }} /> : <Plus style={{ width: '16px', height: '16px' }} />}
          {showForm ? 'Cancelar' : 'Nova Empresa'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="animate-fade-in-scale"
          style={{
            marginBottom: '32px',
            padding: '24px',
            borderRadius: '16px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border-light)',
            boxShadow: 'var(--shadow-lg)',
            position: 'relative',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              Cadastrar nova empresa
            </p>
            <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
              Busque por ticker ou nome para auto-preencher
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr', gap: '16px' }}>
            {/* Company Name / Autocomplete */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                Empresa (Bovespa) *
              </label>
              <CompanyCombobox
                value={form.name}
                onChange={v => setForm(f => ({ ...f, name: v }))}
                onSelect={handleSelectBovespa}
              />
            </div>

            {/* Ticker (auto-filled or manual) */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                Ticker
              </label>
              <input
                type="text"
                value={form.ticker}
                onChange={e => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                placeholder="Ex: PETR4"
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  background: form.ticker ? 'rgba(0, 99, 58, 0.04)' : 'var(--color-surface)',
                  border: `1px solid ${form.ticker ? 'rgba(0, 99, 58, 0.2)' : 'var(--color-border-light)'}`,
                  color: 'var(--color-primary-light)',
                  letterSpacing: '0.05em',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Sector Combobox (editable) */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', color: 'var(--color-text-muted)' }}>
                Setor
              </label>
              <SectorCombobox
                value={form.sector}
                onChange={v => setForm(f => ({ ...f, sector: v }))}
                extraSectors={customSectors}
              />
            </div>
          </div>

          {/* Selected preview chip */}
          {form.ticker && form.sector && (
            <div
              className="animate-fade-in"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginTop: '16px',
                padding: '10px 16px',
                borderRadius: '10px',
                background: 'rgba(0, 99, 58, 0.04)',
                border: '1px solid rgba(0, 99, 58, 0.1)',
              }}
            >
              <TrendingUp style={{ width: '16px', height: '16px', color: 'var(--color-primary-light)' }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
                {form.name}
              </span>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-primary-light)',
                  background: 'var(--color-primary-glow)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {form.ticker}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: getSectorStyle(form.sector).color,
                  background: getSectorStyle(form.sector).bg,
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {form.sector}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm({ name: '', ticker: '', sector: '' }); }}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '10px 24px', fontSize: '13px' }}
            >
              Cadastrar
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <Search
          style={{
            position: 'absolute',
            left: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '16px',
            height: '16px',
            color: 'var(--color-text-muted)',
          }}
        />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome, ticker ou setor..."
          style={{
            width: '100%',
            padding: '12px 16px 12px 44px',
            borderRadius: '12px',
            fontSize: '13px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Company Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: '160px' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="animate-fade-in" style={{ textAlign: 'center', padding: '80px 0' }}>
          <div
            className="animate-float"
            style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 24px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,99,58,0.03)',
              border: '1px solid var(--color-border)',
            }}
          >
            <Building2 style={{ width: '32px', height: '32px', color: 'var(--color-text-faint)' }} />
          </div>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
            {search ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada'}
          </p>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
            {search ? 'Tente outro termo de busca' : 'Cadastre a primeira empresa para começar'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filtered.map((company, i) => {
            const sectorStyle = getSectorStyle(company.sector || '');
            return (
              <div
                key={company.id}
                onClick={() => onSelectCompany(company)}
                className="group animate-fade-in"
                style={{
                  animationDelay: `${i * 80}ms`,
                  borderRadius: '16px',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  background: 'var(--color-surface-light)',
                  border: '1px solid var(--color-border)',
                  transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 99, 58, 0.2)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.06), 0 0 0 1px rgba(0, 99, 58, 0.08)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* Top gradient accent bar */}
                <div style={{ height: '3px', width: '100%', background: sectorStyle.gradient }} />

                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0, 99, 58, 0.06)',
                          border: '1px solid rgba(0, 99, 58, 0.1)',
                          transition: 'all 0.3s',
                        }}
                      >
                        <TrendingUp style={{ width: '20px', height: '20px', color: 'var(--color-primary-light)' }} />
                      </div>
                      <div>
                        <h3 style={{ fontWeight: 700, fontSize: '15px', lineHeight: 1.3, color: 'var(--color-text)', margin: 0 }}>
                          {company.name}
                        </h3>
                        {company.ticker && (
                          <span style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em', color: 'var(--color-primary-light)' }}>
                            {company.ticker}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={e => handleDelete(company.id, e)}
                      className="opacity-0 group-hover:opacity-100"
                      style={{
                        padding: '8px',
                        borderRadius: '8px',
                        color: 'var(--color-text-muted)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--color-danger-glow)';
                        e.currentTarget.style.color = 'var(--color-danger)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-muted)';
                      }}
                    >
                      <Trash2 style={{ width: '16px', height: '16px' }} />
                    </button>
                  </div>

                  {company.sector && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: '14px',
                        padding: '4px 10px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: sectorStyle.color,
                        background: sectorStyle.bg,
                        border: `1px solid ${sectorStyle.color}20`,
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: sectorStyle.gradient,
                        }}
                      />
                      {company.sector}
                    </span>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '16px',
                      paddingTop: '14px',
                      borderTop: '1px solid var(--color-border)',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-faint)' }}>
                      {new Date(company.created_at).toLocaleDateString('pt-BR')}
                    </span>
                    <span
                      className="opacity-0 group-hover:opacity-100"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--color-primary-light)',
                        transition: 'all 0.3s',
                      }}
                    >
                      Explorar <ArrowRight style={{ width: '14px', height: '14px' }} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
