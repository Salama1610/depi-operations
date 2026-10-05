"use client";

// A dropdown with a search box, for every choice in the app.
//
// Short lists open as a plain list; from `searchFrom` options on, a search box
// sits at the top and narrows the list as the person types. Labels arrive
// already translated: callers pass t(label).

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useT } from "@/lib/i18n/context";

export type SelectOption = string | { value: string; label: string };

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  className,
  required,
  searchFrom = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  required?: boolean;
  searchFrom?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const chosen = items.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={label || placeholder}
          aria-required={required}
          className={"searchable-select " + (className || "")}
        >
          <span className={chosen ? "" : "is-placeholder"}>{chosen ? chosen.label : placeholder || label || t("Choose")}</span>
          <ChevronDown size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="searchable-select-list" align="start">
        <Command
          filter={(itemValue, search) => {
            const item = items.find((o) => o.value === itemValue);
            const text = ((item?.label || "") + " " + itemValue).toLowerCase();
            return search
              .toLowerCase()
              .split(/\s+/)
              .filter(Boolean)
              .every((word) => text.includes(word))
              ? 1
              : 0;
          }}
        >
          {items.length >= searchFrom && <CommandInput placeholder={t("Search…")} />}
          <CommandList>
            <CommandEmpty>{t("No matches")}</CommandEmpty>
            {items.map((o) => (
              <CommandItem
                key={o.value}
                value={o.value}
                onSelect={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <Check size={15} className={o.value === value ? "" : "is-hidden"} />
                {o.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
