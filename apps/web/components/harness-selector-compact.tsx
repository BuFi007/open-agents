"use client";

import { Bot, CheckIcon, ChevronDown } from "lucide-react";
import { useState } from "react";
import { CHAT_HARNESS_OPTIONS, type ChatHarnessId } from "@/lib/chat-harnesses";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface HarnessSelectorCompactProps {
  value: ChatHarnessId;
  onChange: (harnessId: ChatHarnessId) => void;
  disabled?: boolean;
  disabledReason?: string;
  onCloseAutoFocus?: () => void;
}

export function HarnessSelectorCompact({
  value,
  onChange,
  disabled = false,
  disabledReason,
  onCloseAutoFocus,
}: HarnessSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = CHAT_HARNESS_OPTIONS.find(
    (option) => option.id === value,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Change harness"
          title={disabledReason ?? "Change harness"}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300 disabled:pointer-events-none disabled:opacity-60"
        >
          <Bot className="size-3.5 shrink-0" />
          <span className="max-w-[110px] truncate">
            {selectedOption?.label ?? value}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
      >
        <Command>
          <CommandList>
            <CommandGroup heading="Harness">
              {CHAT_HARNESS_OPTIONS.map((option) => (
                <CommandItem
                  key={option.id}
                  disabled={!option.available}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    if (!option.available) {
                      return;
                    }

                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="items-start"
                >
                  <Bot className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  <CheckIcon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      value === option.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
