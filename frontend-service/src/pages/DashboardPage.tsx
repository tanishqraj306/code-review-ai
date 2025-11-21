import { StatCard } from "@/components/StatCard"
import { PrChart } from "@/components/PrChart"
import { RecentReviewsTable } from "@/components/RecentReviewsTable" // <-- Import Table
import { Button } from "@/components/ui/button" // <-- Import Button
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs" // <-- Import Tabs
import { ListFilter } from "lucide-react"
import { useEffect, useState } from "react"

export function DashboardPage() {
  const [stats, setStats] = useState({
    totalRepos: 0,
    totalReviews: 0,
    totalIssues: 0,
    linterErrors: 0
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const statsRes = await fetch('/api/dashboard/stats');
        const statsData = await statsRes.json();
        setStats(statsData);

        const reviewsRes = await fetch('/api/dashboard/reviews');
        const reviewsData = await reviewsRes.json();
        setReviews(reviewsData);
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const statCards = [
    {
      title: "Total Repositories",
      value: stats.totalRepos.toString(),
      percentage: "",
      description: "Active projects",
    },
    {
      title: "PRs Reviewed",
      value: stats.totalReviews.toString(),
      percentage: "",
      description: "Total analyses run",
    },
    {
      title: "Logic Issues Found",
      value: stats.totalIssues.toString(),
      percentage: "",
      description: "via AI & Linters",
    },
    {
      title: "Linter Errors",
      value: stats.linterErrors.toString(),
      percentage: "",
      description: "Automatic fixed available",
    },
  ];

  return (
    <div className="w-full">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 my-6">
        {statCards.map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={isLoading ? "-" : stat.value}
            percentage={stat.percentage}
            description={stat.description}
          />
        ))}
      </div>

      <div className="mb-8">
        <PrChart />
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <Tabs defaultValue="recent" className="w-full">
            <TabsList>
              <TabsTrigger value="recent">Recent Reviews</TabsTrigger>
              <TabsTrigger value="all">All History</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2">
            <Button variant="outline">
              <ListFilter className="h-4 w-4 mr-2" />
              Filter
            </Button>
          </div>
        </div>
        <RecentReviewsTable data={reviews} isLoading={isLoading} />
      </div>
    </div>
  )
}
