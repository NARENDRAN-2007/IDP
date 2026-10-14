import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.js';
import { getAccessToken } from '../lib/api.js';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  isPollingFallback: boolean;
  onRefreshTrigger: (callback: () => void) => () => void;
  triggerRefresh: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hospitalId } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isPollingFallback, setIsPollingFallback] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const disconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const refreshListenersRef = useRef<Set<() => void>>(new Set());

  const triggerRefresh = useCallback(() => {
    refreshListenersRef.current.forEach((fn) => fn());
  }, []);

  const onRefreshTrigger = useCallback((callback: () => void) => {
    refreshListenersRef.current.add(callback);
    return () => {
      refreshListenersRef.current.delete(callback);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !hospitalId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      setIsPollingFallback(false);
      return;
    }

    const token = getAccessToken();
    const newSocket = io('/', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setIsConnected(true);
      setIsPollingFallback(false);
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      // On reconnect: re-sync state immediately (Plan 8.3)
      triggerRefresh();
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      // Fall back to 2 s polling if socket is down for more than 10 s (Plan 8.3)
      if (!disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => {
          setIsPollingFallback(true);
        }, 10000);
      }
    });

    // Listen to all hospital domain events and trigger auto-refresh
    const events = [
      'hospital.provisional',
      'hold.created',
      'hold.cascaded',
      'severity.classified',
      'bed.confirmed',
      'beds.updated',
      'ambulance.location',
      'vitals.update',
      'request.completed'
    ];

    events.forEach((evt) => {
      newSocket.on(evt, () => {
        triggerRefresh();
      });
    });

    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      newSocket.disconnect();
    };
  }, [isAuthenticated, hospitalId, triggerRefresh]);

  // If in polling fallback mode (> 10s disconnected), poll every 2 seconds (Plan 8.3)
  useEffect(() => {
    if (!isPollingFallback) return;
    const interval = setInterval(() => {
      triggerRefresh();
    }, 2000);
    return () => clearInterval(interval);
  }, [isPollingFallback, triggerRefresh]);

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        isPollingFallback,
        onRefreshTrigger,
        triggerRefresh
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within a SocketProvider');
  return context;
}
