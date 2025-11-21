"use client"

import { type Table } from "@tanstack/react-table"
import { X, FileCode, FileJson } from "lucide-react" // Icons for languages

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTableFacetedFilter } from "./data-table-faceted-filter"

interface DataTableToolbarProps<TData> {
  table: Table<TData>
}

export const languages = [
  {
    value: "python",
    label: "Python",
    icon: FileJson,
  },
  {
    value: "c",
    label: "C / C++",
    icon: FileCode,
  },
]

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        {/* Search Input */}
        <Input
          placeholder="Filter repositories..."
          value={(table.getColumn("repo_name")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("repo_name")?.setFilterValue(event.target.value)
          }
          className="h-8 w-[150px] lg:w-[250px]"
        />

        {table.getColumn("language") && (
          <DataTableFacetedFilter
            column={table.getColumn("language")}
            title="Language"
            options={languages}
          />
        )}

        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
