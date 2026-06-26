import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (email: string, password: string) => {
  const form = new FormData();
  form.append("username", email);
  form.append("password", password);
  return api.post("/api/auth/login", form);
};

export const getMe = () => api.get("/api/auth/me");

// Confederations
export const getConfederations = () => api.get("/api/confederations/");
export const getConfederation = (id: number) => api.get(`/api/confederations/${id}`);
export const createConfederation = (data: any) => api.post("/api/confederations/", data);
export const updateConfederation = (id: number, data: any) => api.patch(`/api/confederations/${id}`, data);
export const uploadConfederationLogo = (id: number, formData: FormData) =>
  api.post(`/api/confederations/${id}/upload-logo`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const uploadConfederationRegulation = (id: number, formData: FormData) =>
  api.post(`/api/confederations/${id}/upload-regulation`, formData, { headers: { "Content-Type": "multipart/form-data" } });
// Regras de rateio (matriz por cenário de competição)
export const getDistributionRules = (id: number) => api.get(`/api/confederations/${id}/distribution-rules`);
export const createDistributionRule = (id: number, data: any) => api.post(`/api/confederations/${id}/distribution-rules`, data);
export const updateDistributionRule = (id: number, ruleId: number, data: any) => api.patch(`/api/confederations/${id}/distribution-rules/${ruleId}`, data);
export const deleteDistributionRule = (id: number, ruleId: number) => api.delete(`/api/confederations/${id}/distribution-rules/${ruleId}`);

// Operators
export const getOperators = (params?: any) => api.get("/api/operators/", { params });
export const getOperator = (id: number) => api.get(`/api/operators/${id}`);
export const createOperator = (data: any) => api.post("/api/operators/", data);
export const updateOperator = (id: number, data: any) => api.patch(`/api/operators/${id}`, data);
export const addContact = (operatorId: number, data: any) => api.post(`/api/operators/${operatorId}/contacts`, data);
export const deleteContact = (operatorId: number, contactId: number) => api.delete(`/api/operators/${operatorId}/contacts/${contactId}`);
export const findContactsAI = (operatorId: number) => api.post(`/api/operators/${operatorId}/find-contacts`);
export const syncFromMF = () => api.post("/api/operators/sync-mf");

// Brands
export const getOperatorBrands = (id: number) => api.get(`/api/operators/${id}/brands`);
export const addBrand = (id: number, data: any) => api.post(`/api/operators/${id}/brands`, data);
export const updateBrand = (id: number, brandId: number, data: any) => api.patch(`/api/operators/${id}/brands/${brandId}`, data);
export const deleteBrand = (id: number, brandId: number) => api.delete(`/api/operators/${id}/brands/${brandId}`);

// Responsáveis (Legal / Financeiro / Jurídico)
export const getResponsibles = (id: number) => api.get(`/api/operators/${id}/responsibles`);
export const addResponsible = (id: number, data: any) => api.post(`/api/operators/${id}/responsibles`, data);
export const updateResponsible = (id: number, respId: number, data: any) => api.patch(`/api/operators/${id}/responsibles/${respId}`, data);
export const deleteResponsible = (id: number, respId: number) => api.delete(`/api/operators/${id}/responsibles/${respId}`);

// ENDR (per-operator)
export const getEndrAssociations = (id: number) => api.get(`/api/operators/${id}/endr`);
export const addEndrAssociation = (id: number, data: any) => api.post(`/api/operators/${id}/endr`, data);
export const deleteEndrAssociation = (id: number, assocId: number) => api.delete(`/api/operators/${id}/endr/${assocId}`);

// ENDR entity & monthly view
export const getEndrEntity = () => api.get("/api/endr/entity");
export const updateEndrEntity = (data: any) => api.patch("/api/endr/entity", data);
export const getEndrMonthly = (month: string) => api.get("/api/endr/monthly", { params: { month } });
export const getEndrAvailableOperators = (month: string) => api.get("/api/endr/operators-available", { params: { month } });
export const addEndrMonthly = (data: any) => api.post("/api/endr/monthly", data);
export const removeEndrMonthly = (assocId: number) => api.delete(`/api/endr/monthly/${assocId}`);

// Import
export const importOperators = (formData: FormData) => api.post('/api/operators/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getSyncStatus = () => api.get('/api/operators/sync-status');

// Collections
export const getCollections = (params?: any) => api.get("/api/collections/", { params });
export const getCollection = (id: number) => api.get(`/api/collections/${id}`);
export const createCollection = (data: any) => api.post("/api/collections/", data);
export const getCollectionEvents = (id: number) => api.get(`/api/collections/${id}/events`);
export const addCollectionEvent = (id: number, data: any) => api.post(`/api/collections/${id}/events`, data);
export const sendNotifications = (id: number, notificationNumber: number) =>
  api.post(`/api/collections/${id}/send-notifications?notification_number=${notificationNumber}`);
export const getNotificationPreview = (id: number, notificationNumber: number) =>
  api.get(`/api/collections/${id}/notification-preview`, { params: { notification_number: notificationNumber } });
export const sendNotificationConfirmed = (id: number, data: any) =>
  api.post(`/api/collections/${id}/send-confirmed`, data);
export const generateSpaLetter = (id: number, data: any) =>
  api.post(`/api/collections/${id}/spa-letter`, data);
export const downloadSpaLetterUrl = (id: number, documentId: number) =>
  `/api/collections/${id}/spa-letter/${documentId}/download`;

// Payments
export const getPayments = (params?: any) => api.get("/api/payments/", { params });
export const declareValue = (id: number, data: any) => api.post(`/api/payments/${id}/declare-value`, data);
export const confirmPayment = (id: number, data: any) => api.post(`/api/payments/${id}/confirm`, data);
export const registerReport = (id: number, data: any) => api.post(`/api/payments/${id}/register-report`, data);
export const uploadPaymentReport = (id: number, formData: FormData) =>
  api.post(`/api/payments/${id}/upload-report`, formData, { headers: { "Content-Type": "multipart/form-data" } });
// ENDR Payments
export const getEndrPayments = (params?: any) => api.get("/api/payments/endr", { params });
export const createEndrPayment = (data: any) => api.post("/api/payments/endr", data);
export const uploadEndrReport = (id: number, formData: FormData) =>
  api.post(`/api/payments/endr/${id}/upload-report`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const deleteEndrPayment = (id: number) => api.delete(`/api/payments/endr/${id}`);

// Reports
export const getComplianceReport = (cycleId: number) => api.get(`/api/reports/compliance/${cycleId}`);
export const downloadExcelReport = (cycleId: number) =>
  api.get(`/api/reports/compliance/${cycleId}/excel`, { responseType: "blob" });
export const getCrossReport = (params?: any) => api.get("/api/reports/cross", { params });
export const downloadCrossExcel = (params?: any) =>
  api.get("/api/reports/cross/excel", { params, responseType: "blob" });
export const downloadCrossPdf = (params?: any) =>
  api.get("/api/reports/cross/pdf", { params, responseType: "blob" });

// Documents
export const getDocuments = (params?: any) => api.get("/api/documents/", { params });
export const uploadDocument = (formData: FormData) =>
  api.post("/api/documents/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
export const downloadDocument = (id: number) =>
  api.get(`/api/documents/${id}/download`, { responseType: "blob" });

// Audit
export const getAuditLogs = (params?: any) => api.get("/api/audit/", { params });
export const getAuditActions = () => api.get("/api/audit/actions");
export const downloadAuditPdf = (params?: any) =>
  api.get("/api/audit/pdf", { params, responseType: "blob" });

// Users
export const getUsers = () => api.get("/api/users/");
export const createUser = (data: any) => api.post("/api/users/", data);
export const updateUser = (id: number, data: any) => api.patch(`/api/users/${id}`, data);
export const deleteUser = (id: number) => api.delete(`/api/users/${id}`);

// Finance - Fase 1 (repasses recebidos)
export const getPhase1 = (params?: any) => api.get("/api/finance/phase1", { params });

// AI
export const draftNotification = (data: any) => api.post("/api/ai/draft-notification", data);

// Contact Research
export const researchContacts = (id: number) => api.post(`/api/operators/${id}/research-contacts`);
export const getContactSuggestions = (id: number, status?: string) =>
  api.get(`/api/operators/${id}/suggestions`, { params: status ? { status } : {} });
export const approveSuggestion = (operatorId: number, suggestionId: number) =>
  api.post(`/api/operators/${operatorId}/suggestions/${suggestionId}/approve`);
export const rejectSuggestion = (operatorId: number, suggestionId: number) =>
  api.post(`/api/operators/${operatorId}/suggestions/${suggestionId}/reject`);
export const researchAllOperators = () => api.post('/api/operators/research-all');

// ---- Financeiro ----
export const getFinanceSummary = (params?: any) => api.get("/api/finance/summary", { params });
export const getFinanceByConfederation = () => api.get("/api/finance/by-confederation");
export const getFinanceEmails = (params?: any) => api.get("/api/finance/emails", { params });
export const syncEmails = () => api.post("/api/finance/sync-emails");

// ---- Beneficiários ----
export const getBeneficiaries = (params?: any) => api.get("/api/beneficiaries/", { params });
export const createBeneficiary = (confederationId: number, data: any) =>
  api.post(`/api/beneficiaries/?confederation_id=${confederationId}`, data);
export const updateBeneficiary = (id: number, data: any) => api.patch(`/api/beneficiaries/${id}`, data);
export const deleteBeneficiary = (id: number) => api.delete(`/api/beneficiaries/${id}`);

// ---- Redistribuição (motor de repasse Fase 2) ----
export const getRedistributions = (params?: any) => api.get("/api/redistributions/", { params });
export const getRedistribution = (id: number) => api.get(`/api/redistributions/${id}`);
export const createRedistribution = (data: any) => api.post("/api/redistributions/", data);
export const addRedistributionItem = (id: number, data: any) => api.post(`/api/redistributions/${id}/items`, data);
export const payRedistributionItem = (id: number, itemId: number, data: any) =>
  api.post(`/api/redistributions/${id}/items/${itemId}/pay`, data);
export const uploadRedistributionProof = (id: number, itemId: number, formData: FormData) =>
  api.post(`/api/redistributions/${id}/items/${itemId}/proof`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const deleteRedistributionItem = (id: number, itemId: number) => api.delete(`/api/redistributions/${id}/items/${itemId}`);
export const deleteRedistribution = (id: number) => api.delete(`/api/redistributions/${id}`);

// Direct Payments (Lançamentos Avulsos)
export const getDirectPayments = (params?: any) => api.get("/api/payments/direct", { params });
export const createDirectPayment = (operatorId: number, data: any) => api.post(`/api/payments/direct/${operatorId}`, data);
export const uploadDirectReport = (operatorId: number, paymentId: number, formData: FormData) =>
  api.post(`/api/payments/direct/${operatorId}/${paymentId}/upload-report`, formData, { headers: { "Content-Type": "multipart/form-data" } });
export const deleteDirectPayment = (operatorId: number, paymentId: number) => api.delete(`/api/payments/direct/${operatorId}/${paymentId}`);

// ---- Templates de cobrança ----
export const getTemplates = (params?: any) => api.get("/api/templates/", { params });
export const createTemplate = (data: any) => api.post("/api/templates/", data);
export const updateTemplate = (id: number, data: any) => api.patch(`/api/templates/${id}`, data);
export const deleteTemplate = (id: number) => api.delete(`/api/templates/${id}`);

// ---- Alertas e compliance ----
export const getAlerts = () => api.get('/api/alerts/');
export const getComplianceHistory = (params?: any) => api.get('/api/alerts/compliance-history', { params });

// ---- Histórico e score do operador ----
export const getOperatorMonthlyHistory = (id: number, months = 12) =>
  api.get(`/api/operators/${id}/monthly-history`, { params: { months } });
export const getOperatorComplianceScore = (id: number) =>
  api.get(`/api/operators/${id}/compliance-score`);

// ---- Fila de e-mails não casados ----
export const suggestEmailOperator = (emailId: number) =>
  api.post(`/api/finance/emails/${emailId}/suggest-operator`);
export const linkEmailOperator = (emailId: number, data: { operator_id: number; add_as_contact?: boolean }) =>
  api.post(`/api/finance/emails/${emailId}/link`, data);

// ---- Relatório de evidências ISO 9001 ----
export const downloadEvidencePdf = (params: { month: string; confederation_id?: number }) =>
  api.get("/api/reports/evidence/pdf", { params, responseType: "blob" });
