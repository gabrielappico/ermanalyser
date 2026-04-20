import {
  Building2,
  FileText,
  BarChart3,
  ChevronRight,
} from 'lucide-react';
import type { View, Company } from '../App';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  selectedCompany: Company | null;
  totalQuestions: number;
}

const NAV_ITEMS: { view: View; label: string; icon: typeof Building2; description: string }[] = [
  { view: 'companies', label: 'Empresas', icon: Building2, description: 'Gerenciar empresas' },
  { view: 'documents', label: 'Documentos', icon: FileText, description: 'Upload e gestão' },
  { view: 'analysis', label: 'Análise ESG', icon: BarChart3, description: 'Avaliação por agentes' },
];

export default function Sidebar({ activeView, onNavigate, selectedCompany, totalQuestions }: SidebarProps) {
  return (
    <aside
      style={{
        width: '256px',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'linear-gradient(180deg, #0f2219 0%, #0a1a12 50%, #071510 100%)',
        borderRight: '1px solid var(--sidebar-border)',
        position: 'relative',
      }}
    >
      {/* Subtle ambient glow */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '120px',
          background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(0, 99, 58, 0.08), transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Logo — ERM branding */}
      <div style={{ position: 'relative', padding: '24px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src="/erm-logo.png"
            alt="ERM Logo"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              objectFit: 'contain',
              background: 'rgba(255,255,255,0.95)',
              padding: '4px',
              boxShadow: '0 0 20px rgba(0, 99, 58, 0.15), 0 4px 12px rgba(0,0,0,0.3)',
            }}
          />
          <div>
            <h1
              style={{
                fontWeight: 800,
                fontSize: '18px',
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                color: '#e0efe6',
                margin: 0,
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              ERM
            </h1>
            <p
              style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#4ade80',
                margin: 0,
              }}
            >
              ESG Analyzer
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ margin: '0 20px', height: '1px', background: 'rgba(255,255,255,0.06)' }} />

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '16px 12px' }}>
        <p
          style={{
            padding: '0 8px',
            marginBottom: '8px',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: '#4a6a58',
          }}
        >
          Menu
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {NAV_ITEMS.map(({ view, label, icon: Icon, description }) => {
            const isActive = activeView === view;
            const isDisabled = (view === 'documents' || view === 'analysis') && !selectedCompany;

            return (
              <button
                key={view}
                onClick={() => !isDisabled && onNavigate(view)}
                disabled={isDisabled}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  textAlign: 'left',
                  position: 'relative',
                  background: isActive ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
                  border: isActive ? '1px solid rgba(74, 222, 128, 0.15)' : '1px solid transparent',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.35 : 1,
                  transition: 'all 0.2s ease',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !isDisabled) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '3px',
                      height: '20px',
                      borderRadius: '0 4px 4px 0',
                      background: '#4ade80',
                    }}
                  />
                )}

                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: isActive ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255,255,255,0.03)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Icon
                    style={{
                      width: '16px',
                      height: '16px',
                      color: isActive ? '#4ade80' : '#7a9a8a',
                    }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color: isActive
                        ? '#4ade80'
                        : isDisabled
                          ? '#4a6a58'
                          : '#b0c8ba',
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '10px',
                      marginTop: '2px',
                      color: '#4a6a58',
                    }}
                  >
                    {description}
                  </span>
                </div>

                {isActive && (
                  <ChevronRight
                    style={{
                      width: '14px',
                      height: '14px',
                      flexShrink: 0,
                      color: '#4ade80',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Selected Company Footer */}
      {selectedCompany && (
        <div style={{ padding: '0 12px 16px' }}>
          <div
            style={{
              padding: '14px',
              borderRadius: '12px',
              background: 'rgba(0, 99, 58, 0.08)',
              border: '1px solid rgba(0, 99, 58, 0.15)',
            }}
          >
            <p
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#4a6a58',
                marginBottom: '8px',
              }}
            >
              Empresa Ativa
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: 'rgba(74, 222, 128, 0.12)',
                  border: '1px solid rgba(74, 222, 128, 0.15)',
                }}
              >
                <Building2 style={{ width: '16px', height: '16px', color: '#4ade80' }} />
              </div>
              <div style={{ overflow: 'hidden' }}>
                <p
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#e0efe6',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    margin: 0,
                  }}
                >
                  {selectedCompany.name}
                </p>
                {selectedCompany.ticker && (
                  <p
                    style={{
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      letterSpacing: '0.05em',
                      color: '#4ade80',
                      margin: 0,
                    }}
                  >
                    {selectedCompany.ticker}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version */}
      <div style={{ padding: '0 20px 16px' }}>
        <p style={{ fontSize: '10px', color: '#4a6a58', margin: 0 }}>
          v0.3.0 · {totalQuestions || '…'} perguntas
        </p>
      </div>
    </aside>
  );
}
