"use client"

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Badge } from "@/components/ui/badge"
import { useNavigate } from "react-router-dom"

export type Review = {
  _id: string
  repo_name: string
  pr_number: number
  issues_found: number
  language: string
  analyzed_at: string
}

export const columns: ColumnDef<Review>[] = [
  {
    header: "Repository / PR",
    accessorFn: (row) => `${row.repo_name} #${row.pr_number}`,
  },
  {
    accessorKey: "language",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize">
        {row.getValue("language")}
      </Badge>
    ),
  },
  {
    accessorKey: "issues_found",
    header: "Issues Found",
    cell: ({ row }) => {
      const issues = row.getValue("issues_found") as number;
      return (
        <span className={issues > 0 ? "text-red-500 font-medium" : "text-green-500"}>
          {issues} issues
        </span>
      )
    },
  },
  {
    accessorKey: "analyzed_at",
    header: "Date",
    cell: ({ row }) => new Date(row.getValue("analyzed_at")).toLocaleDateString(),
  },
]

interface RecentReviewsTableProps {
  data: Review[];
  isLoading: boolean;
}

export function RecentReviewsTable({ data, isLoading }: RecentReviewsTableProps) {

  const navigate = useNavigate();
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading recent reviews...</div>
  }

  return (
    <div className="w-full rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/reviews/${row.original._id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No reviews found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
