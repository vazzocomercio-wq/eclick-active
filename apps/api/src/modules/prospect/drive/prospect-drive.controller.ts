import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { DriveClient } from './drive.client';

/**
 * Endpoints administrativos do CNPJ Data Lake (Drive integration).
 *
 * Autenticados — só pra validar setup do worker do Lake. Vai virar
 * `/dashboard/admin/prospect-lake` na UI eventualmente (DL.8 inclui).
 */
@UseGuards(AuthGuard)
@Controller('prospect/admin/drive')
export class ProspectDriveController {
  constructor(private readonly drive: DriveClient) {}

  /**
   * Verifica:
   *  - GOOGLE_SA_KEY setada e parsável (JSON da SA)
   *  - DRIVE_LAKE_FOLDER_ID setada
   *  - Auth via JWT funciona (token gerado, ~55min cache)
   *  - Folder acessível (SA tem permissão Editor na pasta)
   *  - Lista atual de arquivos no lake
   */
  @Get('health')
  health() {
    return this.drive.healthCheck();
  }

  /** Lista arquivos da pasta lake (raiz). */
  @Get('files')
  list() {
    return this.drive.list();
  }

  /** Debug: lista TUDO que a SA vê, em qualquer pasta. */
  @Get('debug-all')
  debugAll() {
    return this.drive.listAllVisible();
  }
}
