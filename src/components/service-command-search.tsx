"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Box, Search, X } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleEmptyPanelBody,
  ConsoleEyebrow,
  ConsoleFloatingMenuPanel,
  ConsoleIconButton,
  ConsoleInput,
  ConsoleInsetPanel,
} from "@/components/console-ui";
import { searchServices, searchableServices } from "@/lib/service-catalog";

type SearchResource = {
  href: string;
  id: string;
  label: string;
  metadata: string;
  service: string;
  status: string;
};

type ResourceSearchError = {
  error: string;
  service: string;
};

const huaweiServices = searchableServices;

const normalize = (value: string) => value.toLowerCase().trim();

export function ServiceCommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resourceErrors, setResourceErrors] = useState<ResourceSearchError[]>([]);
  const [resources, setResources] = useState<SearchResource[]>([]);
  const [resourcesLoaded, setResourcesLoaded] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const openSearch = useCallback(() => {
    if (!resourcesLoaded) {
      setResourcesLoading(true);
    }

    setOpen(true);
  }, [resourcesLoaded]);

  const filteredServices = useMemo(() => {
    const services = searchServices(query);
    return normalize(query) ? services.slice(0, 8) : services;
  }, [query]);

  const filteredResources = useMemo(() => {
    const term = normalize(query);

    if (!term) {
      return resources.slice(0, 20);
    }

    return resources
      .filter((resource) =>
        [
          resource.label,
          resource.id,
          resource.service,
          resource.status,
          resource.metadata,
        ]
          .map(normalize)
          .some((value) => value.includes(term)),
      )
      .slice(0, 50);
  }, [query, resources]);

  const resultCount = filteredServices.length + filteredResources.length;
  const hasVisibleResults = resultCount > 0 || resourcesLoading || resourcesLoaded;
  const selectedResultIndex =
    resultCount === 0 ? 0 : Math.min(selectedIndex, resultCount - 1);

  const openSelectedService = useCallback(() => {
    const selectedService =
      selectedResultIndex < filteredServices.length
        ? filteredServices[selectedResultIndex]
        : null;
    const selectedResource =
      selectedResultIndex >= filteredServices.length
        ? filteredResources[selectedResultIndex - filteredServices.length]
        : null;

    if (!selectedService && !selectedResource) {
      return;
    }

    closeSearch();
    window.location.href = selectedService?.href ?? selectedResource?.href ?? "/";
  }, [
    closeSearch,
    filteredResources,
    filteredServices,
    selectedResultIndex,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandSearch =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isCommandSearch) {
        event.preventDefault();
        openSearch();
      }

      if (event.key === "Escape") {
        closeSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch, openSearch]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || resourcesLoaded) {
      return;
    }

    let cancelled = false;

    fetch("/api/cloud/search/resources")
      .then(async (response) => {
        if (response.ok) {
          return (await response.json()) as {
            errors?: ResourceSearchError[];
            resources?: SearchResource[];
          };
        }

        return {
          errors: [
            {
              error: `Resource search request failed with ${response.status}.`,
              service: "Resource search",
            },
          ],
          resources: [],
        };
      })
      .then((body: { errors?: ResourceSearchError[]; resources?: SearchResource[] } | null) => {
        if (!cancelled) {
          setResources(Array.isArray(body?.resources) ? body.resources : []);
          setResourceErrors(Array.isArray(body?.errors) ? body.errors : []);
          setResourcesLoaded(true);
          setResourcesLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResourceErrors([
            {
              error: "Could not load resource search inventory.",
              service: "Resource search",
            },
          ]);
          setResources([]);
          setResourcesLoaded(true);
          setResourcesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, resourcesLoaded]);

  return (
    <>
      <ConsoleButton
        className="w-full justify-start px-4 text-left font-medium text-[#667085] lg:max-w-xl"
        onClick={openSearch}
        size="lg"
        variant="neutral"
      >
        <Search className="size-5" />
        <span className="min-w-0 flex-1 truncate">
          Search Huawei Cloud services...
        </span>
        <kbd className="rounded-md bg-[#f2f4f7] px-2 py-1 text-xs font-bold text-[#667085]">
          ⌘ K
        </kbd>
      </ConsoleButton>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-start justify-center bg-[#101828]/35 px-4 pb-8 pt-20 backdrop-blur-sm sm:pt-24"
          onMouseDown={closeSearch}
          role="dialog"
        >
          <ConsoleFloatingMenuPanel
            className="w-full max-w-2xl overflow-hidden rounded-2xl p-0 shadow-[0_24px_80px_rgba(16,24,40,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[#e4e9f2] px-5 py-4">
              <Search className="size-5 text-[#667085]" />
              <ConsoleInput
                aria-label="Search Huawei Cloud services"
                className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-base focus:bg-transparent focus:ring-0 dark:bg-transparent dark:focus:bg-transparent"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedIndex((currentIndex) =>
                      resultCount === 0
                        ? 0
                        : (currentIndex + 1) % resultCount,
                    );
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((currentIndex) =>
                      resultCount === 0
                        ? 0
                        : (currentIndex - 1 + resultCount) % resultCount,
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
              <ConsoleIconButton
                aria-label="Close search"
                onClick={closeSearch}
              >
                <X className="size-4" />
              </ConsoleIconButton>
            </div>

            <div className="max-h-[520px] overflow-y-auto p-2">
              {hasVisibleResults ? (
                <>
                  {filteredServices.length ? (
                    <ConsoleEyebrow className="block px-3 pb-1 pt-2">
                      Services
                    </ConsoleEyebrow>
                  ) : null}
                  {filteredServices.map((service, index) => {
                  const Icon = service.icon;
                  const isSelected = index === selectedResultIndex;

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
                })}
                  <ConsoleEyebrow className="block px-3 pb-1 pt-3">
                    Resources
                  </ConsoleEyebrow>
                  {resourcesLoading ? (
                    <ConsoleInsetPanel className="mx-2 rounded-xl px-4 py-3 text-sm font-bold text-[#667085]" dashed>
                      Loading cloud resources...
                    </ConsoleInsetPanel>
                  ) : null}
                  {!resourcesLoading && resourcesLoaded && resourceErrors.length ? (
                    <ConsoleCallout className="mx-2 mb-2 px-4 py-3" tone="warning">
                      Resource search loaded with {resourceErrors.length} service errors.
                    </ConsoleCallout>
                  ) : null}
                  {!resourcesLoading && resourcesLoaded && !filteredResources.length ? (
                    <ConsoleInsetPanel className="mx-2 rounded-xl px-4 py-3 text-sm font-bold text-[#667085]" dashed>
                      No matching resources.
                    </ConsoleInsetPanel>
                  ) : null}
                  {filteredResources.map((resource, index) => {
                    const absoluteIndex = filteredServices.length + index;
                    const service = huaweiServices.find(
                      (item) => item.shortName === resource.service || item.name === resource.service,
                    );
                    const Icon = service?.icon ?? Box;
                    const isSelected = absoluteIndex === selectedResultIndex;

                    return (
                      <a
                        aria-selected={isSelected}
                        className={
                          isSelected
                            ? "flex items-center gap-4 rounded-xl bg-[#eef4ff] p-4 transition"
                            : "flex items-center gap-4 rounded-xl p-4 transition hover:bg-[#f4f7fb]"
                        }
                        href={resource.href}
                        key={`${resource.service}-${resource.id}`}
                        onClick={closeSearch}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                        role="option"
                      >
                        <div
                          className={
                            isSelected
                              ? "grid size-11 place-items-center rounded-xl bg-white text-[#2563eb] shadow-sm"
                              : "grid size-11 place-items-center rounded-xl bg-[#f4f7fb] text-[#344054]"
                          }
                        >
                          {service?.logo ? (
                            <Image
                              alt={`${resource.service} logo`}
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
                            <p className="truncate font-black">{resource.label}</p>
                            <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-xs font-bold text-[#2563eb]">
                              {resource.service}
                            </span>
                            {resource.status && resource.status !== "-" ? (
                              <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs font-bold text-[#667085]">
                                {resource.status}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-sm font-medium text-[#667085]">
                            {resource.metadata}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-[#98a2b3]">
                            {resource.id}
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
                  })}
                </>
              ) : (
                <ConsoleEmptyPanelBody className="py-14" title="No matches found">
                  Try searching by service, resource name, ID, IP, bucket, disk,
                  image, Redis, firewall, or Kubernetes.
                </ConsoleEmptyPanelBody>
              )}
            </div>
          </ConsoleFloatingMenuPanel>
        </div>,
          document.body,
        )
        : null}
    </>
  );
}
