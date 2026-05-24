import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Lançada quando a org está em modo BYOK ('own') e NÃO tem chave própria de
 * IA configurada. HTTP 402 (Payment Required) com body estruturado que o
 * frontend detecta pra abrir o modal "Conecte sua chave de IA".
 *
 * Espelha o shape usado no SaaS (eclick-backend) pra o interceptor do front
 * funcionar igual nos dois sistemas:
 *   { statusCode: 402, error: 'ai_key_required', provider, message }
 */
export class AiKeyRequiredException extends HttpException {
  constructor(provider: string) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'ai_key_required',
        provider,
        message: `Conecte sua chave de ${provider} em Configurações > IA pra usar este recurso.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
