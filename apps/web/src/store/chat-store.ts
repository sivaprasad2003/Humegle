import { create } from 'zustand';

type AppState = 'IDLE' | 'SEARCHING' | 'MATCHED' | 'CONNECTING' | 'CONNECTED' | 'PARTNER_DISCONNECTED' | 'ERROR';

interface ChatStore {
  state: AppState;
  roomId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  setState: (state: AppState) => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  state: 'IDLE',
  roomId: null,
  localStream: null,
  remoteStream: null,
  setState: (state) => set({ state }),
  setStreams: (local, remote) => set({ localStream: local, remoteStream: remote }),
  reset: () => set({ state: 'IDLE', roomId: null, remoteStream: null }),
}));
