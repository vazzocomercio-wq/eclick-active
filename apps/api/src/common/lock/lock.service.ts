import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Lock distribuído lease-based sobre `active.app_locks` (migration 108).
 * Impede execução dupla de jobs quando há 2+ instâncias do processo.
 *
 * Política fail-open: se a infra de lock falhar (RPC ausente, DB fora),
 * `acquire` retorna true — melhor rodar o job (arriscando duplicação rara e
 * em geral idempotente) do que travar a funcionalidade por completo.
 */
@Injectable()
export class LockService {
  private readonly log = new Logger(LockService.name);

  /** Identidade única deste processo — quem "segura" o lock. */
  readonly holder = `${process.env.RAILWAY_REPLICA_ID ?? hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(private readonly supabase: SupabaseService) {}

  /** Tenta adquirir/renovar o lock. Fail-open: true em erro de infra. */
  async acquire(name: string, ttlSeconds: number): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'try_acquire_lock',
        { p_name: name, p_holder: this.holder, p_ttl_seconds: ttlSeconds },
      );
      if (error) {
        this.log.warn(`acquire(${name}) falhou, fail-open: ${error.message}`);
        return true;
      }
      return data === true;
    } catch (err) {
      this.log.warn(`acquire(${name}) erro, fail-open: ${String(err)}`);
      return true;
    }
  }

  async release(name: string): Promise<void> {
    try {
      await this.supabase.adminClient.rpc('release_lock', {
        p_name: name,
        p_holder: this.holder,
      });
    } catch (err) {
      this.log.warn(`release(${name}) erro: ${String(err)}`);
    }
  }

  /**
   * Roda `fn` sob o lock; libera ao final. Retorna null (sem rodar) se outra
   * instância já detém o lock.
   */
  async withLock<T>(
    name: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (!(await this.acquire(name, ttlSeconds))) return null;
    try {
      return await fn();
    } finally {
      await this.release(name);
    }
  }
}
