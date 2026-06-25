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
export const getConfederationRules = (id: number) => api.get(`/api/confederations/${id}/rules`);
export const upsertConfederationRule = (id: number, data: any) => api.post(`/api/confederations/${id}/rules`, data);
export const deleteConfederationRule = (id: number, ruleId: number) => api.delete(`/api/confederations/${id}/rules/${ruleId}`);

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

// Payments
export const getPayments = (params?: any) => api.get("/api/payments/", { params });
export const declareGGR = (id: number, data: any) => api.post(`/api/payments/${id}/declare-ggr`, data);
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

// Documents
export const getDocuments = (params?: any) => api.get("/api/documents/", { params });
export const uploadDocument = (formData: FormData) =>
  api.post("/api/documents/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
export const downloadDocument = (id: number) =>
  api.get(`/api/documents/${id}/download`, { responseType: "blob" });

// Audit
export const getAuditLogs = (params?: any) => api.get("/api/audit/", { params });

// Users
export const getUsers = () => api.get("/api/users/");
export const createUser = (data: any) => api.post("/api/users/", data);
export const updateUser = (id: number, data: any) => api.patch(`/api/users/${id}`, data);

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
