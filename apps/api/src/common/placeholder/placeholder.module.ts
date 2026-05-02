import { Global, Module } from '@nestjs/common';
import { PlaceholderService } from './placeholder.service';

/**
 * Placeholder service global — usado por automations, message templates,
 * emails (futuro). Marcado @Global pra evitar import explícito em cada
 * feature module que precisar.
 */
@Global()
@Module({
  providers: [PlaceholderService],
  exports: [PlaceholderService],
})
export class PlaceholderModule {}
