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

import { ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface Repository {
  _id: string;
  full_name: string;
  url: string;
  status: "active" | "inactive";
  added_at: string;
}

export const columns: ColumnDef<Repository>[] = [
  {
    accessorKey: "full_name",
    header: "Repository",
    cell: ({ row }) => {
      const name = row.getValue("full_name") as string;
      return (
        <a
          href={`https://github.com/${name}`}
          target="_blank"
          rel="noreferrer"
          className="font-medium hover:underline flex items-center gap-2 w-fit"
        >
          {name}
          <ExternalLink className="h-3 w-3 text-muted-foregroud" />
        </a>
      )
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return <Badge variant={status === "active" ? "default" : "outline"}>{status}</Badge>
    },
  },
  {
    accessorKey: "added_at",
    header: "Date Added",
    cell: ({ row }) => {
      return new Date(row.getValue("added_at")).toLocaleDateString()
    },
  },
]

interface RepositoriesTableProps {
  data: Repository[];
  isLoading: boolean;
}

export function RepositoriesTable({ data, isLoading }: RepositoriesTableProps) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (isLoading) {
    return <div>Loading repositories...</div>
  }

  return (
    <div className="w-full rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
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
                No repositories added yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
