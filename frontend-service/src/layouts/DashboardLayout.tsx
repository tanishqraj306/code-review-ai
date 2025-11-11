// src/layouts/DashboardLayout.tsx
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";

export function DashboardLayout() {
  return (
    // We pass our layout classes to the SidebarProvider.
    // It will merge them into the main grid container.
    <SidebarProvider className="min-h-screen bg-background text-foreground">

      {/* Child 1: The Sidebar */}
      <AppSidebar />

      {/* Child 2: The Main Content Area */}
      {/* This <main> tag is the grid cell that will expand (the 1fr) */}
      <main className="w-full">
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <SidebarTrigger />
          </div>

          <Outlet /> {/* This renders our DashboardPage */}
        </div>
      </main>
    </SidebarProvider>
  );
}
