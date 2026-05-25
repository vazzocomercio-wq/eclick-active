import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidade — e-Click',
  description:
    'Como a e-Click coleta, usa, armazena e protege dados pessoais, em conformidade com a LGPD.',
};

const UPDATED = '25 de maio de 2026';

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-14">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Política de Privacidade
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vazzo Comércio Ltda — Plataforma e-Click · Última atualização:{' '}
          {UPDATED}
        </p>
      </header>

      <div className="space-y-7 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            1. Quem somos
          </h2>
          <p>
            A e-Click é uma plataforma de gestão de e-commerce e de conteúdo de
            redes sociais operada pela Vazzo Comércio Ltda. Esta política
            descreve como tratamos dados pessoais de clientes, lojistas,
            parceiros e usuários finais, em conformidade com a Lei Geral de
            Proteção de Dados (LGPD, Lei 13.709/2018).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            2. Dados que coletamos
          </h2>
          <p>
            Coletamos apenas o necessário para operar o serviço: dados de
            cadastro e de conta (nome, e-mail, organização), dados de uso da
            plataforma, conteúdo que você cria (textos, imagens e vídeos de
            produtos) e tokens de autorização das integrações que você conecta.
            Não coletamos dados financeiros sensíveis nem credenciais bancárias.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            3. Integrações com redes sociais e marketplaces
          </h2>
          <p>
            Quando você conecta uma conta de rede social ou marketplace
            (incluindo TikTok, Instagram/Meta, Mercado Livre e outros), a e-Click
            utiliza as APIs oficiais dessas plataformas exclusivamente para as
            finalidades que você autoriza.
          </p>
          <p className="mt-2">
            No caso do <strong>TikTok</strong>, usamos o Login Kit (escopo{' '}
            <code className="rounded bg-muted px-1">user.info.basic</code>) para
            identificar a conta que você conecta, e a Content Posting API
            (escopos{' '}
            <code className="rounded bg-muted px-1">video.publish</code> e{' '}
            <code className="rounded bg-muted px-1">video.upload</code>) apenas
            para publicar, na sua própria conta, os vídeos que você cria e aprova
            dentro da e-Click. Não lemos nem coletamos dados de outros usuários
            do TikTok. Os tokens de acesso ficam armazenados de forma
            criptografada e você pode revogar a conexão a qualquer momento, tanto
            nas configurações da e-Click quanto nas configurações da sua conta
            TikTok.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            4. Como usamos os dados
          </h2>
          <p>
            Tratamos dados pessoais para operar a plataforma, executar as ações
            que você solicita (gerar e publicar conteúdo, gerenciar pedidos,
            atender clientes), cumprir obrigações legais e melhorar o serviço,
            sempre com base nas hipóteses legais previstas na LGPD (execução de
            contrato, consentimento, legítimo interesse e obrigação legal).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            5. Compartilhamento e sub-processadores
          </h2>
          <p>
            Não vendemos dados pessoais. Compartilhamos dados apenas com
            provedores de infraestrutura e serviços necessários à operação
            (por exemplo, hospedagem em nuvem e provedores de modelos de IA),
            todos vinculados a obrigações equivalentes de proteção de dados, e
            com as plataformas que você conecta, na medida da ação autorizada.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            6. Armazenamento, segurança e residência
          </h2>
          <p>
            Os dados são armazenados e processados no Brasil (região AWS São
            Paulo / sa-east-1). Aplicamos criptografia em trânsito (TLS 1.2+) e
            em repouso, isolamento por organização (Row-Level Security),
            criptografia AES-256-GCM para segredos e tokens, controle de acesso
            por menor privilégio e monitoramento contínuo.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            7. Retenção e exclusão
          </h2>
          <p>
            Mantemos os dados apenas pelo tempo necessário às finalidades
            descritas ou exigido por lei. Mediante solicitação válida, ou ao fim
            da relação contratual, os dados sob nossa guarda são excluídos ou
            anonimizados.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            8. Seus direitos (LGPD)
          </h2>
          <p>
            Você pode solicitar acesso, correção, anonimização, portabilidade e
            exclusão dos seus dados pessoais, além de informações sobre
            compartilhamento. Para exercer esses direitos, use o contato abaixo.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            9. Cookies
          </h2>
          <p>
            Utilizamos apenas cookies necessários à autenticação e ao
            funcionamento da plataforma. Não usamos cookies para perfilar
            visitantes sem base legal.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            10. Alterações e contato
          </h2>
          <p>
            Esta política pode ser atualizada para refletir mudanças na
            legislação ou no serviço. Dúvidas e solicitações relacionadas a
            privacidade podem ser enviadas para{' '}
            <a
              className="text-primary underline"
              href="mailto:vazzocomercio@gmail.com"
            >
              vazzocomercio@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
