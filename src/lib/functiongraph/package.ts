import { unzipSync, zipSync } from "fflate";

export type PackageFile = { name: string; content: Uint8Array };
export type SourceFile = { name: string; content: string };
export type FunctionPackage = {
  codeFilename: string;
  codeType: "inline" | "zip";
  files: PackageFile[];
};

const maxPackageBytes = 7_000_000;
const sourceExtensions = new Set([
  "cjs",
  "css",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function isZipPayload(value: string) {
  // Inline source is also base64, so only inspect the archive signature here.
  return /^(UEsDB|UEsFB|UEsHB)/.test(value.replace(/\s+/g, ""));
}

function validateFiles(files: PackageFile[]) {
  const names = new Set<string>();
  let size = 0;
  for (const file of files) {
    if (names.has(file.name))
      throw new Error("Duplicate ZIP entries cannot be edited safely.");
    names.add(file.name);
    size += file.content.length;
    if (size > maxPackageBytes)
      throw new Error("Function package exceeds the 7 MB editing limit.");
  }
}

/** Decode every entry or fail; a preview limit must never become an upload limit. */
export function readZipPackage(value: string): PackageFile[] {
  if (value.length > Math.ceil((maxPackageBytes * 4) / 3) + 100_000) {
    throw new Error("Function package exceeds the 7 MB editing limit.");
  }
  let size = 0;
  const names = new Set<string>();
  const entries = unzipSync(base64ToBytes(value), {
    filter(file) {
      if (names.has(file.name))
        throw new Error("Duplicate ZIP entries cannot be edited safely.");
      names.add(file.name);
      size += file.originalSize;
      if (size > maxPackageBytes)
        throw new Error("Function package exceeds the 7 MB editing limit.");
      if (file.compression !== 0 && file.compression !== 8) {
        throw new Error("This ZIP compression format cannot be edited safely.");
      }
      return true;
    },
  });
  const files = Object.entries(entries).map(([name, content]) => ({
    name,
    content,
  }));
  validateFiles(files);
  return files;
}

export function buildZipPayload(files: PackageFile[]) {
  validateFiles(files);
  return bytesToBase64(
    zipSync(Object.fromEntries(files.map((file) => [file.name, file.content]))),
  );
}

export function readFunctionPackage(input: {
  codeType: string;
  codeFile: string;
  codePayload: string;
  codeText: string;
  handler: string;
}): FunctionPackage {
  if (
    input.codeType.toLowerCase() === "zip" ||
    isZipPayload(input.codePayload)
  ) {
    return {
      codeFilename: input.codeFile || "function-code.zip",
      codeType: "zip",
      files: readZipPackage(input.codePayload),
    };
  }
  if (input.codeType && input.codeType.toLowerCase() !== "inline") {
    throw new Error("This function code format cannot be edited safely.");
  }
  if (!input.codeText && !input.codePayload)
    throw new Error("FunctionGraph did not return a code payload.");
  const content = input.codeText
    ? new TextEncoder().encode(input.codeText)
    : base64ToBytes(input.codePayload);
  const codeFilename = input.codeFile || input.handler || "source";
  const files = [{ name: codeFilename, content }];
  validateFiles(files);
  return { codeFilename, codeType: "inline", files };
}

export function previewFunctionPackage(pkg: FunctionPackage): SourceFile[] {
  return pkg.files
    .flatMap((file) => {
      if (
        pkg.codeType === "zip" &&
        (!sourceExtensions.has(
          file.name.split(".").at(-1)?.toLowerCase() ?? "",
        ) ||
          file.content.length > 300_000)
      )
        return [];
      try {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          file.content,
        );
        return content.includes("\0") ? [] : [{ name: file.name, content }];
      } catch {
        return [];
      }
    })
    .slice(0, 30);
}

export function applySourceEdits(
  pkg: FunctionPackage,
  drafts: Record<string, string>,
): FunctionPackage {
  const editableNames = new Set(
    previewFunctionPackage(pkg).map((file) => file.name),
  );
  for (const name of Object.keys(drafts)) {
    if (!editableNames.has(name))
      throw new Error("The edited file is not part of the loaded preview.");
  }
  const files = pkg.files.map((file) =>
    Object.hasOwn(drafts, file.name)
      ? { ...file, content: new TextEncoder().encode(drafts[file.name]) }
      : file,
  );
  validateFiles(files);
  return { ...pkg, files };
}

export function serializeFunctionPackage(pkg: FunctionPackage) {
  validateFiles(pkg.files);
  return {
    codeFilename: pkg.codeFilename,
    codeType: pkg.codeType,
    codePayload:
      pkg.codeType === "zip"
        ? buildZipPayload(pkg.files)
        : bytesToBase64(pkg.files[0].content),
  };
}
