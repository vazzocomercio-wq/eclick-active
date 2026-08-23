import { BadRequestException } from '@nestjs/common';

/** U+FFFD REPLACEMENT CHARACTER — o que sobra quando bytes que não eram
 *  UTF-8 válido foram decodificados como UTF-8. */
const REPLACEMENT = '�';

/**
 * Recusa texto que chegou com a acentuação já destruída.
 *
 * Contexto: em 03/06/2026 dois conteúdos foram gravados como
 * `"a import�ncia de aparecer nas respostas das IAs"` e
 * `"SEO est� morto? N�o."`. O caption, gerado pela IA no
 * servidor, saiu perfeito — só o `theme`, que vem no corpo da requisição,
 * estava quebrado. Ou seja: o cliente mandou bytes que não eram UTF-8
 * (típico de terminal Windows em cp1252) e o parser do Express os
 * substituiu por U+FFFD.
 *
 * O U+FFFD é uma via de mão única: os bytes originais já se perderam, não
 * há como recuperar o "â". Por isso a defesa é na entrada — sem ela, o
 * texto corrompido segue pro banco e daí pra um post público no
 * Instagram do cliente.
 *
 * @param valor  texto a validar (undefined/null passam — campo opcional)
 * @param campo  nome do campo, pra mensagem de erro
 */
export function assertTextoLimpo(
  valor: string | null | undefined,
  campo: string,
): void {
  if (!valor) return;
  if (!valor.includes(REPLACEMENT)) return;

  const trecho = valor.slice(0, 60);
  throw new BadRequestException(
    `O campo "${campo}" chegou com caracteres corrompidos (${trecho}...). ` +
      'Isso acontece quando o texto é enviado fora de UTF-8. ' +
      'Copie e cole o texto novamente, ou confira a codificação de quem enviou.',
  );
}

/** True se o texto contém caractere de substituição. Pra quem quer decidir
 *  o que fazer em vez de lançar (ex.: filtrar uma lista importada). */
export function temTextoCorrompido(valor: string | null | undefined): boolean {
  return !!valor && valor.includes(REPLACEMENT);
}
