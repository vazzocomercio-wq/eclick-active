import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Termos de Serviço — e-Click',
  description:
    'Termos e condições de uso da plataforma e-Click, incluindo integrações com redes sociais e marketplaces.',
};

const UPDATED = '25 de maio de 2026';

export default function TermosPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-14">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Termos de Serviço
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vazzo Comércio Ltda — Plataforma e-Click · Última atualização:{' '}
          {UPDATED}
        </p>
      </header>

      <div className="space-y-7 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            1. Aceitação
          </h2>
          <p>
            Ao acessar ou usar a plataforma e-Click, operada pela Vazzo Comércio
            Ltda, você concorda com estes Termos de Serviço. Caso não concorde,
            não utilize o serviço.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            2. Descrição do serviço
          </h2>
          <p>
            A e-Click oferece ferramentas de gestão de e-commerce, criação e
            publicação de conteúdo para redes sociais, automação de campanhas e
            atendimento. Algumas funcionalidades dependem de integrações com
            plataformas de terceiros que você opta por conectar.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            3. Conta e responsabilidades
          </h2>
          <p>
            Você é responsável por manter a confidencialidade das suas
            credenciais e por todas as atividades realizadas na sua conta. Os
            dados e o conteúdo que você fornece devem ser verídicos e não violar
            direitos de terceiros.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            4. Integrações de terceiros
          </h2>
          <p>
            Ao conectar contas de plataformas como TikTok, Instagram/Meta e
            Mercado Livre, você autoriza a e-Click a executar, em seu nome,
            apenas as ações que você solicita (por exemplo, publicar conteúdo que
            você cria e aprova). O uso dessas plataformas também é regido pelos
            termos e políticas próprios de cada uma, e você é responsável por
            cumpri-los.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            5. Uso aceitável
          </h2>
          <p>
            É proibido usar a e-Click para fins ilícitos, para publicar conteúdo
            que infrinja direitos de terceiros ou que viole as regras das
            plataformas conectadas, ou para tentar comprometer a segurança do
            serviço.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            6. Propriedade intelectual
          </h2>
          <p>
            O conteúdo que você cria permanece seu. A plataforma, seu software e
            suas marcas permanecem de titularidade da Vazzo Comércio Ltda e de
            seus licenciadores.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            7. Isenção e limitação de responsabilidade
          </h2>
          <p>
            O serviço é fornecido no estado em que se encontra. Na máxima
            extensão permitida em lei, a e-Click não se responsabiliza por danos
            indiretos decorrentes do uso ou da indisponibilidade do serviço ou
            das plataformas de terceiros conectadas.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            8. Rescisão
          </h2>
          <p>
            Você pode encerrar o uso e desconectar as integrações a qualquer
            momento. Podemos suspender ou encerrar o acesso em caso de violação
            destes Termos.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            9. Lei aplicável e alterações
          </h2>
          <p>
            Estes Termos são regidos pelas leis do Brasil. Podemos atualizá-los
            periodicamente; o uso continuado após mudanças significa aceitação da
            versão vigente. Dúvidas podem ser enviadas para{' '}
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
