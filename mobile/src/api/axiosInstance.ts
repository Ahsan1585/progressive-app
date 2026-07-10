import axios from "axios";

// Mirrors frontend/src/api/axiosInstance.js's interceptor pattern exactly —
// JWT attached to every request, centralized 401 handling.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Centralized auth-failure handling: on any 401, clear the session and return to login.
// Unlike the web app (which does a hard window.location redirect), the mobile
// app clears storage here and lets AuthContext's reactive state route the UI —
// there is no separate "admin login" path to special-case.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      window.dispatchEvent(new CustomEvent("mobile-app:session-expired"));
    }
    return Promise.reject(error);
  }
);

export default api;
