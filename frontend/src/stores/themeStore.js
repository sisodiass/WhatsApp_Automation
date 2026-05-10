import { create } from "zustand";
import { persist } from "zustand/middleware";

// Theme: "light" | "dark" | "system" (system follows the OS).
// Applied by toggling the `dark` class on <html>.

const THEMES = ["light", "dark", "system"];

function systemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
}

export const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: "system",
      setTheme: (next) => {
        if (!THEMES.includes(next)) return;
        applyTheme(next);
        set({ theme: next });
      },
      toggle: () => {
        // light → dark → system → light …
        const current = get().theme;
        const idx = THEMES.indexOf(current);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next);
        set({ theme: next });
      },
      hydrate: () => applyTheme(get().theme),
    }),
    {
      name: "sa-theme",
      onRehydrateStorage: () => (state) => state?.hydrate(),
    },
  ),
);

// Listen for system theme changes when in "system" mode.
if (typeof window !== "undefined" && window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const { theme } = useThemeStore.getState();
      if (theme === "system") applyTheme("system");
    });
}
