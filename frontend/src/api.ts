import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// --- Companies ---
export const getCompanies = () => api.get('/companies');
export const createCompany = (data: { name: string; ticker?: string; sector?: string }) =>
  api.post('/companies', data);
export const deleteCompany = (id: string) => api.delete(`/companies/${id}`);

// --- Documents ---
export const getDocuments = (companyId?: string, reportYear?: number) =>
  api.get('/documents', { params: { ...(companyId ? { company_id: companyId } : {}), ...(reportYear ? { report_year: reportYear } : {}) } });
export const uploadDocument = (file: File, companyId: string, reportYear: number) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('company_id', companyId);
  formData.append('report_year', reportYear.toString());
  return api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const addUrlDocument = (url: string, companyId: string, reportYear: number, customName?: string) =>
  api.post('/documents/add-url', { url, company_id: companyId, report_year: reportYear, custom_name: customName });
export const getDocument = (id: string) => api.get(`/documents/${id}`);
export const getDocumentChunks = (id: string) => api.get(`/documents/${id}/chunks`);
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);
export const discoverDocuments = (pageUrl: string, useBrowser: boolean = true) =>
  api.post('/documents/discover-documents', { page_url: pageUrl, use_browser: useBrowser });
export const batchAddUrls = (
  companyId: string,
  reportYear: number,
  documents: Array<{ url: string; name: string; file_type: string }>
) => api.post('/documents/batch-add-urls', { company_id: companyId, report_year: reportYear, documents });

// --- ESG Themes & Questions ---
export const getThemes = () => api.get('/analysis/themes');
export const getThemeQuestions = (themeId: string) =>
  api.get(`/analysis/themes/${themeId}/questions`);
export const getAllQuestions = () => api.get('/analysis/questions');

// --- Analysis ---
export const runAnalysis = (companyId: string, reportYear: number) =>
  api.post('/analysis/run', { company_id: companyId, report_year: reportYear });
export const getAnalysisStatus = (analysisId: string) =>
  api.get(`/analysis/status/${analysisId}`);
export const getAnalysisResults = (analysisId: string) =>
  api.get(`/analysis/results/${analysisId}`);
export const getAnalysisHistory = (companyId: string) =>
  api.get(`/analysis/history/${companyId}`);
export const exportAnalysis = (analysisId: string) =>
  api.post(`/analysis/export/${analysisId}`, null, { responseType: 'blob' });
export const cancelAnalysis = (analysisId: string) =>
  api.post(`/analysis/cancel/${analysisId}`);
export const forceRestartAnalysis = (analysisId: string) =>
  api.post(`/analysis/force-restart/${analysisId}`);
export const unstickAnalyses = () =>
  api.post('/analysis/unstick');
export const forceCompleteAnalysis = (analysisId: string) =>
  api.post(`/analysis/force-complete/${analysisId}`);

// --- SSE Streaming ---
export const getAnalysisStreamUrl = (companyId: string, reportYear: number) =>
  `/api/analysis/run-stream`;

export const getAnalysisReplayUrl = (analysisId: string) =>
  `/api/analysis/replay/${analysisId}`;

export default api;
