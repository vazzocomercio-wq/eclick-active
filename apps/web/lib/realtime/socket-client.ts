'use client';

import { io, type Socket } from 'socket.io-client';
import { createClient } from '../supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let _socket: Socket | null = null;

/**
 * Singleton lazy socket pro namespace `/events` do api. Auth via JWT do
 * Supabase (mesma sessão usada nas chamadas REST).
 *
 * Eventos custom (ai:suggestion, etc.) chegam por aqui. Mudanças puras
 * de row (conversations/messages) o cliente escuta direto via Supabase
 * Realtime — não duplicamos handler.
 */
export async function getSocket(): Promise<Socket | null> {
  if (_socket?.connected) return _socket;

  let token: string | undefined;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    return null;
  }
  if (!token) return null;

  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(`${API_URL}/events`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
