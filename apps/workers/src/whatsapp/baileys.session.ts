import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { getSupabase } from '../supabase.js';
import {
  broadcastRealtime,
  notifyInboundProcessed,
} from './internal-api-client.js';
import { loadAuthState, type BaileysAuthHandle } from './baileys-auth-state.js';

/**
 * TTL do cache de resolução phone → JID. Valores conservadores:
 * positivo 30min (JID mudaria só em re-registro do contato),
 * negativo 5min (deixa user reativar WA e reenviar sem esperar muito).
 */
const JID_CACHE_POSITIVE_TTL_MS = 30 * 60 * 1000;
const JID_CACHE_NEGATIVE_TTL_MS = 5 * 60 * 1000;

interface SessionContext {
  channelId: string;
  orgId: string;
  /** True quando a sessão NÃO tem auth state ainda (precisa pareamento via QR) */
  needsPairing: boolean;
}

/**
 * Gerencia uma sessão Baileys (= 1 socket WhatsApp Web pra um canal).
 * Encapsula:
 *   - Boot (carrega auth state, conecta)
 *   - Eventos: connection.update (QR/connected/disconnected), creds.update
 *     (auto-save), messages.upsert (persistência)
 *   - Reconnect simples (Baileys reaproveita auth state quando conexão cai)
 *   - Cleanup explícito
 */
export class BaileysSession {
  private sock: WASocket | null = null;
  private auth: BaileysAuthHandle | null = null;
  private currentQr: string | null = null;
  private connecting = false;
  private terminated = false;

  /**
   * Cache phone-cleaned → JID canônico (com TTL). Resolve cold outbound:
   * sem cache, cada sendMessage pra um número novo faria onWhatsApp() ~200ms.
   * Entry com `jid=null` indica número confirmado SEM WhatsApp (TTL menor
   * pra deixar user reativar e tentar de novo sem esperar TTL longo).
   */
  private readonly jidCache = new Map<string, { jid: string | null; expiresAt: number }>();

  /**
   * Logger Baileys com destination customizado pra detectar "Closing session"
   * — log do libsignal interno que indica que a sessão Signal Protocol com
   * o contato foi fechada. Quando isso acontece, próximas msgs cifradas
   * desse contato podem falhar a decryption silenciosamente (msgs perdidas).
   *
   * Reativo: quando detecta o pattern, agendamos assertSessions pra TODOS
   * os JIDs de contatos ativos pra "reabrir" sessões — best-effort. JID
   * exato não vem no log, daí o broadcast.
   */
  private readonly logger = pino(
    {
      level: process.env.BAILEYS_LOG_LEVEL ?? 'warn',
      base: { sess: 'baileys' },
    },
    {
      write: (msg: string): void => {
        process.stdout.write(msg);
        if (msg.includes('Closing session')) {
          // eslint-disable-next-line no-console
          console.log(
            `[baileys ${this.ctx.channelId}] ⚠️ DETECTED Closing session — agendando reset de sessões ativas`,
          );
          void this.refreshActiveSessionsAfterClose().catch((err: unknown) =>
            // eslint-disable-next-line no-console
            console.warn(
              `[baileys ${this.ctx.channelId}] refreshActiveSessions falhou:`,
              err instanceof Error ? err.message : err,
            ),
          );
        }
      },
    },
  );

  /**
   * Pega todos os JIDs de contatos com conversa aberta neste canal nas
   * últimas 24h e força assertSessions pra reabrir sessão Signal. Throttle
   * de 30s pra evitar spam quando muitos `Closing session` rolam em rajada.
   */
  private lastSessionRefreshAt = 0;
  private async refreshActiveSessionsAfterClose(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSessionRefreshAt < 30_000) return; // throttle 30s
    this.lastSessionRefreshAt = now;

    if (!this.sock) return;

    const supabase = getSupabase();
    const since = new Date(now - 24 * 3600_000).toISOString();
    const { data: convs } = await supabase
      .from('conversations')
      .select('contact_id')
      .eq('org_id', this.ctx.orgId)
      .eq('channel_id', this.ctx.channelId)
      .eq('status', 'open')
      .gte('last_message_at', since);

    const contactIds = ((convs as { contact_id: string }[] | null) ?? []).map(
      (c) => c.contact_id,
    );
    if (contactIds.length === 0) return;

    const { data: contacts } = await supabase
      .from('contacts')
      .select('whatsapp_jid')
      .eq('org_id', this.ctx.orgId)
      .in('id', contactIds)
      .not('whatsapp_jid', 'is', null);

    const jids = ((contacts as { whatsapp_jid: string | null }[] | null) ?? [])
      .map((c) => c.whatsapp_jid)
      .filter((j): j is string => !!j);
    if (jids.length === 0) return;

    try {
      await this.sock.assertSessions(jids, true);
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] sessões re-asseguradas pra ${jids.length} JIDs`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] assertSessions broadcast falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  constructor(private readonly ctx: SessionContext) {}

  get channelId(): string {
    return this.ctx.channelId;
  }

  get orgId(): string {
    return this.ctx.orgId;
  }

  get qr(): string | null {
    return this.currentQr;
  }

  async start(): Promise<void> {
    if (this.connecting || this.terminated) return;
    this.connecting = true;

    try {
      this.auth = await loadAuthState(this.ctx.channelId);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: this.auth.state,
        printQRInTerminal: false,
        browser: Browsers.appropriate('e-Click Active'),
        logger: this.logger as never,
        // Não buscamos histórico antigo — só mensagens novas a partir da conexão
        syncFullHistory: false,
        markOnlineOnConnect: false,
        // Recovery de mensagens cifradas que falharam decryption inicial.
        // Default Baileys = 250ms × 3 tentativas (frequentemente insuficiente
        // quando o peer está offline ou em rede ruim — msg fica órfã e nunca
        // aparece no nosso DB). Aumentando: 500ms × 8 = ~4s de janela total
        // pro peer responder ao retry request.
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 8,
        // Callback obrigatório pra que o protocolo de retry funcione.
        // Quando NÓS mandamos msg que peer falhou em decifrar, peer pede
        // retry e Baileys precisa do conteúdo original — sem getMessage,
        // ele desiste silenciosamente. Pra inbound puro (msg do peer pra
        // nós), retornar undefined é safe — o conteúdo vem direto do socket
        // após retry bem-sucedido.
        getMessage: async () => undefined,
      });

      this.sock.ev.on('creds.update', () => {
        void this.auth?.saveCreds();
      });

      this.sock.ev.on('connection.update', (update) => {
        void this.onConnectionUpdate(update).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[baileys ${this.ctx.channelId}] connection.update erro:`, err);
        });
      });

      this.sock.ev.on('messages.upsert', (m) => {
        // Log defensivo de TUDO que chega — capturar msgs perdidas
        // (reportadas em prod 2026-05-05). Mostra type + count + ids
        // pra cruzar com WhatsApp screenshot do user e detectar onde
        // a msg cai.
        // eslint-disable-next-line no-console
        console.log(
          `[baileys ${this.ctx.channelId}] messages.upsert type=${m.type} count=${m.messages.length} ids=${m.messages.map((mm) => `${mm.key.id?.slice(0, 12)}/${mm.key.fromMe ? 'me' : 'other'}/${mm.message ? Object.keys(mm.message).slice(0, 2).join(',') : 'null'}`).join(';')}`,
        );

        // Aceita 'notify' (msg nova) E 'append' (re-entrega após retry de
        // decryption — quando peer reenvia msg cifrada que nosso device
        // falhou inicialmente). Antes pulávamos 'append' e a msg recovered
        // ficava órfã — sintoma "msg só apareceu depois de muito tempo"
        // só quando próxima msg do mesmo contato forçava re-sync.
        if (m.type !== 'notify' && m.type !== 'append') {
          // eslint-disable-next-line no-console
          console.log(
            `[baileys ${this.ctx.channelId}] messages.upsert skip — type=${m.type} (history/sync de outro device)`,
          );
          return;
        }
        for (const msg of m.messages) {
          void this.handleInboundCandidate(msg);
        }
      });

      // messages.update: dispara quando uma msg que veio inicialmente sem
      // conteúdo decifrado é decryptada depois (recovery via retry). Baileys
      // emite update com `update.message` populado. Tratamos como inbound
      // tardio.
      this.sock.ev.on('messages.update', (updates) => {
        for (const u of updates) {
          if (!u.update?.message || u.key.fromMe) continue;
          // eslint-disable-next-line no-console
          console.log(
            `[baileys ${this.ctx.channelId}] messages.update RECOVERY id=${u.key.id?.slice(0, 16)} from=${u.key.remoteJid} keys=${Object.keys(u.update.message).slice(0, 3).join(',')}`,
          );
          // Reconstrói shape de WAMessage pra reusar persistInbound
          const recovered: WAMessage = {
            key: u.key,
            message: u.update.message,
            messageTimestamp: u.update.messageTimestamp ?? Math.floor(Date.now() / 1000),
            pushName: u.update.pushName ?? undefined,
          } as WAMessage;
          void this.handleInboundCandidate(recovered);
        }
      });

      // Loga evolução de status de mensagens outbound: PENDING(1) →
      // SERVER_ACK(2) → DELIVERY_ACK(3) → READ(4) → PLAYED(5). Se uma
      // msg para em SERVER_ACK e nunca avança, o WhatsApp servidor
      // recebeu mas o device do destinatário não confirmou — sintoma
      // típico de bad session/missing pre-keys no protocolo Signal.
      this.sock.ev.on('messages.update', (updates) => {
        for (const u of updates) {
          // eslint-disable-next-line no-console
          console.log(
            `[baileys ${this.ctx.channelId}] messages.update keyId=${u.key.id} jid=${u.key.remoteJid} status=${u.update?.status}`,
          );
        }
      });
    } finally {
      this.connecting = false;
    }
  }

  async stop(): Promise<void> {
    this.terminated = true;
    this.sock?.end(undefined);
    this.sock = null;
  }

  // ──────────────────────────────────────────────────────────
  // OUTBOUND — chamado pelo internal HTTP server quando a API
  // recebe POST /conversations/:id/messages e o canal é whatsapp_free.
  // ──────────────────────────────────────────────────────────

  /**
   * Envia mensagem via Baileys WebSocket. Requer sessão `connection === 'open'`.
   *
   * @param phone Número internacional sem `+` ou JID completo (ex: `5571999999999`
   *   ou `5571999999999@s.whatsapp.net`).
   * @param content Conteúdo a enviar — text/image/audio/video/document.
   * @returns ID da mensagem no protocolo Baileys (ex: `3EB0...`).
   */
  async sendMessage(phone: string, content: OutboundContent): Promise<string> {
    if (!this.sock) {
      throw new Error('session_not_ready: socket Baileys ainda não conectado');
    }
    if (this.terminated) {
      throw new Error('session_terminated: sessão encerrada');
    }

    // Resolve JID consultando o servidor WhatsApp (sock.onWhatsApp).
    // Antes inventávamos o JID localmente com brPhoneCandidates[0] —
    // isso falhava em cold outbound (número que nunca conversou) quando
    // o palpite não bate com o JID real (ex: contas legacy pré-2012 sem
    // o 9, números com DDI atípico). O servidor sabe o JID canônico de
    // cada número — usamos ele como fonte da verdade. Pattern portado
    // do eclick-backend (intelligence-hub funciona em prod com isso).
    const jid = await this.resolveJid(phone);
    // eslint-disable-next-line no-console
    console.log(
      `[baileys ${this.ctx.channelId}] sendMessage → input="${phone}" jid="${jid}" kind=${content.kind}`,
    );

    let payload: Parameters<WASocket['sendMessage']>[1];
    switch (content.kind) {
      case 'text':
        payload = { text: content.body };
        break;
      case 'image':
        payload = {
          image: { url: content.url },
          ...(content.caption ? { caption: content.caption } : {}),
        };
        break;
      case 'audio':
        payload = {
          audio: { url: content.url },
          mimetype: content.mime_type ?? 'audio/ogg; codecs=opus',
          ptt: content.ptt ?? true,
        };
        break;
      case 'video':
        payload = {
          video: { url: content.url },
          ...(content.caption ? { caption: content.caption } : {}),
        };
        break;
      case 'document':
        payload = {
          document: { url: content.url },
          // Baileys exige mimetype não-opcional pra documentos. Fallback
          // genérico permite enviar arquivos com tipo desconhecido.
          mimetype: content.mime_type ?? 'application/octet-stream',
          ...(content.filename ? { fileName: content.filename } : {}),
        };
        break;
      default: {
        const _exhaustive: never = content;
        throw new Error(
          `unsupported_content: ${(_exhaustive as { kind: string }).kind}`,
        );
      }
    }

    // Antes do envio, força fetch de pre-keys do destinatário e
    // estabelecimento de sessão Signal. Sem isso, mensagens iniciadas
    // pelo nosso lado (sem inbound prévio do lead) ficam com sessão
    // criptográfica inválida — WhatsApp aceita o ciphertext mas o
    // device do destinatário descarta silenciosamente. Quando o lead
    // manda primeiro, o pre-key bundle dele vem junto e a sessão é
    // estabelecida automaticamente, daí msgs subsequentes chegam.
    // assertSessions é idempotente: se sessão já existe, no-op.
    try {
      await this.sock.assertSessions([jid], true);
      // eslint-disable-next-line no-console
      console.log(`[baileys ${this.ctx.channelId}] assertSessions ok jid=${jid}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] assertSessions falhou jid=${jid}:`,
        err instanceof Error ? err.message : err,
      );
    }

    let result: Awaited<ReturnType<WASocket['sendMessage']>>;
    try {
      result = await this.sock.sendMessage(jid, payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[baileys ${this.ctx.channelId}] sendMessage threw jid=${jid}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[baileys ${this.ctx.channelId}] sendMessage result keyId=${result?.key?.id} status=${result?.status} fromMe=${result?.key?.fromMe}`,
    );
    if (!result?.key?.id) {
      throw new Error('send_failed: Baileys não retornou messageId');
    }
    return result.key.id;
  }

  /** True se a sessão está pronta pra enviar mensagens. */
  isReady(): boolean {
    return !!this.sock && !this.terminated;
  }

  /**
   * Resolve `phoneOrJid` (input livre) pro JID canônico do servidor
   * WhatsApp. Cacheia por TTL pra evitar onWhatsApp() em cada send.
   *
   * Por que NÃO inventar o JID localmente?
   *   1. Contas legacy pré-2012 vivem em JID sem o 9 (12 dígitos). Manda
   *      "5571994095636@s.whatsapp.net" e o WA pode silenciosamente
   *      rotear pra outra pessoa OU descartar.
   *   2. Números com DDI atípico (não-BR) não passam por brPhoneCandidates.
   *   3. Cold outbound — número sem inbound prévio — só funciona se o JID
   *      for o REAL. Sem `assertSessions` no JID certo, o ciphertext é
   *      aceito pelo servidor mas o device descarta.
   *
   * Erros tipados:
   *   - `number_not_on_whatsapp`: onWhatsApp retornou exists=false
   *   - `session_not_ready`: socket Baileys offline
   */
  private async resolveJid(phoneOrJid: string): Promise<string> {
    if (phoneOrJid.includes('@')) return phoneOrJid;

    const cleaned = phoneOrJid.replace(/\D/g, '');
    if (!cleaned) throw new Error('invalid_phone: empty after cleaning');

    const cached = this.jidCache.get(cleaned);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.jid) throw new Error(`number_not_on_whatsapp: ${cleaned}`);
      return cached.jid;
    }

    if (!this.sock) {
      throw new Error('session_not_ready: socket Baileys ainda não conectado');
    }

    const results = await this.sock.onWhatsApp(cleaned).catch(() => []);
    const first = results?.[0];

    if (!first?.exists || !first.jid) {
      // Cache negativo curto pra evitar lookup pesado em loop
      this.jidCache.set(cleaned, {
        jid: null,
        expiresAt: Date.now() + JID_CACHE_NEGATIVE_TTL_MS,
      });
      throw new Error(`number_not_on_whatsapp: ${cleaned}`);
    }

    this.jidCache.set(cleaned, {
      jid: first.jid,
      expiresAt: Date.now() + JID_CACHE_POSITIVE_TTL_MS,
    });

    // Log apenas quando há normalização (caso pré-2012) — sinaliza pro
    // operador que o input não bate com o JID real.
    const jidPhone = first.jid.replace('@s.whatsapp.net', '').replace('@lid', '');
    if (jidPhone !== cleaned) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] JID normalize ${cleaned} → ${jidPhone} (legacy WA registration)`,
      );
    }

    return first.jid;
  }

  /**
   * Pergunta ao Baileys se um número tem WhatsApp ativo. Aceita telefone
   * em formato internacional (ex: 5571999999999) ou já um JID. Retorna
   * o JID canônico (`...@s.whatsapp.net` ou `...@lid`) quando existe, e
   * tenta buscar foto de perfil e profile name (best-effort).
   *
   * Pra brasileiros, prefere o JID com o 9 inicial (formato moderno).
   * sock.onWhatsApp pode retornar JID sem 9 (formato pré-2012) mesmo
   * quando o número moderno também existe — daí mandaríamos pra outra
   * pessoa. Tenta na ordem: com 9 → sem 9 (fallback pra contas legacy).
   */
  async checkNumber(phoneOrJid: string): Promise<{
    exists: boolean;
    jid?: string;
    profile_name?: string;
    profile_pic_url?: string;
  }> {
    if (!this.sock || this.terminated) {
      throw new Error('session_not_ready');
    }

    if (phoneOrJid.includes('@')) {
      // JID direto — só consulta
      return this.checkSingle(phoneOrJid);
    }

    const digits = phoneOrJid.replace(/\D/g, '');
    if (!digits) return { exists: false };

    // Pra BR: tenta candidates em ordem (preferindo formato moderno c/ 9).
    // Pra outros países: usa o input direto sem chutar.
    const candidates = brPhoneCandidates(digits);
    for (const candidate of candidates) {
      const r = await this.checkSingle(candidate);
      if (r.exists) {
        // Workaround pra "shadow accounts" BR: quando o input é formato
        // moderno (13 dig com 9), forçar o JID construído com o 9 mesmo
        // que onWhatsApp tenha retornado JID legacy (12 dig sem 9). Em
        // alguns casos a conta legacy existe no servidor do WhatsApp com
        // foto/dados antigos preservados, mas o usuário ATIVO está só no
        // JID moderno — mensagens pro legacy "vão" mas não entregam.
        //
        // Critério: candidate tem 13 dig começando com 55 e 9 após DDD.
        if (
          candidate.length === 13 &&
          candidate.startsWith('55') &&
          candidate[4] === '9'
        ) {
          return { ...r, jid: `${candidate}@s.whatsapp.net` };
        }
        return r;
      }
    }
    return { exists: false };
  }

  /**
   * Faz UMA consulta no onWhatsApp + busca foto/nome. Helper interno.
   */
  private async checkSingle(input: string): Promise<{
    exists: boolean;
    jid?: string;
    profile_name?: string;
    profile_pic_url?: string;
  }> {
    if (!this.sock) return { exists: false };

    const results = await this.sock.onWhatsApp(input).catch(() => []);
    const first = results?.[0];
    if (!first?.exists || !first.jid) {
      return { exists: false };
    }

    const profilePicUrl = await this.sock
      .profilePictureUrl(first.jid, 'image')
      .catch(() => undefined);

    let profileName: string | undefined;
    try {
      const stored = (
        this.sock as unknown as {
          store?: { contacts?: Record<string, { name?: string; notify?: string }> };
        }
      ).store?.contacts?.[first.jid];
      if (stored?.name) profileName = stored.name;
      else if (stored?.notify) profileName = stored.notify;
    } catch {
      /* sem store, sem nome */
    }

    return {
      exists: true,
      jid: first.jid,
      ...(profileName ? { profile_name: profileName } : {}),
      ...(profilePicUrl ? { profile_pic_url: profilePicUrl } : {}),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Event handlers
  // ──────────────────────────────────────────────────────────

  private async onConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.currentQr = qr;
      void broadcastRealtime({
        org_id: this.ctx.orgId,
        event: 'whatsapp:qr',
        payload: { channel_id: this.ctx.channelId, qr },
      });
    }

    if (connection === 'open') {
      this.currentQr = null;
      const me = this.sock?.user;
      const phone = me?.id ? extractPhoneFromJid(me.id) : null;
      const displayName = me?.name ?? me?.verifiedName ?? undefined;

      await this.markChannelActive(phone, displayName);

      void broadcastRealtime({
        org_id: this.ctx.orgId,
        event: 'whatsapp:connected',
        payload: {
          channel_id: this.ctx.channelId,
          phone_number: phone ?? '',
          ...(displayName ? { display_name: displayName } : {}),
        },
      });
    }

    if (connection === 'close') {
      // lastDisconnect.error é um Boom — extraímos output.statusCode sem
      // depender da lib (evita uma dep extra no worker).
      const errOutput = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output;
      const code = errOutput?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      const reason = isLoggedOut
        ? 'logged_out'
        : (lastDisconnect?.error?.message ?? `code:${code ?? 'unknown'}`);

      this.sock = null;

      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] disconnected (code=${code} reason=${reason})`,
      );

      if (isLoggedOut) {
        // Terminal: usuário deslogou no celular ou WA invalidou a sessão.
        // Limpa auth + marca canal disconnected + avisa frontend pra
        // reescanear o QR.
        await this.auth?.clear();
        await this.markChannelDisconnected(reason);
        void broadcastRealtime({
          org_id: this.ctx.orgId,
          event: 'whatsapp:disconnected',
          payload: {
            channel_id: this.ctx.channelId,
            reason,
            needs_reauth: true,
          },
        });
        return;
      }

      // Transient (restartRequired=515 é o caso mais comum no primeiro
      // pareamento; também: connectionLost, connectionClosed, timedOut).
      // Baileys orienta a simplesmente reabrir o socket com o mesmo auth
      // state. Não marcamos erro no DB nem notificamos frontend — pro
      // usuário é reconexão silenciosa, o QR continua válido e/ou avança
      // pra "open" na sequência.
      if (this.terminated) return;
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] auto-restart em 1s (transient disconnect)`,
      );
      setTimeout(() => {
        if (this.terminated) return;
        void this.start().catch((err) => {
          // eslint-disable-next-line no-console
          console.error(
            `[baileys ${this.ctx.channelId}] auto-restart falhou:`,
            err instanceof Error ? err.message : err,
          );
        });
      }, 1000);
    }
  }

  /**
   * Filtra/encaminha msg pro persistInbound. Captura decryption failures
   * (msg vazia ou só com protocol blocks) e dispara assertSessions
   * proativo pro JID — próxima msg deles vem decifrada.
   */
  private async handleInboundCandidate(msg: WAMessage): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    // eslint-disable-next-line no-console
    console.log(
      `[baileys ${this.ctx.channelId}] inbound from=${remoteJid} fromMe=${msg.key.fromMe} id=${msg.key.id?.slice(0, 16)} hasMessage=${!!msg.message}`,
    );

    if (msg.key.fromMe) return; // ignora eco do próprio device

    // Msg sem conteúdo = decryption failure ou msg de protocolo (entrega/leitura).
    // Dispara assertSessions PROATIVO pro JID — futura msg dele vem OK.
    if (!msg.message) {
      if (remoteJid && this.sock) {
        // eslint-disable-next-line no-console
        console.warn(
          `[baileys ${this.ctx.channelId}] msg vazia from=${remoteJid} — provável decryption failure, disparando assertSessions`,
        );
        try {
          await this.sock.assertSessions([remoteJid], true);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[baileys ${this.ctx.channelId}] assertSessions ${remoteJid} falhou:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      return;
    }

    // Pula msgs que são apenas blocks de protocolo (senderKeyDistributionMessage,
    // protocolMessage, etc) sem conteúdo de usuário. Estes são parte do handshake
    // Signal — não devem virar msg no inbox.
    const messageKeys = Object.keys(msg.message);
    const CONTENT_KEYS = new Set([
      'conversation',
      'extendedTextMessage',
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
      'documentWithCaptionMessage',
      'stickerMessage',
      'contactMessage',
      'contactsArrayMessage',
      'locationMessage',
      'liveLocationMessage',
      'reactionMessage',
      'pollCreationMessage',
      'pollUpdateMessage',
      'buttonsResponseMessage',
      'listResponseMessage',
      'templateButtonReplyMessage',
      'ephemeralMessage',
      'viewOnceMessage',
      'viewOnceMessageV2',
    ]);
    const hasUserContent = messageKeys.some((k) => CONTENT_KEYS.has(k));
    if (!hasUserContent) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] msg só protocol blocks (${messageKeys.join(',')}) from=${remoteJid} — skip persist`,
      );
      return;
    }

    try {
      await this.persistInbound(msg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[baileys ${this.ctx.channelId}] persistInbound erro:`, err);
    }
  }

  private async persistInbound(msg: WAMessage): Promise<void> {
    if (!msg.message || msg.key.fromMe) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] persistInbound skip — fromMe=${msg.key.fromMe} hasMessage=${!!msg.message}`,
      );
      return; // ignora outbound (eco) e tombstones
    }

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us')) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] persistInbound skip — jid=${remoteJid} (sem JID ou grupo)`,
      );
      return; // ignora grupos no MVP
    }

    // JID pode ser `@s.whatsapp.net` (digits = telefone real) OU `@lid`
    // (digits = pseudo-ID anônimo, NÃO é telefone). O JID completo é a
    // identidade canônica — é o que o WhatsApp usa pra rotear de volta.
    const isPhoneJid = remoteJid.endsWith('@s.whatsapp.net');
    const phone = isPhoneJid ? extractPhoneFromJid(remoteJid) : null;

    const senderName = msg.pushName ?? undefined;
    const messageId = msg.key.id ?? `${Date.now()}-${Math.random()}`;

    const parsed = extractContent(msg.message);
    if (!parsed) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] persistInbound skip — tipo não suportado msgKeys=${Object.keys(msg.message).slice(0, 3).join(',')} id=${messageId.slice(0, 12)}`,
      );
      return; // tipo não suportado no MVP
    }
    // eslint-disable-next-line no-console
    console.log(
      `[baileys ${this.ctx.channelId}] persistInbound persist kind=${parsed.kind} from=${senderName ?? '(sem nome)'} text="${parsed.kind === 'text' ? parsed.body.slice(0, 60) : ''}" id=${messageId.slice(0, 12)}`,
    );

    const supabase = getSupabase();

    // 1) findOrCreate contact (por org_id + wa_jid; fallback phone p/ legacy)
    const contactId = await this.findOrCreateContact(remoteJid, phone, senderName);
    if (!contactId) return;

    // 2) findOrCreate conversation
    const conversationId = await this.findOrCreateConversation(contactId);
    if (!conversationId) return;

    // 3) Persiste mensagem (idempotente: índice único em
    //    (channel_id, channel_message_id) bate dedup)
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        org_id: this.ctx.orgId,
        conversation_id: conversationId,
        direction: 'inbound',
        sender_type: 'contact',
        sender_id: null,
        content_type: parsed.kind,
        content: parsed,
        plain_text: parsed.kind === 'text' ? parsed.body : null,
        channel_message_id: messageId,
        status: 'delivered',
        is_internal_note: false,
        metadata: {},
      })
      .select('*')
      .single();

    if (error) {
      // 23505 = duplicata; ignora
      if ((error as { code?: string }).code === '23505') return;
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] insert message falhou: ${error.message}`,
      );
      return;
    }

    // 4) Emite message:new pro frontend (re-fetch da row inserida)
    void broadcastRealtime({
      org_id: this.ctx.orgId,
      event: 'message:new',
      payload: { conversation_id: conversationId, message: inserted },
    });

    // 5) Se a msg trouxe mídia, baixa o blob e arquiva no Storage.
    //    Best-effort: erro aqui não bloqueia o flow.
    const insertedMessageId = (inserted as { id?: string } | null)?.id;
    if (insertedMessageId && parsed.kind !== 'text') {
      void this.persistAttachment(msg, insertedMessageId, conversationId, contactId, parsed).catch(
        (err: unknown) =>
          // eslint-disable-next-line no-console
          console.warn(
            `[baileys ${this.ctx.channelId}] persistAttachment falhou:`,
            err instanceof Error ? err.message : err,
          ),
      );
    }

    // 6) Avisa a api pra rodar o pipeline de IA (classify + concierge) e
    //    automations (trigger=message_received). Sem isso, mensagens
    //    do WhatsApp Gratuito não disparam nada do lado da api.
    if (insertedMessageId) {
      void notifyInboundProcessed({
        org_id: this.ctx.orgId,
        conversation_id: conversationId,
        contact_id: contactId,
        message_id: insertedMessageId,
        channel_id: this.ctx.channelId,
        channel_type: 'whatsapp_free',
        message_text: parsed.kind === 'text' ? parsed.body : '',
      });
    }
  }

  /**
   * Baixa o blob da mídia via Baileys, sobe pro Supabase Storage no
   * bucket `message-media` e cria row em `attachments`. Best-effort.
   *
   * Path: `{orgId}/{conversationId}/{messageId}/{uuid}.{ext}`
   *
   * Mídia inicial cobre: image, audio, video, document. Cada uma tem
   * mimetype e fileSize próprios via Baileys proto.
   */
  private async persistAttachment(
    msg: WAMessage,
    messageId: string,
    conversationId: string,
    contactId: string,
    parsed: ParsedContent,
  ): Promise<void> {
    if (parsed.kind === 'text') return;

    // Baixa o blob da mídia. logger é o mesmo do socket (silenciado por default).
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: this.logger as never,
        // @ts-expect-error reuploadRequest é interno mas necessário pra mídia perdida
        reuploadRequest: this.sock?.updateMediaMessage,
      },
    );
    if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] downloadMediaMessage retornou vazio (msg=${messageId})`,
      );
      return;
    }

    // Pega mime + filename do proto da mensagem
    const m = msg.message ?? {};
    const mediaInfo = (() => {
      if (parsed.kind === 'image') return { mime: m.imageMessage?.mimetype, file: null };
      if (parsed.kind === 'audio') return { mime: m.audioMessage?.mimetype, file: null };
      if (parsed.kind === 'video') return { mime: m.videoMessage?.mimetype, file: null };
      if (parsed.kind === 'document')
        return {
          mime: m.documentMessage?.mimetype,
          file: m.documentMessage?.fileName ?? null,
        };
      return { mime: null, file: null };
    })();

    const mimeType = mediaInfo.mime ?? defaultMimeFor(parsed.kind);
    const ext = extFromMime(mimeType) ?? 'bin';
    const fileName = mediaInfo.file ?? `${parsed.kind}-${randomUUID()}.${ext}`;
    const storagePath = `${this.ctx.orgId}/${conversationId}/${messageId}/${randomUUID()}-${fileName}`;

    const supabase = getSupabase();

    // Upload pro Storage
    const { error: uploadErr } = await supabase.storage
      .from('message-media')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadErr) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] storage upload falhou (${storagePath}):`,
        uploadErr.message,
      );
      return;
    }

    // Insere row em attachments
    const { error: insertErr } = await supabase.from('attachments').insert({
      org_id: this.ctx.orgId,
      message_id: messageId,
      conversation_id: conversationId,
      contact_id: contactId,
      media_type: parsed.kind,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: buffer.length,
      storage_path: storagePath,
      metadata: {
        ...(parsed.kind === 'image' && m.imageMessage?.caption
          ? { caption: m.imageMessage.caption }
          : {}),
        ...(parsed.kind === 'audio' && typeof m.audioMessage?.seconds === 'number'
          ? { duration_seconds: m.audioMessage.seconds }
          : {}),
      },
    });

    if (insertErr) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] insert attachment falhou:`,
        insertErr.message,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] attachment salvo: ${parsed.kind} ${(buffer.length / 1024).toFixed(1)}KB → ${storagePath}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // DB helpers
  // ──────────────────────────────────────────────────────────

  private async findOrCreateContact(
    waJid: string,
    phone: string | null,
    senderName: string | undefined,
  ): Promise<string | null> {
    const supabase = getSupabase();

    // 1) Match canônico: channel_profiles.whatsapp.wa_jid (JID completo).
    // PostgREST jsonb path: `channel_profiles->whatsapp->>wa_jid`
    const { data: byJid } = await supabase
      .from('contacts')
      .select('id, channel_profiles')
      .eq('org_id', this.ctx.orgId)
      .eq('channel_profiles->whatsapp->>wa_jid', waJid)
      .maybeSingle();

    if (byJid?.id) {
      await this.ensureWhatsappProfile(byJid.id as string, byJid.channel_profiles, waJid, senderName);
      return byJid.id as string;
    }

    // 2) Fallback legacy: contatos antigos só têm `phone` (sem wa_jid).
    // Só faz sentido se o JID for `@s.whatsapp.net` (digits = telefone real).
    if (phone) {
      const { data: byPhone } = await supabase
        .from('contacts')
        .select('id, channel_profiles')
        .eq('org_id', this.ctx.orgId)
        .eq('phone', phone)
        .maybeSingle();

      if (byPhone?.id) {
        // Backfill wa_jid no contato legacy pra próximas idas-e-vindas
        await this.ensureWhatsappProfile(byPhone.id as string, byPhone.channel_profiles, waJid, senderName);
        return byPhone.id as string;
      }
    }

    // 3) Cria novo contato com wa_jid populado.
    //
    // Como a msg chegou pelo socket Baileys, sabemos que o remetente
    // tem WhatsApp ativo — setamos whatsapp_verified=true direto sem
    // chamar onWhatsApp (evita ida de volta à rede). whatsapp_jid e
    // whatsapp_profile_name são populados nos campos top-level (além do
    // channel_profiles) pra que o auto-validate trigger e os badges
    // visuais reconheçam o estado verified.
    const channelProfiles: Record<string, Record<string, string>> = {
      whatsapp: {
        wa_jid: waJid,
        ...(senderName ? { profile_name: senderName } : {}),
      },
    };
    const nowIso = new Date().toISOString();

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        org_id: this.ctx.orgId,
        phone, // null pra @lid (não é telefone real); digits pra @s.whatsapp.net
        name: senderName ?? null,
        source: 'whatsapp',
        channel_profiles: channelProfiles,
        whatsapp_verified: true,
        whatsapp_verified_at: nowIso,
        whatsapp_jid: waJid,
        ...(senderName ? { whatsapp_profile_name: senderName } : {}),
      })
      .select('id')
      .single();

    if (error || !created) {
      // eslint-disable-next-line no-console
      console.warn(`[baileys ${this.ctx.channelId}] createContact falhou:`, error);
      return null;
    }
    return created.id as string;
  }

  /**
   * Garante que `channel_profiles.whatsapp.wa_jid` existe pro contato e
   * que os campos top-level whatsapp_* estejam populados (verified=true,
   * jid, profile_name). Usado em (a) match por JID que chegou sem
   * profile_name salvo, (b) backfill de contatos legacy que casaram
   * só por `phone`, e (c) re-confirmar verified=true caso ainda esteja
   * null/false (contato criado pelo CRM antes do canal estar pareado).
   */
  private async ensureWhatsappProfile(
    contactId: string,
    currentProfiles: unknown,
    waJid: string,
    senderName: string | undefined,
  ): Promise<void> {
    const profiles =
      (currentProfiles as Record<string, Record<string, unknown>> | null) ?? {};
    const wa = (profiles.whatsapp as Record<string, unknown> | undefined) ?? {};

    const merged = {
      ...profiles,
      whatsapp: {
        ...wa,
        wa_jid: waJid,
        ...(senderName ? { profile_name: senderName } : {}),
      },
    };

    const patch: Record<string, unknown> = {
      channel_profiles: merged,
      whatsapp_verified: true,
      whatsapp_verified_at: new Date().toISOString(),
      whatsapp_jid: waJid,
    };
    if (senderName) patch.whatsapp_profile_name = senderName;

    const { error } = await getSupabase()
      .from('contacts')
      .update(patch)
      .eq('id', contactId);

    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] ensureWhatsappProfile falhou:`,
        error.message,
      );
    }
  }

  private async findOrCreateConversation(contactId: string): Promise<string | null> {
    const supabase = getSupabase();

    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('org_id', this.ctx.orgId)
      .eq('contact_id', contactId)
      .eq('channel_id', this.ctx.channelId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) return existing.id as string;

    // Detector defensivo: se vai criar conv NOVA mas o contato JÁ tem
    // mensagens com conversation_id distinto, é sinal de conv "fantasma"
    // (deletada mas msgs órfãs). Loga avisando — útil pra rastrear bug
    // de cleanup acidental + ajuda no diagnóstico do greeting duplicado.
    const { data: orphans } = await supabase
      .from('messages')
      .select('conversation_id, created_at')
      .eq('org_id', this.ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(1);
    const lastOrphan = (orphans as { conversation_id?: string; created_at?: string }[] | null)?.[0];
    if (lastOrphan?.conversation_id) {
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] criando conv NOVA pra contact=${contactId} — última msg recente foi conv=${lastOrphan.conversation_id} (${lastOrphan.created_at})`,
      );
    }

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        org_id: this.ctx.orgId,
        contact_id: contactId,
        channel_id: this.ctx.channelId,
        channel_type: 'whatsapp_free',
        status: 'open',
      })
      .select('id')
      .single();

    if (error || !created) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] createConversation falhou:`,
        error,
      );
      return null;
    }
    return created.id as string;
  }

  private async markChannelActive(
    phone: string | null,
    displayName: string | undefined,
  ): Promise<void> {
    const supabase = getSupabase();
    const patch: Record<string, unknown> = {
      status: 'active',
      error_message: null,
      last_webhook_at: new Date().toISOString(),
    };
    if (phone) patch.phone_number = phone;
    if (displayName) patch.external_id = displayName;
    await supabase.from('channels').update(patch).eq('id', this.ctx.channelId);
  }

  private async markChannelDisconnected(reason: string): Promise<void> {
    const supabase = getSupabase();
    await supabase
      .from('channels')
      .update({ status: 'disconnected', error_message: reason })
      .eq('id', this.ctx.channelId);
  }

  private async markChannelError(reason: string): Promise<void> {
    const supabase = getSupabase();
    await supabase
      .from('channels')
      .update({ status: 'error', error_message: reason })
      .eq('id', this.ctx.channelId);
  }
}

// ──────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────

function defaultMimeFor(kind: ParsedContent['kind']): string {
  switch (kind) {
    case 'image': return 'image/jpeg';
    case 'audio': return 'audio/ogg';
    case 'video': return 'video/mp4';
    case 'document': return 'application/octet-stream';
    default: return 'application/octet-stream';
  }
}

function extFromMime(mime: string): string | null {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
    'video/webm': 'webm', 'application/pdf': 'pdf', 'text/plain': 'txt',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mime] ?? null;
}

function extractPhoneFromJid(jid: string): string | null {
  // JID format: '5571999999999@s.whatsapp.net' ou '5571999999999:21@s.whatsapp.net'
  const m = /^(\d+)/.exec(jid);
  return m?.[1] ?? null;
}

interface TextContent {
  kind: 'text';
  body: string;
}
interface ImageContent {
  kind: 'image';
  caption?: string;
  mime_type?: string;
}
interface AudioContent {
  kind: 'audio';
  mime_type?: string;
  duration_seconds?: number;
}
interface VideoContent {
  kind: 'video';
  caption?: string;
  mime_type?: string;
}
interface DocumentContent {
  kind: 'document';
  filename?: string;
  mime_type?: string;
}

type ParsedContent =
  | TextContent
  | ImageContent
  | AudioContent
  | VideoContent
  | DocumentContent;

// ──────────────────────────────────────────────────────────
// OUTBOUND content shapes — usadas pelo internal-server quando a API
// proxia o pedido de envio (text/image/audio/video/document).
// ──────────────────────────────────────────────────────────

export type OutboundContent =
  | { kind: 'text'; body: string }
  | { kind: 'image'; url: string; caption?: string }
  | { kind: 'audio'; url: string; mime_type?: string; ptt?: boolean }
  | { kind: 'video'; url: string; caption?: string }
  | { kind: 'document'; url: string; filename?: string; mime_type?: string };

function extractContent(m: WAMessageContent): ParsedContent | null {
  // Texto direto
  if (m.conversation) return { kind: 'text', body: m.conversation };
  if (m.extendedTextMessage?.text) {
    return { kind: 'text', body: m.extendedTextMessage.text };
  }
  // Mídia — no MVP só registramos kind/mime/caption. Download fica como TODO.
  if (m.imageMessage) {
    return {
      kind: 'image',
      ...(m.imageMessage.caption ? { caption: m.imageMessage.caption } : {}),
      ...(m.imageMessage.mimetype ? { mime_type: m.imageMessage.mimetype } : {}),
    };
  }
  if (m.audioMessage) {
    return {
      kind: 'audio',
      ...(m.audioMessage.mimetype ? { mime_type: m.audioMessage.mimetype } : {}),
      ...(typeof m.audioMessage.seconds === 'number'
        ? { duration_seconds: m.audioMessage.seconds }
        : {}),
    };
  }
  if (m.videoMessage) {
    return {
      kind: 'video',
      ...(m.videoMessage.caption ? { caption: m.videoMessage.caption } : {}),
      ...(m.videoMessage.mimetype ? { mime_type: m.videoMessage.mimetype } : {}),
    };
  }
  if (m.documentMessage) {
    return {
      kind: 'document',
      ...(m.documentMessage.fileName ? { filename: m.documentMessage.fileName } : {}),
      ...(m.documentMessage.mimetype ? { mime_type: m.documentMessage.mimetype } : {}),
    };
  }
  return null;
}

// ──────────────────────────────────────────────────────────
// Normalização de telefone BR
// ──────────────────────────────────────────────────────────

/**
 * Gera candidates de telefone BR pra consulta no onWhatsApp/sendMessage.
 *
 * Brasil tem dois formatos de celular válidos:
 *   - Moderno (pós-2012): 55 + DDD + 9 + 8 dígitos = 13 dígitos
 *   - Legacy (pré-2012, ainda existe): 55 + DDD + 8 dígitos = 12 dígitos
 *
 * O sock.onWhatsApp pode retornar JID em QUALQUER um dos dois formatos
 * mesmo quando ambas as contas existem — daí "5571994095636" pode
 * resolver pra "557194095636@s.whatsapp.net" (legacy de outra pessoa).
 *
 * Estratégia: tentar PRIMEIRO o formato moderno (com 9), DEPOIS o legacy
 * como fallback. Aplicado em checkNumber e em sendMessage.
 *
 * Aceita inputs:
 *   - 11 dígitos (DDD + 9 + 8)        → adiciona 55, mantém com 9
 *   - 10 dígitos (DDD + 8 sem 9)      → adiciona 55, gera versão com 9
 *   - 12 dígitos (55 + DDD + 8 sem 9) → mantém + gera versão com 9
 *   - 13 dígitos (55 + DDD + 9 + 8)   → mantém + gera versão sem 9 (fallback)
 *
 * Retorna array vazio se input não parecer BR (deixa caller usar input cru).
 */
function brPhoneCandidates(digits: string): string[] {
  if (!digits) return [];
  const candidates: string[] = [];

  // 11 dígitos: DDD (2) + 9 (1) + 8 dígitos = celular moderno sem DDI
  if (digits.length === 11 && digits[2] === '9') {
    candidates.push('55' + digits);
    // Fallback legacy: tira o 9
    candidates.push('55' + digits.slice(0, 2) + digits.slice(3));
    return candidates;
  }

  // 10 dígitos: DDD (2) + 8 dígitos = celular legacy ou fixo sem DDI
  if (digits.length === 10) {
    // Adiciona 9 (assumindo celular)
    candidates.push('55' + digits.slice(0, 2) + '9' + digits.slice(2));
    // Fallback sem 9 (fixo ou legacy)
    candidates.push('55' + digits);
    return candidates;
  }

  // 13 dígitos: 55 + DDD + 9 + 8 = celular moderno completo
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    candidates.push(digits);
    // Fallback legacy: 55 + DDD + 8
    candidates.push(digits.slice(0, 4) + digits.slice(5));
    return candidates;
  }

  // 12 dígitos: 55 + DDD + 8 = legacy completo
  if (digits.length === 12 && digits.startsWith('55')) {
    // Tenta primeiro com 9 (preferido moderno)
    candidates.push(digits.slice(0, 4) + '9' + digits.slice(4));
    candidates.push(digits);
    return candidates;
  }

  // Outros formatos (estrangeiros, números curtos, etc): mantém como veio
  candidates.push(digits);
  return candidates;
}
