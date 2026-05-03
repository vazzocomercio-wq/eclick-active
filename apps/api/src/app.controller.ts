import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'eclick-active-api',
      ts: new Date().toISOString(),
      // Railway expõe RAILWAY_GIT_COMMIT_SHA automaticamente. Útil pra
      // confirmar qual commit está rodando depois de um push.
      commit: (
        process.env.RAILWAY_GIT_COMMIT_SHA ??
        process.env.GIT_COMMIT_SHA ??
        'unknown'
      ).slice(0, 7),
      node_env: process.env.NODE_ENV ?? 'unknown',
    };
  }
}
