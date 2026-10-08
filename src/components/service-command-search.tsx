"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Search, X } from "lucide-react";
import { searchServices } from "@/lib/service-catalog";

export function ServiceCommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const filteredServices = useMemo(() => searchServices(query), [query]);

  const selectedServiceIndex =
    filteredServices.length === 0
      ? 0
      : Math.min(selectedIndex, filteredServices.length - 1);

  const openSelectedService = useCallback(() => {
    const selectedService = filteredServices[selectedServiceIndex];

    if (!selectedService) {
      return;
    }

    closeSearch();
    window.location.href = selectedService.href;
  }, [closeSearch, filteredServices, selectedServiceIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandSearch =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isCommandSearch) {
        event.preventDefault();
        setOpen(true);
      }

      if (event.key === "Escape") {
        closeSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <>
      <button
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-[#d9e0eb] bg-white px-4 text-left text-sm font-medium text-[#667085] shadow-sm transition hover:border-[#b8c3d7] hover:bg-[#fbfcfe] lg:max-w-xl"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="size-5" />
        <span className="min-w-0 flex-1 truncate">
          Search Huawei Cloud services...
        </span>
        <kbd className="rounded-md bg-[#f2f4f7] px-2 py-1 text-xs font-bold text-[#667085]">
          ⌘ K
        </kbd>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-modal="true"
              className="fixed inset-0 z-[100] flex items-start justify-center bg-[#101828]/35 px-4 pb-8 pt-20 backdrop-blur-sm sm:pt-24"
              onMouseDown={closeSearch}
              role="dialog"
            >
              <div
                className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_24px_80px_rgba(16,24,40,0.22)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-center gap-3 border-b border-[#e4e9f2] px-5 py-4">
                  <Search className="size-5 text-[#667085]" />
                  <input
                    aria-label="Search Huawei Cloud services"
                    className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-[#98a2b3]"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelectedIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSelectedIndex((currentIndex) =>
                          filteredServices.length === 0
                            ? 0
                            : (currentIndex + 1) % filteredServices.length,
                        );
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSelectedIndex((currentIndex) =>
                          filteredServices.length === 0
                            ? 0
                            : (currentIndex - 1 + filteredServices.length) %
                              filteredServices.length,
                        );
                      }

                      if (event.key === "Enter") {
                        event.preventDefault();
                        openSelectedService();
                      }
                    }}
                    placeholder="Search ECS, OBS, VPC, RDS, IAM..."
                    ref={inputRef}
                    value={query}
                  />
                  <button
                    aria-label="Close search"
                    className="grid size-8 place-items-center rounded-lg text-[#667085] hover:bg-[#f2f4f7]"
                    onClick={closeSearch}
                    type="button"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="max-h-[520px] overflow-y-auto p-2">
                  {filteredServices.length > 0 ? (
                    filteredServices.map((service, index) => {
                      const Icon = service.icon;
                      const isSelected = index === selectedServiceIndex;

                      return (
                        <a
                          aria-selected={isSelected}
                          className={
                            isSelected
                              ? "flex items-center gap-4 rounded-xl bg-[#eef4ff] p-4 transition"
                              : "flex items-center gap-4 rounded-xl p-4 transition hover:bg-[#f4f7fb]"
                          }
                          href={service.href}
                          key={`${service.category}-${service.shortName}`}
                          onClick={closeSearch}
                          onMouseEnter={() => setSelectedIndex(index)}
                          role="option"
                        >
                          <div
                            className={
                              isSelected
                                ? "grid size-11 place-items-center rounded-xl bg-white text-[#2563eb] shadow-sm"
                                : "grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]"
                            }
                          >
                            {service.logo ? (
                              <Image
                                alt={`${service.shortName} logo`}
                                className="size-7 object-contain"
                                height={28}
                                src={service.logo}
                                width={28}
                              />
                            ) : (
                              <Icon className="size-5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-black">{service.shortName}</p>
                              <p className="font-bold text-[#344054]">
                                {service.name}
                              </p>
                              <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs font-bold text-[#667085]">
                                {service.category}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-[#667085]">
                              {service.description}
                            </p>
                          </div>
                          <ArrowRight
                            className={
                              isSelected
                                ? "size-4 text-[#2563eb]"
                                : "size-4 text-[#98a2b3]"
                            }
                          />
                        </a>
                      );
                    })
                  ) : (
                    <div className="grid place-items-center px-6 py-14 text-center">
                      <p className="text-lg font-black">No services found</p>
                      <p className="mt-2 max-w-sm text-sm font-medium text-[#667085]">
                        Try searching by abbreviation, category, or common terms
                        like bucket, Redis, firewall, or Kubernetes.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
