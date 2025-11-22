"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ExternalLink } from "lucide-react";

export type Review = {
  _id: string;
  repo_name: string;
  pr_number: number;
  language: string;
  issues_found: number;
  analyzed_at: string;
};

export const columns: ColumnDef<Review>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px]"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "repo_name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Repository
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="w-[150px] font-medium">{row.getValue("repo_name")}</div>
    ),
  },
  {
    accessorKey: "pr_number",
    header: "PR #",
    cell: ({ row }) => {
      const repo = row.original.repo_name;
      const pr = row.original.pr_number;
      return (
        <div className="flex w-[80px] items-center">
          <span className="truncate font-bold">#{pr}</span>
          <a
            href={`https://github.com/${repo}/pull/${pr}`}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-muted-foreground hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      );
    },
  },
  {
    accessorKey: "language",
    header: "Language",
    cell: ({ row }) => {
      const lang = row.getValue("language") as string;
      return (
        <Badge variant="outline" className="capitalize">
          {lang}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "issues_found",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Issues
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const issues = row.getValue("issues_found") as number;
      // Mimic "Priority": More issues = Higher attention needed
      return (
        <div className="flex items-center">
          {issues === 0 ? (
            <Badge
              variant="secondary"
              className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20"
            >
              Clean
            </Badge>
          ) : (
            <Badge variant="destructive" className="flex gap-1">
              {issues} Issues
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "analyzed_at",
    header: "Date",
    cell: ({ row }) => {
      const date = new Date(row.getValue("analyzed_at"));
      return (
        <div className="text-muted-foreground">{date.toLocaleDateString()}</div>
      );
    },
  },
];
