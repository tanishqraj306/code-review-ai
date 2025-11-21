import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, AlertCircle, CheckCircle2 } from "lucide-react";

interface AddRepositoryFormProps {
  onRepoAdded: () => void;
}

export function AddRepositoryForm({ onRepoAdded }: AddRepositoryFormProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to add repository");
      }

      setMessage(`Successfully added: ${result.data.full_name}`);
      setRepoUrl("");
      onRepoAdded();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "An unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
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
      </form>
      {message && (
        <div className={`flex items-center text-sm ${isError ? "text-red-500" : "text-green-500"}`}>
          {isError ? <AlertCircle className="h-4 w-4 mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          {message}
        </div>
      )}
    </div>
  )
}
