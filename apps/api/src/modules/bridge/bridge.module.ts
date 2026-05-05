import { Module } from '@nestjs/common';
import { BridgeService } from './bridge.service';
import { BridgeController } from './bridge.controller';
import { AuthModule } from '../../common/auth/auth.module';

/**
 * BridgeModule — acesso cross-schema (public SaaS → active CRM).
 *
 * `SupabaseModule` é `@Global()` (provê `SupabaseService` em toda a árvore),
 * então não precisa importar aqui. `AuthModule` é necessário pelo
 * `AuthGuard` usado no controller.
 */
@Module({
  imports: [AuthModule],
  controllers: [BridgeController],
  providers: [BridgeService],
  exports: [BridgeService],
})
export class BridgeModule {}
