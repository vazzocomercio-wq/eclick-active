'use client';

import { io, type Socket } from 'socket.io-client';
import { createClient } from '../supabase/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let _socket: Socket | null = null;

/**
 * Pega token fresco do Supabase a cada handshake. Socket.IO chama essa
 * função tanto no connect inicial quanto em CADA reconnect — o que é
 * crucial porque o JWT do Supabase expira (~1h por default). Sem isso,
 * quando o token expira o socket fica num loop infinito de
 * "WebSocket is closed before the connection is established" porque
 * o handshake auth falha (token inválido).
 */
async function getAuthToken(): Promise<string> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  } catch {
    return '';
  }
}

/**
 * Singleton lazy socket pro namespace `/events` do api. Auth via JWT do
 * Supabase (mesma sessão usada nas chamadas REST). Token é revalidado
 * a cada reconnect via callback no `auth` — evita loop infinito quando
 * o JWT expira.
 */
export async function getSocket(): Promise<Socket | null> {
  if (_socket && (_socket.connected || _socket.active)) return _socket;

  // Garante que tem ao menos um token inicial — se nem isso, sai
  const initialToken = await getAuthToken();
  if (!initialToken) return null;

  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(`${API_URL}/events`, {
    // Callback: chamada no connect inicial e em CADA reconnect.
    // Pega token fresco do Supabase pra não esbarrar em JWT expirado.
    auth: (cb: (data: { token: string }) => void) => {
      void getAuthToken().then((token) => cb({ token }));
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    // Nunca desiste de reconectar — o polling REST é rede de segurança, mas o
    // realtime deve voltar sozinho após quedas longas (server reboot, rede
    // ruim) sem exigir F5. Backoff exponencial evita martelar o servidor.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    autoConnect: true,
  });

  // Logs de diagnóstico (visíveis no Console do browser pra debug)
  _socket.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[socket] connected', _socket?.id);
  });
  _socket.on('disconnect', (reason) => {
    // eslint-disable-next-line no-console
    console.log('[socket] disconnected:', reason);
  });
  _socket.on('connect_error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[socket] connect error:', err.message);
  });
  _socket.on('auth:error', (payload: { message?: string }) => {
    // eslint-disable-next-line no-console
    console.warn('[socket] auth rejected:', payload?.message);
  });
  _socket.on('auth:ok', (payload: { user_id?: string; org_id?: string }) => {
    // eslint-disable-next-line no-console
    console.log('[socket] auth ok user=', payload?.user_id, 'org=', payload?.org_id);
  });

  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
