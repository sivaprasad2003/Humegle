import { useEffect, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { useChatStore } from '../store/chat-store';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const useWebRTC = (socket: Socket) => {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const { localStream, setStreams, setState } = useChatStore();

  const closePeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    // Clear the remote stream
    useChatStore.getState().setStreams(useChatStore.getState().localStream, null);
  }, []);

  const initWebRTC = useCallback(async (isInitiator: boolean, stream: MediaStream | null) => {
    closePeer();

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerRef.current = pc;

    // Add local tracks to the peer connection
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // When we receive the partner's video/audio
    pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        useChatStore.getState().setStreams(useChatStore.getState().localStream, event.streams[0]);
        useChatStore.getState().setState('CONNECTED');
      }
    };

    // Send ICE candidates to the partner
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_signal', { type: 'ice-candidate', payload: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        useChatStore.getState().setState('CONNECTED');
      } else if (s === 'failed' || s === 'disconnected') {
        useChatStore.getState().setState('ERROR');
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_signal', { type: 'offer', payload: offer });
    }
  }, [socket, closePeer]);

  useEffect(() => {
    const onMatched = async ({ role, mode }: { role: string; mode: string }) => {
      // Text-only mode: skip WebRTC entirely
      if (mode === 'text') {
        setState('CONNECTED');
        return;
      }

      setState('CONNECTING');
      // Get the most current local stream from the store at match time
      const currentStream = useChatStore.getState().localStream;
      await initWebRTC(role === 'initiator', currentStream);
    };

    const onSignal = async ({ type, payload }: { type: string; payload: any }) => {
      const pc = peerRef.current;
      if (!pc) return;

      try {
        if (type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc_signal', { type: 'answer', payload: answer });
        } else if (type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
        } else if (type === 'ice-candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        }
      } catch (err) {
        console.error('[WebRTC] Signal error:', err);
      }
    };

    const onPartnerLeft = () => {
      closePeer();
      setState('PARTNER_DISCONNECTED');
    };

    socket.on('matched', onMatched);
    socket.on('webrtc_signal', onSignal);
    socket.on('partner_left', onPartnerLeft);

    return () => {
      socket.off('matched', onMatched);
      socket.off('webrtc_signal', onSignal);
      socket.off('partner_left', onPartnerLeft);
    };
  }, [socket, initWebRTC, closePeer, setState]);

  return { endConnection: closePeer };
};
