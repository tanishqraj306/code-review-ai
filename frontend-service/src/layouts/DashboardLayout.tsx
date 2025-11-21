import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";

export function DashboardLayout() {
  return (
    <SidebarProvider className="min-h-screen bg-background text-foreground">

      <AppSidebar />

      <main className="w-full">
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <SidebarTrigger />
          </div>

          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
