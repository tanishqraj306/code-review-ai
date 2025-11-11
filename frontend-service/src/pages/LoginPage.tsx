import { Button } from "@/components/ui/button";

export function LoginPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col gap-4 p-8 border rounded-lg">
        <h1 className="text-3xl font-bold">AI Code Review</h1>
        <p className="text-muted-foreground">Login to continue</p>
        <Button asChild>
          <a href="http://localhost:3000/api/auth/github">Login with Github</a>
        </Button>
      </div>
    </div>
  );
}
