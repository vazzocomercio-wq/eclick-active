import { Injectable } from '@nestjs/common';

interface TemplateArgs {
  /** Conteúdo do email (texto plano ou HTML simples). */
  content: string;
  orgName?: string | null;
  agentName?: string | null;
  agentEmail?: string | null;
  /** Se true, trata content como HTML; se false (default), escapa entidades + quebra linhas. */
  isHtml?: boolean;
}

/**
 * Envolve o conteúdo em template HTML responsivo com inline CSS (single
 * file pra evitar problemas de email clients que strippam <style>).
 */
@Injectable()
export class EmailTemplateService {
  wrap(args: TemplateArgs): string {
    const escaped = args.isHtml ? args.content : this.textToHtml(args.content);
    const orgName = this.escape(args.orgName ?? '');
    const agentName = this.escape(args.agentName ?? '');
    const agentEmail = this.escape(args.agentEmail ?? '');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mensagem</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f4f4f7;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);overflow:hidden;">
        ${
          orgName
            ? `<tr>
          <td style="padding:20px 24px 12px 24px;border-bottom:1px solid #e5e7eb;">
            <strong style="font-size:14px;color:#111827;">${orgName}</strong>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="padding:24px;font-size:15px;line-height:1.6;color:#1f2937;">
            ${escaped}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;background-color:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
            ${
              agentName
                ? `<div style="margin-bottom:4px;"><strong style="color:#374151;">${agentName}</strong>${
                    agentEmail ? ` · <a href="mailto:${agentEmail}" style="color:#0891b2;text-decoration:none;">${agentEmail}</a>` : ''
                  }</div>`
                : ''
            }
            ${orgName ? `<div>${orgName}</div>` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  }

  private textToHtml(text: string): string {
    return this.escape(text).replace(/\n/g, '<br>');
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
