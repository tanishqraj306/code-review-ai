import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ArrowUp } from "lucide-react"

interface StatCardProps {
  title: string;
  value: string;
  percentage: string;
  description: string;
}

export function StatCard({ title, value, percentage, description }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="flex items-center text-xs text-green-500">
          <ArrowUp className="h-4 w-4 mr-1" />
          {percentage}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}
