import { useState } from 'react';
import './index.css';
import Sidebar from './components/Sidebar';
import CompaniesPanel from './components/CompaniesPanel';
import DocumentsPanel from './components/DocumentsPanel';
import AnalysisPanel from './components/AnalysisPanel';
import {
  Building2,
  FileText,
  BarChart3,
  ChevronRight,
  Zap,
} from 'lucide-react';

export type View = 'companies' | 'documents' | 'analysis';

export interface Company {
  id: string;
  name: string;
  ticker?: string;
  sector?: string;
  created_at: string;
}

const VIEW_META: Record<View, { label: string; icon: typeof Building2 }> = {
  companies: { label: 'Empresas', icon: Building2 },
  documents: { label: 'Documentos', icon: FileText },
  analysis: { label: 'Análise ESG', icon: BarChart3 },
};

function App() {
  const [activeView, setActiveView] = useState<View>('companies');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const handleSelectCompany = (company: Company) => {
    setSelectedCompany(company);
    setActiveView('documents');
  };

  const breadcrumbs = [
    { label: 'ERM', view: 'companies' as View },
    ...(activeView !== 'companies'
      ? [{ label: VIEW_META[activeView].label, view: activeView }]
      : []),
  ];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#f1fcf3',
      }}
    >
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        selectedCompany={selectedCompany}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Global Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 40px',
            height: '56px',
            flexShrink: 0,
            background: 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid rgba(0, 99, 58, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {i > 0 && (
                  <ChevronRight
                    style={{ width: '14px', height: '14px', color: '#8c9e94' }}
                  />
                )}
                <button
                  onClick={() => setActiveView(crumb.view)}
                  style={{
                    color: i === breadcrumbs.length - 1
                      ? '#141e19'
                      : '#5c6e64',
                    fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '13px',
                    fontFamily: 'inherit',
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
            {selectedCompany && activeView !== 'companies' && (
              <>
                <ChevronRight
                  style={{ width: '14px', height: '14px', color: '#8c9e94' }}
                />
                <span
                  style={{
                    fontWeight: 500,
                    color: '#00633a',
                    fontSize: '13px',
                  }}
                >
                  {selectedCompany.name}
                </span>
              </>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
              background: 'rgba(0, 99, 58, 0.08)',
              color: '#00633a',
            }}
          >
            <Zap style={{ width: '12px', height: '12px' }} />
            Sistema Ativo
          </div>
        </header>

        {/* Main Content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            background: `
              radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 99, 58, 0.04), transparent),
              #f1fcf3
            `,
          }}
        >
          <div style={{ padding: '40px 48px', maxWidth: '1200px', margin: '0 auto' }}>
            {activeView === 'companies' && (
              <CompaniesPanel onSelectCompany={handleSelectCompany} />
            )}
            {activeView === 'documents' && selectedCompany && (
              <DocumentsPanel
                company={selectedCompany}
                onGoToAnalysis={() => setActiveView('analysis')}
              />
            )}
            {activeView === 'analysis' && selectedCompany && (
              <AnalysisPanel company={selectedCompany} />
            )}
            {(activeView === 'documents' || activeView === 'analysis') && !selectedCompany && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '400px',
                }}
                className="animate-fade-in"
              >
                <div style={{ textAlign: 'center' }}>
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
                      background: 'var(--color-primary-glow)',
                      border: '1px solid rgba(0, 99, 58, 0.15)',
                    }}
                  >
                    <Building2 style={{ width: '32px', height: '32px', color: 'var(--color-primary-light)' }} />
                  </div>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                    Nenhuma empresa selecionada
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--color-text-muted)', marginBottom: '24px' }}>
                    Selecione uma empresa para continuar
                  </p>
                  <button
                    onClick={() => setActiveView('companies')}
                    className="btn-primary"
                    style={{ padding: '10px 24px', fontSize: '14px' }}
                  >
                    Ir para Empresas
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
