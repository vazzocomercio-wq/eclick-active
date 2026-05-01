import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'eclick-active-api', ts: new Date().toISOString() };
  }
}
