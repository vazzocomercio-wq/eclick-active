import { Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

/**
 * Módulo global de lock distribuído. Depende de SupabaseModule (também @Global).
 */
@Global()
@Module({
  providers: [LockService],
  exports: [LockService],
})
export class LockModule {}
