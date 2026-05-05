'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { MobileTopBar } from '@/components/mobile-top-bar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Estado do drawer mobile. Sidebar auto-fecha em pathname change.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      {/* overflow-hidden no parent — cada page maneja seu próprio scroll
          (table na /contatos, listas/área-de-mensagens na /conversas). */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        <MobileTopBar onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
