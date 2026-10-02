import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  current: Toast | null;
  show: (message: string, action?: Toast['action'], durationMs?: number) => void;
  hide: () => void;
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  current: null,
  show(message, action, durationMs = 4000) {
    clearTimeout(timer);
    const toast = { id: ++seq, message, action };
    set({ current: toast });
    timer = setTimeout(() => set((s) => (s.current?.id === toast.id ? { current: null } : s)), durationMs);
  },
  hide() {
    clearTimeout(timer);
    set({ current: null });
  },
}));

export const toast = (message: string, action?: Toast['action']) => useToast.getState().show(message, action);
