import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { AuthModule } from '../../common/auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ProspectController } from './prospect.controller';
import { ProspectPublicController } from './prospect.public.controller';
import { ProspectDriveController } from './drive/prospect-drive.controller';
import { ProspectService } from './prospect.service';
import { BrasilApiCollector } from './collectors/brasilapi.collector';
import { GooglePlacesCollector } from './collectors/google-places.collector';
import { SaasBridgeCollector } from './collectors/saas-bridge.collector';
import { EntityResolverService } from './entity-resolver.service';
import { ProspectScorerService } from './prospect-scorer.service';
import { DriveClient } from './drive/drive.client';
import { ReceitaDumpService } from './lake/receita-dump.service';
import { ProspectLakeController } from './lake/prospect-lake.controller';

/**
 * e-Click Prospect — Lead Intelligence Engine.
 *
 * Schema: `prospect.*` (separado de `active.*` p/ isolar raw/PII).
 * Pipeline: descobre (Active) → enriquece (bridge SaaS p/ camadas pagas) →
 * pontua → compliance gate → promove p/ `active.contacts` + card no Funil.
 *
 * Decisão de produto (2026-05-28):
 *  • PJ: coleta fria permitida (legítimo interesse + dado público CNPJ).
 *  • PF: APENAS opt-in/inbound. Coleta fria proibida.
 */
@Module({
  imports: [SupabaseModule, AuthModule, KnowledgeModule],
  controllers: [
    ProspectController,
    ProspectPublicController,
    ProspectDriveController,
    ProspectLakeController,
  ],
  providers: [
    ProspectService,
    BrasilApiCollector,
    GooglePlacesCollector,
    SaasBridgeCollector,
    EntityResolverService,
    ProspectScorerService,
    DriveClient,
    ReceitaDumpService,
  ],
  exports: [ProspectService],
})
export class ProspectModule {}
