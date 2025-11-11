import { AddRepositoryForm } from "../components/AddRepositoryForm";
import { RepositoriesTable } from "../components/RepositoriesTable";

export function RepositoriesPage() {
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Repositories</h1>
      </div>

      <div className="mb-8 p-6 border rounded-lg">
        <h2 className="text-lg font-semibold mb-4">Add a New Repository</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Paste the full URL of the Github repository you want to monitor.
        </p>
        <AddRepositoryForm />
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Monitored Repositories</h2>
        <RepositoriesTable />
      </div>
    </div>
  );
}
