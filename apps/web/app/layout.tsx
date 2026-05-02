import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'e-Click Active',
  description: 'CRM de Inteligência Comercial Ativa',
};

// Aplica o tema ANTES do React hidratar — evita flash light→dark.
const themeInitScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    var root = document.documentElement;
    if (t === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            classNames: {
              toast:
                'group rounded-md border border-border bg-card text-card-foreground shadow-lg',
              description: 'text-muted-foreground',
              actionButton: 'bg-primary text-primary-foreground',
              cancelButton: 'bg-muted text-muted-foreground',
            },
          }}
        />
      </body>
    </html>
  );
}
