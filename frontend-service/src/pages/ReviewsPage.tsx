import { useEffect, useState } from "react";
import { columns, type Review } from "@/components/reviews-table/columns";
import { DataTable } from "@/components/reviews-table/data-table";

export function ReviewsPage() {
  const [data, setData] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/reviews");
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error("Failed to fetch reviews:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reviews History</h2>
          <p className="text-muted-foreground">
            A complete history of all code analyses performed by the bot.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div>Loading history...</div>
      ) : (
        <DataTable data={data} columns={columns} />
      )}
    </div>
  );
}
