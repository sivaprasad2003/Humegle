import { create } from 'zustand';

export type AppState =
  | 'IDLE'
  | 'SEARCHING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'PARTNER_DISCONNECTED'
  | 'ERROR';

export type ChatMode = 'video' | 'text';

export interface ChatMessage {
  id: string;
  sender: 'me' | 'partner' | 'system';
  text: string;
}

interface ChatStore {
  state: AppState;
  chatMode: ChatMode;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  messages: ChatMessage[];
  setState: (s: AppState) => void;
  setChatMode: (m: ChatMode) => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  addMessage: (msg: ChatMessage) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  state: 'IDLE',
  chatMode: 'video',
  localStream: null,
  remoteStream: null,
  messages: [],
  setState: (state) => set({ state }),
  setChatMode: (chatMode) => set({ chatMode }),
  setStreams: (localStream, remoteStream) => set({ localStream, remoteStream }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  reset: () => set({ state: 'IDLE', remoteStream: null, messages: [] }),
}));
