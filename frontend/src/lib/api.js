import axios from "axios";
import { useAuthStore } from "../stores/authStore.js";

// Base URL strategy:
//   - Local dev: leave VITE_API_BASE_URL unset → uses "/api" → Vite dev
//     server proxies /api → http://localhost:4000 (vite.config.js).
//   - Cloudflare Pages prod: set VITE_API_BASE_URL=https://api.your.com/api
//     before build → axios talks to the API directly (cross-origin; CORS
//     on the API allows the configured FRONTEND_URL with credentials).
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // for refresh cookie
});

// Attach the bearer token from the Zustand store on every request.
api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// On a 401, try one refresh, then replay the original request.
let refreshing = null;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes("/auth/refresh") &&
      !original.url?.includes("/auth/login")
    ) {
      original._retry = true;
      try {
        if (!refreshing) {
          // Use the same axios instance so baseURL + credentials apply.
          refreshing = api
            .post("/auth/refresh", {})
            .finally(() => {
              refreshing = null;
            });
        }
        const { data } = await refreshing;
        useAuthStore.getState().setAuth(data.accessToken, data.user);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().clear();
      }
    }
    return Promise.reject(error);
  },
);
