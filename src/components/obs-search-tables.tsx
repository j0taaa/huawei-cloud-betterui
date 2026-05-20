"use client";

import Link from "next/link";
import { Download, FileText, FolderOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import type { ObsBucket, ObsObject } from "@/lib/huawei-cloud";

function includesQuery(values: string[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function ObsBucketSearchTable({ buckets }: { buckets: ObsBucket[] }) {
  const [query, setQuery] = useState("");
  const filteredBuckets = useMemo(
    () =>
      buckets.filter((bucket) =>
        includesQuery(
          [bucket.name, bucket.location, bucket.type, bucket.storageClass, bucket.createdAt],
          query,
        ),
      ),
    [buckets, query],
  );

  if (!buckets.length) {
    return null;
  }

  return (
    <>
      <div className="border-b border-[#e4e9f2] bg-[#fbfcfe] p-4">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label="Search OBS buckets"
            className="h-10 w-full rounded-lg border border-[#d9e0eb] bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search buckets by name, region, type..."
            type="search"
            value={query}
          />
        </label>
        <p className="mt-2 text-xs font-bold text-[#667085]">
          Showing {filteredBuckets.length} of {buckets.length} buckets
        </p>
      </div>
      {filteredBuckets.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                <th className="px-5 py-3">Bucket</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Storage class</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {filteredBuckets.map((bucket) => (
                <tr className="hover:bg-[#fbfcfe]" key={bucket.name}>
                  <td className="px-5 py-4">
                    <Link
                      className="inline-flex items-center gap-2 font-black text-[#2563eb] hover:underline"
                      href={`/services/obs/${encodeURIComponent(bucket.name)}`}
                    >
                      <FolderOpen className="size-4" />
                      {bucket.name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 font-semibold">{bucket.location}</td>
                  <td className="px-5 py-4 font-semibold">{bucket.type}</td>
                  <td className="px-5 py-4 font-semibold">{bucket.storageClass}</td>
                  <td className="px-5 py-4 font-semibold">
                    <LocalDateTime value={bucket.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid place-items-center px-6 py-14 text-center">
          <div>
            <p className="text-lg font-black">No matching buckets</p>
            <p className="mt-2 text-sm font-semibold text-[#667085]">
              Try another bucket name, region, type, or storage class.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export function ObsObjectSearchTable({
  bucketName,
  objects,
}: {
  bucketName: string;
  objects: ObsObject[];
}) {
  const [query, setQuery] = useState("");
  const filteredObjects = useMemo(
    () =>
      objects.filter((object) =>
        includesQuery(
          [object.key, object.size, object.storageClass, object.etag, object.lastModified, object.owner],
          query,
        ),
      ),
    [objects, query],
  );

  if (!objects.length) {
    return null;
  }

  return (
    <>
      <div className="border-b border-[#e4e9f2] bg-[#fbfcfe] p-4">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label="Search OBS objects"
            className="h-10 w-full rounded-lg border border-[#d9e0eb] bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search objects by key, size, ETag..."
            type="search"
            value={query}
          />
        </label>
        <p className="mt-2 text-xs font-bold text-[#667085]">
          Showing {filteredObjects.length} of {objects.length} objects
        </p>
      </div>
      {filteredObjects.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
              <tr>
                <th className="px-5 py-3">Object key</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Storage class</th>
                <th className="px-5 py-3">ETag</th>
                <th className="px-5 py-3">Last modified</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {filteredObjects.map((object) => (
                <tr className="hover:bg-[#fbfcfe]" key={object.key}>
                  <td className="px-5 py-4">
                    <Link
                      className="flex items-center gap-2 font-black text-[#2563eb] hover:underline"
                      href={`/services/obs/${encodeURIComponent(bucketName)}/objects?key=${encodeURIComponent(object.key)}`}
                    >
                      <FileText className="size-4 text-[#2563eb]" />
                      <span className="break-all">{object.key}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-4 font-semibold">{object.size}</td>
                  <td className="px-5 py-4 font-semibold">{object.storageClass}</td>
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-[#667085]">
                    {object.etag}
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    <LocalDateTime value={object.lastModified} />
                  </td>
                  <td className="px-5 py-4">
                    <a
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-xs font-black text-[#344054] hover:bg-[#f8fafc]"
                      href={`/api/cloud/obs/objects?bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(object.key)}`}
                    >
                      <Download className="size-3.5" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid place-items-center px-6 py-14 text-center">
          <div>
            <p className="text-lg font-black">No matching objects</p>
            <p className="mt-2 text-sm font-semibold text-[#667085]">
              Try another key, storage class, ETag, or date.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
