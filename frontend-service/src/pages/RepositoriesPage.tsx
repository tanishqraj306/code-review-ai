import { AddRepositoryForm } from "@/components/AddRepositoryForm";
import { RepositoriesTable, type Repository } from "@/components/RepositoriesTable";
import { useState, useEffect, useCallback } from "react";

export function RepositoriesPage() {
  const [data, setData] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRepositories = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/repositories");
      const repos = await response.json();
      setData(repos);
    } catch (error) {
      console.error("Failed to fetch repositories:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Repositories</h1>
      </div>

      <div className="mb-8 p-6 border rounded-lg">
        <h2 className="text-lg font-semibold mb-4">Add a New Repository</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Paste the full URL of the GitHub repository you want to monitor.
        </p>
        {/* Pass the refresh function down to the form */}
        <AddRepositoryForm onRepoAdded={fetchRepositories} />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Monitored Repositories</h2>
        {/* Pass the data and loading state down to the table */}
        <RepositoriesTable data={data} isLoading={isLoading} />
      </div>
    </div>
  );
}
