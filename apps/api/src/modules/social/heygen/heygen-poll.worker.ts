import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HeyGenService } from './heygen.service';

const TICK_INTERVAL_MS = 60 * 1000; // 1min — geração HeyGen leva minutos
const STARTUP_DELAY_MS = 90 * 1000; // 1m30 — deixa os outros workers subirem

/**
 * Worker de polling dos jobs HeyGen em andamento. Garante que o vídeo seja
 * finalizado (status→URL) mesmo se ninguém estiver com a tela aberta. A leitura
 * de 1 job na API também atualiza sob demanda; o worker é a rede de segurança.
 *
 * Mesmo padrão dos demais workers (setInterval + startup delay). Best-effort:
 * sem HEYGEN_API_KEY o tick é no-op. Disable via HEYGEN_POLL_DISABLED=true
 * (setar nos processos extra que rodem o AppModule pra não duplicar polling).
 */
@Injectable()
export class HeyGenPollWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(HeyGenPollWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly heygen: HeyGenService) {}

  onModuleInit(): void {
    if (process.env.HEYGEN_POLL_DISABLED === 'true') {
      this.log.warn('HEYGEN_POLL_DISABLED=true — worker desligado');
      return;
    }
    if (!this.heygen.isConfigured()) {
      this.log.log('HEYGEN_API_KEY ausente — worker ocioso (será no-op até configurar)');
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    if (!this.heygen.isConfigured()) return;
    try {
      const r = await this.heygen.pollOpenJobs();
      if (r.checked > 0) {
        this.log.log(`tick: ${r.checked} jobs em andamento, ${r.completed} concluído(s)`);
      }
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
    }
  }
}
