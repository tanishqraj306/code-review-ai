// src/components/PrChart.tsx
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

// (chartData remains the same)
const chartData = [
  { date: "Jun 24", prs: 20 },
  { date: "Jun 25", prs: 30 },
  { date: "Jun 26", prs: 25 },
  { date: "Jun 27", prs: 40 },
  { date: "Jun 28", prs: 35 },
  { date: "Jun 29", prs: 45 },
  { date: "Jun 30", prs: 50 },
]

// --- THIS IS THE FIX ---
// We must provide a direct color value,
// not a CSS variable inside another CSS variable.
const chartConfig = {
  prs: {
    label: "PRs Reviewed",
    color: "hsl(217.2 91.2% 59.8%)", // A bright, standard blue
  },
} satisfies ChartConfig
// --- END FIX ---

export function PrChart() {
  return (
    <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
      <LineChart
        accessibilityLayer
        data={chartData}
        margin={{
          top: 10,
          right: 10,
          left: 10,
          bottom: 10,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="#888888"
          fontSize={12}
        />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}`}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="prs"
          type="monotone"
          stroke="var(--color-prs)" // This will now work!
          strokeWidth={2}
          dot={true}
        />
      </LineChart>
    </ChartContainer>
  )
}
