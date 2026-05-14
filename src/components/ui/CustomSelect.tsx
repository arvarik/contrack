import React, { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import { DROPDOWN_MENU, DROPDOWN_ITEM } from "../../lib/styles";
import { ChevronDown } from "lucide-react";

export const CustomSelect = ({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  options: readonly string[];
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(className, "flex items-center justify-between gap-1")}
      >
        {value}
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      {isOpen && (
        <ul
          className={cn(DROPDOWN_MENU, "min-w-[100px]")}
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt) => (
            <li
              key={opt}
              className={DROPDOWN_ITEM}
              onClick={() => {
                onChange(opt);
                setIsOpen(false);
              }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
