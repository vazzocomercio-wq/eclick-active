import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * @Global porque o AuthService é usado tanto pelo AuthGuard (HTTP) quanto
 * pelo EventsGateway (WebSocket) — evita import explícito em cada módulo
 * que precisa só do guard.
 */
@Global()
@Module({
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
