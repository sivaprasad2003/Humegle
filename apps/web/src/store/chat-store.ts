import { create } from 'zustand';

type AppState = 'IDLE' | 'SEARCHING' | 'MATCHED' | 'CONNECTING' | 'CONNECTED' | 'PARTNER_DISCONNECTED' | 'ERROR';

export interface ChatMessage {
  id: string;
  sender: 'me' | 'partner' | 'system';
  text: string;
}

interface ChatStore {
  state: AppState;
  roomId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  messages: ChatMessage[];
  setState: (state: AppState) => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  addMessage: (msg: ChatMessage) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  state: 'IDLE',
  roomId: null,
  localStream: null,
  remoteStream: null,
  messages: [],
  setState: (state) => set({ state }),
  setStreams: (local, remote) => set({ localStream: local, remoteStream: remote }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  reset: () => set({ state: 'IDLE', roomId: null, remoteStream: null, messages: [] }),
}));
