// src/components/RecentReviewsTable.tsx
"use client" // Required for TanStack Table hooks

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

// Mock data type and data
export type Review = {
  id: string
  pullRequest: string
  status: "Reviewed" | "Pending" | "Error"
  reviewer: string
  issuesFound: number
}

export const data: Review[] = [
  {
    id: "pr-1",
    pullRequest: "feat: Add new user authentication flow",
    status: "Reviewed",
    reviewer: "AI Bot",
    issuesFound: 3,
  },
  {
    id: "pr-2",
    pullRequest: "fix: Correct critical payment bug",
    status: "Reviewed",
    reviewer: "AI Bot",
    issuesFound: 1,
  },
  {
    id: "pr-3",
    pullRequest: "docs: Update README.md",
    status: "Pending",
    reviewer: "AI Bot",
    issuesFound: 0,
  },
  {
    id: "pr-4",
    pullRequest: "refactor: Simplify database service",
    status: "Reviewed",
    reviewer: "AI Bot",
    issuesFound: 5,
  },
]

// Define the columns for the table
export const columns: ColumnDef<Review>[] = [
  {
    accessorKey: "pullRequest",
    header: "Pull Request",
  },
  {
    accessorKey: "status",
    header: "Status",
  },
  {
    accessorKey: "reviewer",
    header: "Reviewer",
  },
  {
    accessorKey: "issuesFound",
    header: "Issues Found",
  },
]

// The main table component
export function RecentReviewsTable() {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
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
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
