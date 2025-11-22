import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

export function LoginPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        Loading...
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col gap-4 p-8 border rounded-lg">
        <h1 className="text-3xl font-bold">AI Code Review</h1>
        <p className="text-muted-foreground">Login to continue</p>
        <Button asChild>
          <a href="/api/auth/github">Login with GitHub</a>
        </Button>
      </div>
    </div>
  );
}
