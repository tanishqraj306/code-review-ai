import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";

export function AddRepositoryForm() {
  const [repoUrl, setRepoUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      if (!response.ok) {
        throw new Error("Failed to add repository");
      }

      const result = await response.json();
      setMessage(`Successfully added: ${result.data.full_name}`);
      setRepoUrl("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "An unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-lg items-center space-x-2">
      <Input
        type="url"
        placeholder="https://github.com/user/repo"
        value={repoUrl}
        onChange={(e) => setRepoUrl(e.target.value)}
        disabled={isLoading}
      />
      <Button type="submit" disabled={isLoading}>
        <Plus className="h-4 w-4 mr-2" />
        Add Repository
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </form>
  )
}
