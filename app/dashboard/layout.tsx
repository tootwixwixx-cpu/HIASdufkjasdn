// app/dashboard/layout.tsx
import React from "react";
import DashboardNav from "@/components/DashboardNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg selection:bg-accent/30 selection:text-fg md:flex-row">
      <DashboardNav />

      <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto max-w-[1600px] p-3 sm:p-4 lg:p-6">{children}</div>
      </main>
    </div>
  );
}
