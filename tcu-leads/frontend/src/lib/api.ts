import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
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
export const getUsers = () => api.get("/api/auth/users");
export const createUser = (data: any) => api.post("/api/auth/users", data);

// Leads
export const getLeads = (params?: any) => api.get("/api/leads", { params });
export const getLead = (id: number) => api.get(`/api/leads/${id}`);
export const updateLead = (id: number, data: any) => api.patch(`/api/leads/${id}`, data);
export const addLeadNote = (id: number, data: { body: string; kind?: string }) =>
  api.post(`/api/leads/${id}/notes`, data);
export const enrichLead = (id: number) => api.post(`/api/leads/${id}/enrich`);

// Monitor
export const getStats = () => api.get("/api/monitor/stats");
export const runPipeline = () => api.post("/api/monitor/run");
export const ingestText = (data: { text: string; publication_date?: string }) =>
  api.post("/api/monitor/ingest/text", data);
export const ingestPdf = (formData: FormData) =>
  api.post("/api/monitor/ingest/pdf", formData, { headers: { "Content-Type": "multipart/form-data" } });
export const getRuns = (limit = 20) => api.get("/api/monitor/runs", { params: { limit } });
export const getSettings = () => api.get("/api/monitor/settings");
export const updateSettings = (data: any) => api.patch("/api/monitor/settings", data);
export const cleanupNoise = () => api.post("/api/monitor/cleanup-noise");
export const testSourceProcessos = (data?: { data?: string }) =>
  api.post("/api/monitor/test-source/processos", data || {});

// Processos autuados
export const getProcesses = (params?: any) => api.get("/api/processes", { params });
export const getProcessStats = () => api.get("/api/processes/stats");

// Radar Externo (DOU + fontes web/RSS)
export const getSources = () => api.get("/api/external/sources");
export const createSource = (data: any) => api.post("/api/external/sources", data);
export const updateSource = (id: number, data: any) => api.patch(`/api/external/sources/${id}`, data);
export const deleteSource = (id: number) => api.delete(`/api/external/sources/${id}`);
export const testSavedSource = (id: number) => api.post(`/api/external/sources/${id}/test`);
export const testSourceAdhoc = (data: any) => api.post("/api/external/test-source", data);
export const testDou = (data?: any) => api.post("/api/external/test-dou", data || {});
export const runExternal = () => api.post("/api/external/run");
