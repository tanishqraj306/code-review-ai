// src/pages/DashboardPage.tsx
import { StatCard } from "@/components/StatCard";
import { PrChart } from "@/components/PrChart"; // <-- Import the chart

// (Mock data for stats remains the same)
const stats = [
  {
    title: "Total Repositories",
    value: "12",
    percentage: "+2",
    description: "Added this month",
  },
  {
    title: "PRs Reviewed (30d)",
    value: "1,234",
    percentage: "+12.1%",
    description: "Total reviews performed",
  },
  {
    title: "Logic Issues Found",
    value: "452",
    percentage: "+8.3%",
    description: "via AI analysis",
  },
  {
    title: "Linter Errors Fixed",
    value: "4,571",
    percentage: "+22.0%",
    description: "via static analysis",
  },
];

export function DashboardPage() {
  return (
    <div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      {/* Grid for the statistic cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 my-6">
        {stats.map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            percentage={stat.percentage}
            description={stat.description}
          />
        ))}
      </div>

      {/* Area for the chart */}
      <div>
        <PrChart />
      </div>

      {/* The data table will go here next */}
    </div>
  );
}
