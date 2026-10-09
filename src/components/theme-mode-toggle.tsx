"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ConsoleFloatingMenuPanel, ConsoleMenuItem } from "@/components/console-ui";

type ThemeMode = "system" | "light" | "dark";

const storageKey = "better-ui-theme";
const themeChangeEvent = "better-ui-theme-change";

const options: Array<{
  icon: LucideIcon;
  label: string;
  value: ThemeMode;
}> = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
];

function readTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function applyTheme(theme: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = theme === "dark" || (theme === "system" && prefersDark);

  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.documentElement.dataset.theme = theme;
}

function subscribeTheme(callback: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === storageKey) {
      callback();
    }
  }

  window.addEventListener(themeChangeEvent, callback);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(themeChangeEvent, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function ThemeModeToggle() {
  const theme = useSyncExternalStore<ThemeMode>(subscribeTheme, readTheme, () => "system");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(theme);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (readTheme() === "system") {
        applyTheme("system");
      }
    };

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, [theme]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("pointerdown", handlePointerDown);
    }

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const selected = useMemo(
    () => options.find((option) => option.value === theme) ?? options[0],
    [theme],
  );
  const SelectedIcon = selected.icon;

  function chooseTheme(nextTheme: ThemeMode) {
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event(themeChangeEvent));
    setOpen(false);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={`Theme: ${selected.label}`}
        className="grid size-5 place-items-center text-[#475467] transition hover:text-[#101828] dark:text-[#98a2b3] dark:hover:text-white"
        onClick={() => setOpen((current) => !current)}
        title={`Theme: ${selected.label}`}
        type="button"
      >
        <SelectedIcon className="size-5" />
      </button>

      {open ? (
        <ConsoleFloatingMenuPanel className="absolute right-0 top-12 z-50 grid min-w-36 gap-1">
          {options
            .filter((option) => option.value !== theme)
            .map((option) => {
              const Icon = option.icon;

              return (
                <ConsoleMenuItem
                  key={option.value}
                  onClick={() => chooseTheme(option.value)}
                >
                  <Icon className="size-4" />
                  {option.label}
                </ConsoleMenuItem>
              );
            })}
        </ConsoleFloatingMenuPanel>
      ) : null}
    </div>
  );
}
