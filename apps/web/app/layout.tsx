import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'e-Click Active',
  description: 'CRM de Inteligência Comercial Ativa',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
