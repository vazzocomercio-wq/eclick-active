/**
 * Layout das rotas de autenticação. Sem sidebar, fundo background fullscreen.
 * O dark mode é aplicado pelo script do RootLayout.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
