import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useChatStore } from '../store/chat-store';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
};

export const useWebRTC = (socket: Socket) => {
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const { localStream, setStreams, setState } = useChatStore();

  const initWebRTC = async (isInitiator: boolean) => {
    peerConnection.current = new RTCPeerConnection(ICE_SERVERS);

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.current?.addTrack(track, localStream);
      });
    }

    peerConnection.current.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setStreams(localStream, event.streams[0]);
        setState('CONNECTED');
      }
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_signal', { type: 'ice-candidate', payload: event.candidate });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current?.connectionState === 'failed') {
        setState('ERROR');
      }
    };

    if (isInitiator) {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.emit('webrtc_signal', { type: 'offer', payload: offer });
    }
  };

  useEffect(() => {
    socket.on('matched', async ({ role }) => {
      // If we don't have a local stream, we are in Text Only mode.
      // We don't need WebRTC, so we just instantly connect!
      if (!localStream) {
        setState('CONNECTED');
        return;
      }
      
      setState('CONNECTING');
      await initWebRTC(role === 'initiator');
    });

    socket.on('webrtc_signal', async ({ type, payload }) => {
      if (!peerConnection.current) return;

      if (type === 'offer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('webrtc_signal', { type: 'answer', payload: answer });
      } else if (type === 'answer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (type === 'ice-candidate') {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload));
      }
    });

    socket.on('partner_left', () => {
      peerConnection.current?.close();
      peerConnection.current = null;
      setState('PARTNER_DISCONNECTED');
    });

    return () => {
      socket.off('matched');
      socket.off('webrtc_signal');
      socket.off('partner_left');
    };
  }, [socket, localStream]);

  const endConnection = () => {
    peerConnection.current?.close();
    peerConnection.current = null;
  };

  return { endConnection };
};
