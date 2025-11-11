// src/components/PrChart.tsx
import { Area, AreaChart, XAxis, YAxis, CartesianGrid } from "recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Card, // <-- Import Card
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// (chartData and chartConfig remain the same)
const chartData = [
  { date: "Jun 24", prs: 20 },
  { date: "Jun 25", prs: 30 },
  { date: "Jun 26", prs: 25 },
  { date: "Jun 27", prs: 40 },
  { date: "Jun 28", prs: 35 },
  { date: "Jun 29", prs: 45 },
  { date: "Jun 30", prs: 50 },
]

const chartConfig = {
  prs: {
    label: "PRs Reviewed",
    color: "hsl(217.2 91.2% 59.8%)",
  },
} satisfies ChartConfig

export function PrChart() {
  return (
    // 1. We use a regular <Card> as the root "box"
    <Card>
      {/* 2. We put the header in the CardHeader */}
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>PRs Reviewed</CardTitle>
        </div>
        <Tabs defaultValue="7days">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="3months">Last 3 months</TabsTrigger>
            <TabsTrigger value="30days">Last 30 days</TabsTrigger>
            <TabsTrigger value="7days">Last 7 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      {/* 3. We put the ChartContainer *inside* the CardContent */}
      <CardContent className="px-2 pt-4">
        {/* 4. We give the ChartContainer the height */}
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{
              top: 0,
              right: 10,
              left: 10,
              bottom: 0,
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
            <defs>
              <linearGradient id="colorPrs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-prs)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-prs)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="prs"
              stroke="var(--color-prs)"
              strokeWidth={2}
              fill="url(#colorPrs)"
              dot={true}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
