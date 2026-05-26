import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente de ESCRITA no Sanity (CMS do blog), via HTTP API — sem adicionar
 * a dependência @sanity/client ao Active. Usado só na publicação: sobe a
 * imagem de capa como asset e cria o documento `post` (status=published).
 *
 * Config por env (Railway do Active):
 *   SANITY_PROJECT_ID   (ex: 9haxd4s5)
 *   SANITY_DATASET      (production)
 *   SANITY_WRITE_TOKEN  (token Editor — escrita)
 */
@Injectable()
export class SanityBlogClient {
  private readonly log = new Logger(SanityBlogClient.name);
  private readonly projectId = process.env.SANITY_PROJECT_ID ?? '';
  private readonly dataset = process.env.SANITY_DATASET ?? 'production';
  private readonly token = process.env.SANITY_WRITE_TOKEN ?? '';
  private readonly apiVersion = '2024-10-01';

  isConfigured(): boolean {
    return Boolean(this.projectId && this.token);
  }

  private base(path: string): string {
    return `https://${this.projectId}.api.sanity.io/v${this.apiVersion}/${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  /**
   * Sobe uma imagem (a partir de uma URL pública/signed) como asset no Sanity.
   * Retorna o _id do asset (ex: image-abc...-1200x630-png) pra referenciar.
   */
  async uploadImageFromUrl(imageUrl: string, mimeType = 'image/png'): Promise<string | null> {
    if (!this.isConfigured()) throw new Error('Sanity não configurado (SANITY_PROJECT_ID/SANITY_WRITE_TOKEN).');
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`download da imagem falhou: HTTP ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';

      const res = await fetch(this.base(`assets/images/${this.dataset}?filename=blog-cover.${ext}`), {
        method: 'POST',
        headers: this.headers({ 'Content-Type': mimeType }),
        body: buf,
      });
      const json = (await res.json().catch(() => ({}))) as {
        document?: { _id?: string };
        message?: string;
      };
      if (!res.ok || !json.document?._id) {
        throw new Error(`upload asset falhou: HTTP ${res.status} ${json.message ?? ''}`);
      }
      return json.document._id;
    } catch (e) {
      this.log.error(`uploadImageFromUrl: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Cria (ou substitui por _id) um documento. Retorna o _id criado.
   * Usa createOrReplace quando docId vem preenchido (re-publicar atualiza).
   */
  async createOrReplaceDocument(
    doc: Record<string, unknown> & { _type: string; _id?: string },
  ): Promise<string> {
    if (!this.isConfigured()) throw new Error('Sanity não configurado (SANITY_PROJECT_ID/SANITY_WRITE_TOKEN).');
    const mutation = doc._id ? { createOrReplace: doc } : { create: doc };
    const res = await fetch(this.base(`data/mutate/${this.dataset}?returnIds=true`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mutations: [mutation] }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      results?: Array<{ id: string }>;
      error?: { description?: string };
      message?: string;
    };
    if (!res.ok || !json.results?.[0]?.id) {
      throw new Error(`mutate Sanity falhou: HTTP ${res.status} ${json.error?.description ?? json.message ?? ''}`);
    }
    return json.results[0].id;
  }

  /** Despublica um post (status=draft no Sanity) — usado em "unpublish". */
  async setStatus(docId: string, status: string): Promise<void> {
    if (!this.isConfigured()) return;
    await fetch(this.base(`data/mutate/${this.dataset}`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mutations: [{ patch: { id: docId, set: { status } } }] }),
    });
  }
}
