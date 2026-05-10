import { create } from "zustand";
import { persist } from "zustand/middleware";

// Persists ONLY the access token + user (the refresh token lives in the
// httpOnly cookie). On a fresh page load, if persisted state exists we
// optimistically render authenticated UI; the next API call will refresh
// or fail, and the store self-clears.

export const useAuthStore = create(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setAuth: (accessToken, user) => set({ accessToken, user }),
      clear: () => set({ accessToken: null, user: null }),
    }),
    {
      name: "sa-auth",
      partialize: (s) => ({ accessToken: s.accessToken, user: s.user }),
    },
  ),
);
