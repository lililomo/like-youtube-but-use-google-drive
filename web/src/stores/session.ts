import { create } from 'zustand';
import { api, apiPost } from '../lib/api';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  avatarColor: string;
  storageUsedBytes: number;
  storageQuotaBytes: number | null;
}

interface SessionState {
  user: User | null;
  loaded: boolean;
  load: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  loaded: false,
  async load() {
    try {
      const res = await api<{ user: User | null }>('/auth/me');
      set({ user: res.user, loaded: true });
    } catch {
      set({ user: null, loaded: true });
    }
  },
  setUser(user) {
    set({ user, loaded: true });
  },
  async logout() {
    try {
      await apiPost('/auth/logout');
    } finally {
      set({ user: null, loaded: true });
    }
  },
}));

export const useIsAdmin = () => useSession((s) => s.user?.role === 'admin');
