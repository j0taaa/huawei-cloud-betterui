"use client";

import { useEffect, useMemo, useState } from "react";

type SourceFile = {
  content: string;
  name: string;
};

const sourceFileExtensions = new Set([
  ".cjs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function extension(name: string) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isLikelyText(bytes: Uint8Array) {
  if (!bytes.length) {
    return false;
  }

  let printable = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1;
    }
  }

  return printable / bytes.length >= 0.9;
}

async function inflateRaw(bytes: Uint8Array) {
  if (!("DecompressionStream" in window)) {
    return null;
  }

  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractZipTextFiles(base64: string) {
  const archive = base64ToBytes(base64);
  const decoder = new TextDecoder();
  const files: SourceFile[] = [];
  let offset = 0;

  while (offset + 30 <= archive.length && files.length < 30) {
    if (readUint32(archive, offset) !== 0x04034b50) {
      break;
    }

    const method = readUint16(archive, offset + 8);
    const compressedSize = readUint32(archive, offset + 18);
    const fileNameLength = readUint16(archive, offset + 26);
    const extraLength = readUint16(archive, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > archive.length) {
      break;
    }

    const name = decoder.decode(archive.slice(nameStart, nameStart + fileNameLength));
    const payload = archive.slice(dataStart, dataEnd);
    const canPreview =
      !name.endsWith("/") && sourceFileExtensions.has(extension(name)) && payload.length <= 300_000;

    if (canPreview) {
      const content = method === 0 ? payload : method === 8 ? await inflateRaw(payload) : null;

      if (content && isLikelyText(content)) {
        files.push({ content: decoder.decode(content), name });
      }
    }

    offset = dataEnd;
  }

  return files;
}

function decodeInlineText(base64: string) {
  const bytes = base64ToBytes(base64);
  if (!isLikelyText(bytes)) {
    return "";
  }

  const text = new TextDecoder().decode(bytes);
  return text.includes("�") ? "" : text;
}

export function FunctionGraphCodeViewer({
  codePayload,
  codeSize,
  codeText,
  codeType,
  handler,
  runtime,
  version,
}: {
  codePayload: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  handler: string;
  runtime: string;
  version: string;
}) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [activeFile, setActiveFile] = useState(0);
  const [status, setStatus] = useState("Loading code package in browser...");
  const normalizedType = codeType.toLowerCase();

  useEffect(() => {
    let cancelled = false;

    async function loadCode() {
      if (codeText.trim()) {
        setFiles([{ content: codeText, name: handler || "inline source" }]);
        setStatus("");
        return;
      }

      if (!codePayload) {
        setFiles([]);
        setStatus("FunctionGraph did not return a code payload for this function.");
        return;
      }

      try {
        const loaded =
          normalizedType === "inline"
            ? [{ content: decodeInlineText(codePayload), name: handler || "inline source" }].filter(
                (file) => file.content,
              )
            : await extractZipTextFiles(codePayload);

        if (!cancelled) {
          setFiles(loaded);
          setActiveFile(0);
          setStatus(
            loaded.length
              ? ""
              : "No previewable text files were found in the returned code package.",
          );
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
          setStatus("Could not decode the returned code package in this browser.");
        }
      }
    }

    void loadCode();

    return () => {
      cancelled = true;
    };
  }, [codePayload, codeText, handler, normalizedType]);

  const active = files[activeFile];
  const sourceStats = useMemo(
    () => `${files.length} previewable file${files.length === 1 ? "" : "s"}`,
    [files.length],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
      <div className="border-b border-[#e4e9f2] bg-[#f8fafc] px-5 py-4">
        <h2 className="text-lg font-black">Code</h2>
        <p className="mt-1 text-sm font-semibold text-[#667085]">
          Type: {codeType || "unknown"} · Size: {codeSize} · Runtime: {runtime || "-"}
        </p>
      </div>

      {active ? (
        <div className="bg-[#0b1220]">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 font-mono text-xs text-[#cbd5e1]">
            <span>{active.name}</span>
            <span>{files.length > 1 ? sourceStats : version}</span>
          </div>
          {files.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-5 py-3">
              {files.map((file, index) => (
                <button
                  className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs font-bold ${
                    index === activeFile ? "bg-[#2563eb] text-white" : "bg-white/10 text-[#cbd5e1]"
                  }`}
                  key={file.name}
                  onClick={() => setActiveFile(index)}
                  type="button"
                >
                  {file.name}
                </button>
              ))}
            </div>
          ) : null}
          <pre className="max-h-[720px] overflow-auto p-5 font-mono text-sm leading-6 text-[#e2e8f0]">
            <code>{active.content}</code>
          </pre>
        </div>
      ) : (
        <div className="p-5">
          <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-5">
            <h3 className="text-base font-black text-[#101828]">Code preview unavailable</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">{status}</p>
          </div>
        </div>
      )}
    </section>
  );
}
