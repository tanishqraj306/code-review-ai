// src/pages/LoginPage.tsx
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext"; // <-- Import the auth hook
import { Navigate } from "react-router-dom"; // <-- Import Navigate

export function LoginPage() {
  const { user, isLoading } = useAuth(); // <-- Get auth state

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        Loading...
      </div>
    );
  }

  // --- THIS IS THE FIX ---
  // If the user is already logged in, redirect to the dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  // --- END FIX ---

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col gap-4 p-8 border rounded-lg">
        <h1 className="text-3xl font-bold">AI Code Review</h1>
        <p className="text-muted-foreground">Login to continue</p>
        <Button asChild>
          <a href="http://localhost:3000/api/auth/github">Login with GitHub</a>
        </Button>
      </div>
    </div>
  );
}
