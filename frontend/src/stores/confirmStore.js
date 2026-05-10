import { create } from "zustand";

// Promise-based confirm. Imperative API:
//
//   import { confirm } from "../stores/confirmStore";
//   const ok = await confirm({
//     title: "Delete tag?",
//     description: "Existing chat assignments will be removed.",
//     variant: "destructive",
//     confirmLabel: "Delete",
//   });
//   if (!ok) return;
//
// The viewport (<ConfirmDialog/>) is mounted once in AppShell. The store
// holds the active request (or null) plus its Promise resolver — clicking
// Cancel/Confirm fulfils the promise and clears the request.

const useStore = create((set) => ({
  active: null, // { id, title, description, confirmLabel, cancelLabel, variant, resolve }
  request: (opts) =>
    new Promise((resolve) => {
      set({
        active: {
          id: Date.now(),
          title: opts.title || "Are you sure?",
          description: opts.description || null,
          confirmLabel: opts.confirmLabel || "Confirm",
          cancelLabel: opts.cancelLabel || "Cancel",
          variant: opts.variant || "primary",
          resolve,
        },
      });
    }),
  resolve: (value) =>
    set((s) => {
      if (s.active) s.active.resolve(value);
      return { active: null };
    }),
}));

export const useConfirmActive = () => useStore((s) => s.active);
export const useConfirmResolve = () => useStore((s) => s.resolve);

// Public API.
export function confirm(opts) {
  return useStore.getState().request(opts);
}
