"use client";

import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useChatStore } from '../store/chat-store';
import { useWebRTC } from '../hooks/useWebRTC';

// Connect to our backend server through the Next.js proxy (see next.config.mjs)
// This ensures that when testing on mobile via ngrok, both the UI and WebSockets use the same secure tunnel!
const socket = io({ autoConnect: false, path: '/socket.io' });

export default function Home() {
  const { state, setState, localStream, setStreams, messages, addMessage, reset } = useChatStore();
  const [gender, setGender] = useState('MALE');
  const [interest, setInterest] = useState('ANY');
  const [chatMode, setChatMode] = useState<'video' | 'text'>('video');
  const [inputText, setInputText] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize WebRTC logic
  const { endConnection } = useWebRTC(socket);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Setup socket listeners for text chat and online count
  useEffect(() => {
    const handleIncomingMessage = (data: { message?: string; text?: string }) => {
      const text = data.text || data.message || '';
      addMessage({ id: Date.now().toString(), sender: 'partner', text });
    };

    const handlePartnerLeft = () => {
      addMessage({ id: Date.now().toString(), sender: 'system', text: '--- Partner has disconnected ---' });
    };

    const handleOnlineCount = (data: { count: number }) => {
      setOnlineCount(data.count);
    };

    socket.on('chat_message', handleIncomingMessage);
    socket.on('partner_left', handlePartnerLeft);
    socket.on('online_count', handleOnlineCount);

    return () => {
      socket.off('chat_message', handleIncomingMessage);
      socket.off('partner_left', handlePartnerLeft);
      socket.off('online_count', handleOnlineCount);
    };
  }, [addMessage]);

  // Clear messages when searching again
  useEffect(() => {
    if (state === 'SEARCHING') {
      setCameraError('');
    }
  }, [state]);

  const handleStart = async () => {
    setCameraError('');
    
    // Request camera ONLY if video mode is selected
    if (chatMode === 'video') {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Your browser does not support video chat or you are not using HTTPS / localhost.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setStreams(stream, null);
      } catch (err: any) {
        console.error("Camera access denied", err);
        setCameraError(err.message || 'Camera access denied. Try Text Chat instead.');
        return; // Don't proceed if camera fails and they want video
      }
    } else {
      // For text chat, ensure streams are null
      setStreams(null, null);
    }

    socket.connect();
    setState('SEARCHING');
    socket.emit('join_queue', { gender, interest }, (response: any) => {
      console.log('Server response:', response);
    });
  };

  const handleSkip = () => {
    endConnection();
    socket.emit('skip');
    reset(); // Clear messages
    setState('SEARCHING');
    socket.emit('join_queue', { gender, interest });
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    // Emit to partner (support both text and message keys for compatibility)
    socket.emit('chat_message', { message: inputText, text: inputText });
    // Add to local UI
    addMessage({ id: Date.now().toString(), sender: 'me', text: inputText });
    setInputText('');
  };

  // Connect socket immediately so we get online count even before searching
  useEffect(() => {
    socket.connect();
    return () => { socket.disconnect(); };
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-gray-100 flex flex-col items-center justify-center p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      
      {/* Dynamic Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="z-10 w-full max-w-5xl flex flex-col items-center relative">
        {onlineCount > 0 && (
          <div className="absolute top-0 right-0 flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full shadow-lg backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]"></div>
            <span className="text-sm font-medium text-gray-300">{onlineCount} Online</span>
          </div>
        )}
        
        <h1 className="text-5xl font-extrabold mb-10 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 drop-shadow-sm mt-4">
          Humegle<span className="text-white">Chat</span>
        </h1>

        {state === 'IDLE' && (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl max-w-md w-full relative overflow-hidden transition-all duration-300 hover:shadow-indigo-500/10 hover:border-white/20">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-cyan-500" />
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">I am:</label>
                <div className="relative">
                  <select 
                    className="w-full appearance-none p-4 bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                    value={gender} 
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Interested in:</label>
                <select 
                  className="w-full appearance-none p-4 bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                  value={interest} 
                  onChange={(e) => setInterest(e.target.value)}
                >
                  <option value="ANY">Anyone</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Chat Mode:</label>
                <div className="flex bg-black/40 border border-white/10 rounded-xl p-1">
                  <button
                    onClick={() => setChatMode('video')}
                    className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${chatMode === 'video' ? 'bg-indigo-600 shadow-lg text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    🎥 Video
                  </button>
                  <button
                    onClick={() => setChatMode('text')}
                    className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${chatMode === 'text' ? 'bg-indigo-600 shadow-lg text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    💬 Text Only
                  </button>
                </div>
              </div>

              {cameraError && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                  {cameraError}
                </div>
              )}

              <button 
                onClick={handleStart}
                className="w-full relative group overflow-hidden bg-white text-black font-bold py-4 rounded-xl mt-4 hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                <span className="relative z-10">Find a Match</span>
                <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-indigo-200 to-cyan-200 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
        )}

        {state !== 'IDLE' && (
          <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6 h-[80vh]">
            
            {/* Left Side: Video (Only visible if video mode) */}
            {chatMode === 'video' && (
              <div className="flex-1 flex flex-col gap-4">
                {/* Remote Video */}
                <div className="flex-1 bg-black/50 backdrop-blur-sm border border-white/10 rounded-3xl overflow-hidden relative group">
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-gray-400 font-medium tracking-wide">
                      {state === 'SEARCHING' ? (
                         <span className="flex items-center gap-2">
                           <span className="animate-pulse">●</span> Looking for someone...
                         </span>
                      ) : 
                       state === 'CONNECTING' ? 'Connecting...' : 
                       state === 'PARTNER_DISCONNECTED' ? 'Partner left' : ''}
                    </span>
                  </div>
                  <video 
                    id="remoteVideo"
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover relative z-10"
                    ref={(video) => {
                      if (video && useChatStore.getState().remoteStream) {
                        video.srcObject = useChatStore.getState().remoteStream;
                      }
                    }}
                  />
                  {/* Decorative corner accents */}
                  <div className="absolute top-4 left-4 w-12 h-12 border-t-2 border-l-2 border-indigo-500/50 rounded-tl-xl opacity-0 group-hover:opacity-100 transition-opacity z-20" />
                  <div className="absolute bottom-4 right-4 w-12 h-12 border-b-2 border-r-2 border-cyan-500/50 rounded-br-xl opacity-0 group-hover:opacity-100 transition-opacity z-20" />
                </div>

                {/* Local Video & Controls */}
                <div className="h-48 md:h-64 flex gap-4">
                  <div className="flex-1 bg-black/50 backdrop-blur-sm border border-white/10 rounded-3xl overflow-hidden relative">
                    <span className="absolute bottom-3 left-4 bg-black/60 px-3 py-1 rounded-full text-xs font-medium text-gray-300 z-20 backdrop-blur-md">You</span>
                    <video 
                      id="localVideo"
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover transform scale-x-[-1] relative z-10"
                      ref={(video) => {
                        if (video && localStream) video.srcObject = localStream;
                      }}
                    />
                  </div>
                  
                  <button 
                    onClick={handleSkip}
                    className="w-32 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-100 font-bold rounded-3xl transition-all hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] flex flex-col items-center justify-center gap-2"
                  >
                    <span className="text-3xl">⏭</span>
                    <span>Skip</span>
                  </button>
                </div>
              </div>
            )}

            {/* Right Side / Full Width: Text Chat UI */}
            <div className={`${chatMode === 'video' ? 'w-full lg:w-[400px]' : 'w-full max-w-4xl mx-auto'} flex flex-col bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl`}>
              <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                <h3 className="font-semibold text-white/90">Live Chat</h3>
                {chatMode === 'text' && (
                  <button 
                    onClick={handleSkip}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-100 text-sm font-bold rounded-full transition-all"
                  >
                    Skip to Next
                  </button>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {state === 'SEARCHING' && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    <p className="animate-pulse">Looking for a match...</p>
                  </div>
                )}
                {state === 'CONNECTING' && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3">
                    <p className="animate-pulse">Connecting...</p>
                  </div>
                )}
                {state === 'CONNECTED' && messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                    <span className="text-3xl">👋</span>
                    <p>Say hello to your match!</p>
                  </div>
                )}
                
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                    {msg.sender === 'system' ? (
                      <div className="w-full text-center text-xs text-gray-500 my-4 border-t border-b border-white/5 py-2">
                        {msg.text}
                      </div>
                    ) : (
                      <div className={`max-w-[80%] p-3 rounded-2xl ${msg.sender === 'me' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-gray-800 text-gray-100 rounded-bl-sm border border-white/5'}`}>
                        {msg.text}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendMessage} className="p-4 bg-black/20 border-t border-white/10 flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={state === 'CONNECTED' ? "Type a message..." : "Waiting for match..."}
                  className="flex-1 bg-white/5 border border-white/10 rounded-full px-5 py-3 text-white outline-none focus:border-indigo-500 focus:bg-white/10 transition-all placeholder-gray-500"
                  disabled={state !== 'CONNECTED'}
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || state !== 'CONNECTED'}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full p-3 w-12 h-12 flex items-center justify-center transition-all shadow-lg hover:shadow-indigo-500/25"
                >
                  <svg className="w-5 h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                </button>
              </form>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}