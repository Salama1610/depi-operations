"use client";

// A row's actions behind one button (16 November 2026): a table row with many
// actions listed them side by side and pushed its columns off the screen.
// Each action belongs to a group, shown in the order the groups first appear.

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type RowAction = { key: string; label: string; group: string; icon?: ReactNode; onClick: () => void };

export function RowActions({ actions, label }: { actions: RowAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="small-btn row-actions-btn" aria-haspopup="menu" aria-expanded={open}>
          <MoreHorizontal size={15} /> {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="row-actions-menu" role="menu">
        {groups.map((group) => (
          <div key={group} role="group" aria-label={group} className="row-actions-group">
            <small>{group}</small>
            {actions
              .filter((a) => a.group === group)
              .map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  className="row-actions-item"
                  onClick={() => {
                    setOpen(false);
                    a.onClick();
                  }}
                >
                  {a.icon}
                  <span>{a.label}</span>
                </button>
              ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
