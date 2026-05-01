import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* overflow-hidden no parent — cada page maneja seu próprio scroll
          (table na /contatos, listas/área-de-mensagens na /conversas). */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        {children}
      </main>
    </div>
  );
}
