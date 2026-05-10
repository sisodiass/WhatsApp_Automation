import { create } from "zustand";

// Tiny toast store. Imperative `toast.success("…")` / `.error()` / `.info()`.
// Toasts auto-dismiss after `duration` ms; pass 0 to make it sticky.

let nextId = 1;

const useStore = create((set) => ({
  items: [],
  push: (item) => {
    const id = nextId++;
    const toast = { id, ...item };
    set((s) => ({ items: [...s.items, toast] }));

    if (item.duration !== 0) {
      const ms = item.duration ?? 4000;
      setTimeout(() => {
        set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
      }, ms);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));

export const useToasts = () => useStore((s) => s.items);
export const dismissToast = (id) => useStore.getState().dismiss(id);
export const clearToasts = () => useStore.getState().clear();

// Public imperative API. Import as `import { toast } from ".../toastStore.js"`
// and call `toast.success("Saved")`, `toast.error(err.message)`, etc.
export const toast = {
  success: (message, opts) =>
    useStore.getState().push({ variant: "success", message, ...opts }),
  error: (message, opts) =>
    useStore.getState().push({ variant: "error", message, duration: 6000, ...opts }),
  info: (message, opts) =>
    useStore.getState().push({ variant: "info", message, ...opts }),
  // Pull a friendly message out of an axios error (or any Error).
  fromError: (err, fallback = "Something went wrong") => {
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      fallback;
    return useStore.getState().push({ variant: "error", message: msg, duration: 6000 });
  },
};
