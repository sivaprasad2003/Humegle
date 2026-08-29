"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useChatStore } from '../store/chat-store';
import { useWebRTC } from '../hooks/useWebRTC';

// Socket connects through the Next.js proxy (next.config.mjs) so ngrok HTTPS tunnels work on mobile
const socket = io({ autoConnect: false, path: '/socket.io' });

export default function Home() {
  const {
    state, setState,
    chatMode, setChatMode,
    localStream, remoteStream, setStreams,
    messages, addMessage, reset,
  } = useChatStore();

  const [gender, setGender] = useState('MALE');
  const [interest, setInterest] = useState('ANY');
  const [chatInput, setChatInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [isCameraLoading, setIsCameraLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const { endConnection } = useWebRTC(socket);

  // ─── Sync video elements with streams ──────────────────────────────────────
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]); // ref callback on the video element handles the "not mounted yet" case

  // ─── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    socket.connect();

    const onOnlineUsers = (count: number) => setOnlineUsers(count);
    const onChatMessage = (data: { text: string }) => {
      addMessage({ id: Date.now().toString(), sender: 'partner', text: data.text });
    };
    const onPartnerLeft = () => {
      addMessage({ id: Date.now().toString(), sender: 'system', text: '— Partner disconnected —' });
    };

    socket.on('online_users', onOnlineUsers);
    socket.on('chat_message', onChatMessage);
    socket.on('partner_left', onPartnerLeft);

    return () => {
      socket.off('online_users', onOnlineUsers);
      socket.off('chat_message', onChatMessage);
      socket.off('partner_left', onPartnerLeft);
      socket.disconnect();
    };
  }, [addMessage]);

  // ─── Auto-scroll chat ───────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Camera / Media ─────────────────────────────────────────────────────────
  const requestCamera = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported. Use HTTPS or switch to Text mode.');
      return false;
    }
    setIsCameraLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStreams(stream, null);
      setCameraError('');
      return true;
    } catch (err: any) {
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Switch to Text Only mode or allow camera access.'
        : err.message || 'Camera unavailable.';
      setCameraError(msg);
      return false;
    } finally {
      setIsCameraLoading(false);
    }
  }, [setStreams]);

  const stopCamera = useCallback(() => {
    localStream?.getTracks().forEach(t => t.stop());
    setStreams(null, null);
  }, [localStream, setStreams]);

  // Stop camera when switching to text mode
  useEffect(() => {
    if (chatMode === 'text') stopCamera();
  }, [chatMode]); // eslint-disable-line

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleStart = async () => {
    setCameraError('');
    if (chatMode === 'video') {
      if (!localStream) {
        const ok = await requestCamera();
        if (!ok) return;
      }
    }
    reset();
    setState('SEARCHING');
    socket.emit('join_queue', { gender, interest, mode: chatMode });
  };

  const handleSkip = () => {
    endConnection();
    socket.emit('skip');
    reset();
    setState('SEARCHING');
    socket.emit('join_queue', { gender, interest, mode: chatMode });
  };

  const handleStop = () => {
    endConnection();
    socket.emit('skip');
    stopCamera();
    reset();
    setState('IDLE');
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    socket.emit('chat_message', { text });
    addMessage({ id: Date.now().toString(), sender: 'me', text });
    setChatInput('');
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#0d0d0f] text-gray-100 font-sans flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Google Fonts */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Background glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center font-black text-sm">H</div>
          <span className="text-xl font-bold tracking-tight">Humegle</span>
        </div>

        {/* Online pill */}
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-4 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-semibold text-emerald-300">{onlineUsers} Online</span>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4">

        {/* ── IDLE SCREEN ── */}
        {state === 'IDLE' && (
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-extrabold mb-2 bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
                Talk to Strangers
              </h1>
              <p className="text-gray-500 text-sm">Instantly match with someone new</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-5 shadow-2xl backdrop-blur-xl">
              {/* Accent line */}
              <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

              {/* Mode toggle */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 block">Chat Mode</label>
                <div className="grid grid-cols-2 gap-2 bg-black/30 p-1 rounded-2xl">
                  {(['video', 'text'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setChatMode(m)}
                      className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                        chatMode === m
                          ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-500/25'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {m === 'video' ? '🎥 Video' : '💬 Text Only'}
                    </button>
                  ))}
                </div>
              </div>

              {/* I am */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">I am</label>
                <select
                  value={gender} onChange={e => setGender(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-violet-500 transition-colors cursor-pointer appearance-none"
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              {/* Interested in */}
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 block">Interested in</label>
                <select
                  value={interest} onChange={e => setInterest(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-violet-500 transition-colors cursor-pointer appearance-none"
                >
                  <option value="ANY">Anyone</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </div>

              {/* Camera error */}
              {cameraError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
                  {cameraError}
                </div>
              )}

              {/* Start button */}
              <button
                onClick={handleStart}
                disabled={isCameraLoading}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 active:scale-95 transition-all shadow-lg shadow-violet-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isCameraLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Starting Camera...
                  </span>
                ) : 'Find a Match'}
              </button>
            </div>
          </div>
        )}

        {/* ── CHAT SCREEN ── */}
        {state !== 'IDLE' && (
          <div className="w-full max-w-6xl h-[calc(100vh-80px)] flex flex-col lg:flex-row gap-4">

            {/* ── Video Panel (video mode only) ── */}
            {chatMode === 'video' && (
              <div className="flex-1 flex flex-col gap-3 min-h-0">
                {/* Remote video */}
                <div className="flex-1 bg-black rounded-2xl overflow-hidden relative border border-white/10 flex items-center justify-center min-h-0">
                  <video
                    ref={remoteVideoRef}
                    autoPlay playsInline
                    className="w-full h-full object-cover"
                  />
                  {/* Overlay for non-connected states */}
                  {state !== 'CONNECTED' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
                      {(state === 'SEARCHING' || state === 'CONNECTING') && (
                        <div className="w-10 h-10 border-3 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                      )}
                      <p className="text-lg font-semibold text-gray-300 animate-pulse">
                        {state === 'SEARCHING' ? 'Finding a match...'
                          : state === 'CONNECTING' ? 'Connecting...'
                          : state === 'PARTNER_DISCONNECTED' ? 'Partner left'
                          : 'Connection error'}
                      </p>
                    </div>
                  )}
                  {/* Local PiP - use ref callback so srcObject is set the moment element mounts */}
                  <div className="absolute bottom-3 right-3 w-28 md:w-36 aspect-video bg-gray-900 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl">
                    <video
                      ref={(el) => {
                        (localVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
                        if (el && localStream) el.srcObject = localStream;
                      }}
                      autoPlay playsInline muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    <span className="absolute bottom-1 left-2 text-[10px] text-white/60 font-medium">You</span>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex gap-3 shrink-0">
                  <button
                    onClick={handleSkip}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all"
                  >
                    ⏭ Next Person
                  </button>
                  <button
                    onClick={handleStop}
                    className="px-6 py-3 rounded-xl font-bold text-sm bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 hover:text-red-200 transition-all"
                  >
                    ✕ Stop
                  </button>
                </div>
              </div>
            )}

            {/* ── Chat Panel ── */}
            <div className={`${chatMode === 'video' ? 'w-full lg:w-[360px]' : 'w-full max-w-2xl mx-auto'} flex flex-col min-h-0 bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl`}>

              {/* Chat header */}
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${state === 'CONNECTED' ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400 animate-pulse'}`} />
                  <span className="font-semibold text-sm">
                    {state === 'CONNECTED' ? 'Live Chat' : state === 'SEARCHING' ? 'Searching...' : 'Connecting...'}
                  </span>
                </div>
                {chatMode === 'text' && (
                  <div className="flex gap-2">
                    <button onClick={handleSkip} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-all">
                      Next
                    </button>
                    <button onClick={handleStop} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all">
                      Stop
                    </button>
                  </div>
                )}
              </div>

              {/* Text-only search state */}
              {chatMode === 'text' && state === 'SEARCHING' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
                  <div className="w-10 h-10 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                  <p className="animate-pulse text-sm">Looking for a match...</p>
                </div>
              )}

              {/* Messages */}
              {(state !== 'SEARCHING' || chatMode === 'video') && (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 min-h-0">
                  {messages.length === 0 && state === 'CONNECTED' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-600">
                      <span className="text-3xl">👋</span>
                      <p className="text-sm">Say hi!</p>
                    </div>
                  )}
                  {messages.map((msg) =>
                    msg.sender === 'system' ? (
                      <div key={msg.id} className="text-center text-xs text-gray-600 py-3 border-y border-white/5">
                        {msg.text}
                      </div>
                    ) : (
                      <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm ${
                          msg.sender === 'me'
                            ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-br-sm'
                            : 'bg-white/10 text-gray-100 rounded-bl-sm border border-white/10'
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    )
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* Input */}
              <form onSubmit={sendMessage} className="p-3 border-t border-white/10 flex gap-2 shrink-0">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder={state === 'CONNECTED' ? 'Type a message...' : 'Waiting for match...'}
                  disabled={state !== 'CONNECTED'}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500/60 disabled:opacity-40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || state !== 'CONNECTED'}
                  className="w-10 h-10 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-500 hover:to-blue-500 transition-all shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              </form>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}