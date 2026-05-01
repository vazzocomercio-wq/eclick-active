import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-8 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-5xl font-bold tracking-tight">
          e-Click <span className="text-primary">Active</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          CRM de Inteligência Comercial Ativa, AI-first.
        </p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Status do scaffolding</CardTitle>
          <CardDescription>Tudo pronto pra começar a construir.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">api</span>
            <span className="text-sm text-accent">http://localhost:3001</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">web</span>
            <span className="text-sm text-accent">http://localhost:3000</span>
          </div>
          <Button className="mt-2">Começar</Button>
        </CardContent>
      </Card>
    </main>
  );
}
