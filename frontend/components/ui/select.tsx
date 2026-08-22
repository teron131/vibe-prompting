/** Owns the app-styled single-choice and multi-choice menus used across compact workspace controls. */

"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  isValidElement,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";

import { useDismissibleDetails } from "@/hooks/use-dismissible-details";

import { cn } from "./utils";

type SelectOption = {
  disabled: boolean;
  label: ReactNode;
  value: string;
};

const triggerClasses =
  "flex h-full w-full cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";
const menuClasses =
  "absolute top-[calc(100%+0.375rem)] left-0 z-50 w-max min-w-full max-w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl";
const optionClasses =
  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export type SelectProps = {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  onValueChange?(value: string): void;
  prefix?: ReactNode;
  renderIcon?(value: string): ReactNode;
  triggerClassName?: string;
  value?: string;
};

export function Select({
  "aria-label": ariaLabel,
  children,
  className,
  defaultValue,
  disabled,
  onValueChange,
  prefix,
  renderIcon,
  triggerClassName,
  value,
}: SelectProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const options = readOptions(children);
  const firstValue = options.find((option) => !option.disabled)?.value ?? "";
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstValue);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];
  useDismissibleDetails(detailsRef);

  return (
    <details
      className={cn(
        "group/select relative h-10 w-full text-sm",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      ref={detailsRef}
    >
      <summary aria-label={ariaLabel} className={cn(triggerClasses, triggerClassName)}>
        {prefix}
        {selected && renderIcon ? renderIcon(selected.value) : null}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/select:rotate-180"
        />
      </summary>
      <div className={menuClasses}>
        {options.map((option) => {
          const active = option.value === selectedValue;
          return (
            <button
              aria-current={active ? "true" : undefined}
              className={cn(optionClasses, active && "bg-accent text-accent-foreground")}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                setInternalValue(option.value);
                onValueChange?.(option.value);
                if (detailsRef.current) detailsRef.current.open = false;
              }}
              type="button"
            >
              {renderIcon ? renderIcon(option.value) : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="ml-auto grid size-4 place-items-center">
                {active ? <Check aria-label="Selected" className="size-3.5" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

export function MultiSelect({
  "aria-label": ariaLabel,
  allLabel,
  children,
  className,
  onValuesChange,
  prefix,
  renderIcon,
  triggerClassName,
  values,
}: {
  "aria-label"?: string;
  allLabel: ReactNode;
  children: ReactNode;
  className?: string;
  onValuesChange(values: string[]): void;
  prefix?: ReactNode;
  renderIcon?(value: string): ReactNode;
  triggerClassName?: string;
  values: string[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const options = readOptions(children);
  const selected =
    values.length === 1 ? options.find(({ value }) => value === values[0]) : undefined;
  useDismissibleDetails(detailsRef);

  return (
    <details
      className={cn("group/select relative h-10 w-full text-sm", className)}
      ref={detailsRef}
    >
      <summary aria-label={ariaLabel} className={cn(triggerClasses, triggerClassName)}>
        {prefix}
        {selected && renderIcon ? renderIcon(selected.value) : null}
        <span className="min-w-0 flex-1 truncate text-left">
          {values.length === 0 ? allLabel : (selected?.label ?? `${values.length} selected`)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/select:rotate-180"
        />
      </summary>
      <div className={menuClasses}>
        <button
          aria-pressed={values.length === 0}
          className={cn(optionClasses, values.length === 0 && "bg-accent text-accent-foreground")}
          onClick={() => onValuesChange([])}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          <span className="ml-auto grid size-4 place-items-center">
            {values.length === 0 ? <Check aria-label="Selected" className="size-3.5" /> : null}
          </span>
        </button>
        {options.map((option) => {
          const active = values.includes(option.value);
          return (
            <button
              aria-pressed={active}
              className={cn(optionClasses, active && "bg-accent text-accent-foreground")}
              disabled={option.disabled}
              key={option.value}
              onClick={() =>
                onValuesChange(
                  active
                    ? values.filter((value) => value !== option.value)
                    : [...values, option.value],
                )
              }
              type="button"
            >
              {renderIcon ? renderIcon(option.value) : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="ml-auto grid size-4 place-items-center">
                {active ? <Check aria-label="Selected" className="size-3.5" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child) || child.type !== "option") return [];
    const option = child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
    return [
      {
        disabled: Boolean(option.props.disabled),
        label: option.props.children,
        value: String(option.props.value ?? ""),
      },
    ];
  });
}
