"use client";

import {
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  PackageSearch,
  Save,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import { go } from "@codemirror/legacy-modes/mode/go";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  CompactFactList,
  ConsoleButton,
  ConsoleIconButton,
  ConsoleIconTile,
  ConsoleInsetPanel,
  ConsoleMonoText,
  ConsolePill,
  ConsoleSidecarLayout,
  ConsoleSurface,
  SimpleTable,
  type SimpleTableRow,
} from "@/components/console-ui";

import {
  applySourceEdits,
  previewFunctionPackage,
  readFunctionPackage,
  serializeFunctionPackage,
  type FunctionPackage,
  type SourceFile,
} from "@/lib/functiongraph/package";

type FunctionGraphCodeResponse = {
  codeFile?: string;
  codePayload?: string;
  codeText?: string;
  codeType?: string;
  error?: string;
};

type FunctionGraphCodeUpdateResponse = {
  error?: string;
  ok?: boolean;
};

type FileTreeNode = {
  children: FileTreeNode[];
  fileIndex?: number;
  id: string;
  name: string;
  type: "file" | "folder";
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

function fileIconFor(name: string) {
  const ext = extension(name);

  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) {
    return Code2;
  }

  if ([".json", ".yaml", ".yml"].includes(ext)) {
    return FileJson;
  }

  if ([".sh", ".bash", ".zsh"].includes(ext)) {
    return TerminalSquare;
  }

  if ([".html", ".xml", ".css"].includes(ext)) {
    return Braces;
  }

  if (sourceFileExtensions.has(ext)) {
    return FileCode2;
  }

  return FileText;
}

function editorLanguageExtensions(name: string): Extension[] {
  const ext = extension(name);

  if ([".ts", ".tsx"].includes(ext)) {
    return [javascript({ jsx: ext === ".tsx", typescript: true })];
  }

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    return [javascript({ jsx: ext === ".jsx" })];
  }

  if (ext === ".json") {
    return [json()];
  }

  if (ext === ".py") {
    return [python()];
  }

  if (ext === ".css") {
    return [css()];
  }

  if (ext === ".html") {
    return [html()];
  }

  if (ext === ".xml") {
    return [xml()];
  }

  if ([".yaml", ".yml"].includes(ext)) {
    return [StreamLanguage.define(yaml)];
  }

  if (ext === ".sh") {
    return [StreamLanguage.define(shell)];
  }

  if (ext === ".go") {
    return [StreamLanguage.define(go)];
  }

  if (ext === ".rb") {
    return [StreamLanguage.define(ruby)];
  }

  if (ext === ".java") {
    return [java()];
  }

  if (ext === ".php") {
    return [php()];
  }

  if (ext === ".rs") {
    return [rust()];
  }

  return [];
}

const lightEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#101828",
    fontSize: "14px",
  },
  ".cm-content": {
    caretColor: "#101828",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
    lineHeight: "1.5rem",
    minHeight: "680px",
    padding: "20px 0",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    borderRight: "1px solid #e4e9f2",
    color: "#667085",
  },
  ".cm-line": {
    padding: "0 20px",
  },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
    minHeight: "680px",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#101828",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "rgb(191 219 254 / 0.72)",
    },
});

function sortTreeNodes(nodes: FileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  for (const node of nodes) {
    sortTreeNodes(node.children);
  }
}

function buildFileTree(files: SourceFile[]) {
  const root: FileTreeNode = {
    children: [],
    id: "",
    name: "",
    type: "folder",
  };
  const folders = new Map<string, FileTreeNode>([["", root]]);
  const folderPaths: string[] = [];

  files.forEach((file, fileIndex) => {
    const parts = file.name.split("/").filter(Boolean);
    const fileName = parts.at(-1) ?? file.name;
    let parent = root;
    let currentPath = "";

    for (const folderName of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      let folder = folders.get(currentPath);

      if (!folder) {
        folder = {
          children: [],
          id: currentPath,
          name: folderName,
          type: "folder",
        };
        folders.set(currentPath, folder);
        folderPaths.push(currentPath);
        parent.children.push(folder);
      }

      parent = folder;
    }

    parent.children.push({
      children: [],
      fileIndex,
      id: file.name,
      name: fileName,
      type: "file",
    });
  });

  sortTreeNodes(root.children);

  return { folderPaths, tree: root.children };
}

function HighlightedCodeEditor({
  fileName,
  onChange,
  value,
}: {
  fileName: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [isDark, setIsDark] = useState(false);
  const extensions = useMemo(
    () => editorLanguageExtensions(fileName),
    [fileName],
  );

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    const observer = new MutationObserver(updateTheme);

    updateTheme();
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="code-editor-shell bg-white dark:bg-[#0b1220]">
      <CodeMirror
        aria-label={`Edit ${fileName}`}
        basicSetup={{
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          highlightSelectionMatches: true,
          lineNumbers: true,
        }}
        extensions={extensions}
        height="680px"
        onChange={onChange}
        theme={isDark ? oneDark : lightEditorTheme}
        value={value}
      />
    </div>
  );
}

function dependencyHints(files: SourceFile[]) {
  const manifests = files.filter((file) =>
    [
      "package.json",
      "requirements.txt",
      "pyproject.toml",
      "go.mod",
      "pom.xml",
      "build.gradle",
      "composer.json",
      "Cargo.toml",
    ].some((manifest) => file.name.endsWith(manifest)),
  );
  const dependencies: Array<{ file: string; name: string; version: string }> =
    [];

  for (const file of manifests) {
    if (file.name.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(file.content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const [name, version] of Object.entries(
          parsed.dependencies ?? {},
        )) {
          dependencies.push({ file: file.name, name, version });
        }
        for (const [name, version] of Object.entries(
          parsed.devDependencies ?? {},
        )) {
          dependencies.push({
            file: file.name,
            name,
            version: `${version} dev`,
          });
        }
      } catch {
        dependencies.push({
          file: file.name,
          name: "package.json",
          version: "Could not parse",
        });
      }
      continue;
    }

    if (file.name.endsWith("requirements.txt")) {
      for (const line of file.content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
          continue;
        }
        const [name, ...rest] = trimmed.split(/[=<>~!]+/);
        dependencies.push({
          file: file.name,
          name: name.trim(),
          version: rest.join("").trim() || "unpinned",
        });
      }
      continue;
    }

    if (file.name.endsWith("go.mod")) {
      const matches = file.content.matchAll(
        /^\s*([A-Za-z0-9_.\-/]+)\s+(v[^\s]+)/gm,
      );
      for (const match of matches) {
        dependencies.push({
          file: file.name,
          name: match[1] ?? "",
          version: match[2] ?? "",
        });
      }
      continue;
    }

    dependencies.push({
      file: file.name,
      name: file.name.split("/").at(-1) ?? file.name,
      version: "Manifest detected",
    });
  }

  return { dependencies: dependencies.slice(0, 18), manifests };
}

function PackageInsights({
  codeSize,
  files,
  runtime,
}: {
  codeSize: string;
  files: SourceFile[];
  runtime: string;
}) {
  const { dependencies, manifests } = useMemo(
    () => dependencyHints(files),
    [files],
  );
  const sourceCount = files.filter((file) =>
    sourceFileExtensions.has(extension(file.name)),
  ).length;
  const configCount = files.filter((file) =>
    [".json", ".yaml", ".yml", ".toml", ".xml"].includes(extension(file.name)),
  ).length;
  const dependencyRows: SimpleTableRow[] = dependencies.map(
    (dependency, index) => ({
      key: `${dependency.file}-${dependency.name}-${index}`,
      cells: [
        <span className="font-black text-[#101828] dark:text-white" key="name">
          {dependency.name}
        </span>,
        <span
          className="font-semibold text-[#475467] dark:text-[#cbd5e1]"
          key="version"
        >
          {dependency.version}
        </span>,
        <ConsoleMonoText key="source">{dependency.file}</ConsoleMonoText>,
      ],
    }),
  );

  return (
    <div className="grid gap-4 border-t border-[#e4e9f2] bg-[#f8fafc] p-4 dark:border-white/10 dark:bg-[#07111f] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <ConsoleInsetPanel className="bg-white p-4 dark:bg-[#0b1220]">
        <div className="flex items-start gap-3">
          <ConsoleIconTile
            className="bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]"
            size="sm"
          >
            <PackageSearch className="size-4" />
          </ConsoleIconTile>
          <div>
            <h3 className="text-sm font-black text-[#101828] dark:text-white">
              Package insight
            </h3>
            <p className="mt-1 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
              Runtime {runtime || "-"} · Package {codeSize || "-"}
            </p>
          </div>
        </div>
        <CompactFactList
          className="mt-4"
          columns={3}
          items={[
            { label: "Files", value: files.length },
            { label: "Source", value: sourceCount },
            { label: "Config", value: configCount },
          ]}
          valueClassName="text-xl"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {manifests.length ? (
            manifests.map((manifest) => (
              <ConsolePill
                icon={<ShieldCheck className="size-3.5" />}
                key={manifest.name}
                tone="good"
              >
                {manifest.name.split("/").at(-1)}
              </ConsolePill>
            ))
          ) : (
            <ConsolePill tone="warn">
              No dependency manifest detected
            </ConsolePill>
          )}
        </div>
      </ConsoleInsetPanel>

      <ConsoleInsetPanel className="bg-white p-4 dark:bg-[#0b1220]">
        <h3 className="text-sm font-black text-[#101828] dark:text-white">
          Dependencies
        </h3>
        <SimpleTable
          className="mt-3 max-h-56 rounded-lg border border-[#e4e9f2] dark:border-white/10"
          columns={[
            {
              header: "Name",
              className: "px-3 py-2",
              headerClassName: "px-3 py-2",
            },
            {
              header: "Version",
              className: "px-3 py-2",
              headerClassName: "px-3 py-2",
            },
            {
              header: "Source",
              className: "px-3 py-2",
              headerClassName: "px-3 py-2",
            },
          ]}
          emptyState={
            <ConsoleInsetPanel
              className="rounded-lg p-4 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]"
              dashed
            >
              No dependencies could be inferred from the previewable package
              files.
            </ConsoleInsetPanel>
          }
          minWidthClassName="min-w-[520px]"
          rows={dependencyRows}
        />
      </ConsoleInsetPanel>
    </div>
  );
}

export function FunctionGraphCodeViewer({
  codeFile,
  codePayload,
  codeSize,
  codeText,
  codeType,
  handler,
  functionId,
  projectId,
  runtime,
}: {
  codeFile: string;
  codePayload: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  functionId: string;
  handler: string;
  projectId: string;
  runtime: string;
}) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [codePackage, setCodePackage] = useState<FunctionPackage | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [status, setStatus] = useState("Loading code package in browser...");
  const normalizedType = codeType.toLowerCase();
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  useEffect(() => {
    let cancelled = false;

    async function loadCode() {
      setStatus("Loading code from FunctionGraph...");
      setCodePackage(null);
      let nextCodeFile = codeFile;
      let nextCodePayload = codePayload;
      let nextCodeText = codeText;
      let nextCodeType = normalizedType;
      let loadError = "";

      try {
        const params = new URLSearchParams();
        if (projectId) {
          params.set("projectId", projectId);
        }
        const query = params.toString();
        const response = await fetch(
          `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/code${query ? `?${query}` : ""}`,
          { cache: "no-store" },
        );
        const body = (await response
          .json()
          .catch(() => ({}))) as FunctionGraphCodeResponse;

        if (!response.ok) {
          loadError =
            body.error ||
            `FunctionGraph code request returned ${response.status}.`;
        } else {
          nextCodeFile = body.codeFile ?? nextCodeFile;
          nextCodePayload = body.codePayload ?? nextCodePayload;
          nextCodeText = body.codeText ?? nextCodeText;
          nextCodeType = (body.codeType ?? nextCodeType).toLowerCase();
        }
      } catch (error) {
        loadError =
          error instanceof Error
            ? error.message
            : "Unable to contact the FunctionGraph code endpoint.";
      }

      if (cancelled) {
        return;
      }

      try {
        if (loadError) throw new Error(loadError);
        const pkg = readFunctionPackage({
          codeFile: nextCodeFile,
          codePayload: nextCodePayload,
          codeText: nextCodeText,
          codeType: nextCodeType,
          handler,
        });
        const previewFiles = previewFunctionPackage(pkg);
        if (!cancelled) {
          setCodePackage(pkg);
          setFiles(previewFiles);
          setDrafts(
            Object.fromEntries(
              previewFiles.map((file) => [file.name, file.content]),
            ),
          );
          setExpandedFolders(new Set(buildFileTree(previewFiles).folderPaths));
          setActiveFile(0);
          setSaveStatus("");
          setStatus(
            previewFiles.length
              ? ""
              : "No previewable text files were found in this package.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setCodePackage(null);
          setFiles([]);
          setDrafts({});
          setExpandedFolders(new Set());
          setStatus(
            error instanceof Error
              ? error.message
              : "Could not decode the function package safely.",
          );
        }
      }
    }

    void loadCode();

    return () => {
      cancelled = true;
    };
  }, [
    codeFile,
    codePayload,
    codeText,
    functionId,
    handler,
    normalizedType,
    projectId,
  ]);

  const active = files[activeFile];
  const activeContent = active ? (drafts[active.name] ?? active.content) : "";
  const hasDraftChanges = files.some(
    (file) => (drafts[file.name] ?? file.content) !== file.content,
  );
  const dirtyFileCount = files.filter(
    (file) => (drafts[file.name] ?? file.content) !== file.content,
  ).length;

  function resetDrafts(nextFiles = files) {
    setDrafts(
      Object.fromEntries(nextFiles.map((file) => [file.name, file.content])),
    );
  }

  async function saveCode() {
    if (!active || !codePackage || isSaving || !hasDraftChanges) {
      return;
    }

    const nextFiles = files.map((file) => ({
      ...file,
      content: drafts[file.name] ?? file.content,
    }));

    setIsSaving(true);
    setSaveStatus("Saving code...");

    try {
      const nextPackage = applySourceEdits(codePackage, drafts);
      const payload = serializeFunctionPackage(nextPackage);
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/code`,
        {
          body: JSON.stringify({
            ...payload,
            projectId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as FunctionGraphCodeUpdateResponse;

      if (!response.ok || !body.ok) {
        throw new Error(
          body.error ||
            `FunctionGraph code update returned ${response.status}.`,
        );
      }

      setCodePackage(nextPackage);
      setFiles(nextFiles);
      resetDrafts(nextFiles);
      setSaveStatus("Saved");
    } catch (error) {
      setSaveStatus(
        error instanceof Error
          ? error.message
          : "Unable to save FunctionGraph code.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCode();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function toggleFolder(folderId: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  }

  function fileIsDirty(file: SourceFile | undefined) {
    return Boolean(
      file && (drafts[file.name] ?? file.content) !== file.content,
    );
  }

  function nodeHasDirtyFile(node: FileTreeNode): boolean {
    if (node.type === "file") {
      return fileIsDirty(files[node.fileIndex ?? 0]);
    }

    return node.children.some(nodeHasDirtyFile);
  }

  function renderTreeNodes(nodes: FileTreeNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      if (node.type === "folder") {
        const expanded = expandedFolders.has(node.id);
        const FolderIcon = expanded ? FolderOpen : Folder;
        const isDirty = nodeHasDirtyFile(node);

        return (
          <div key={node.id}>
            <button
              aria-expanded={expanded}
              className="flex h-9 w-full min-w-0 items-center rounded-md pr-2 text-left font-mono text-xs font-black text-[#475467] transition hover:bg-[#eef2f7] hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white"
              onClick={() => toggleFolder(node.id)}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              title={node.id}
              type="button"
            >
              <ChevronRight
                className={`mr-1 size-3.5 shrink-0 transition-transform ${
                  expanded ? "rotate-90" : "rotate-0"
                }`}
              />
              <FolderIcon className="mr-1.5 size-3.5 shrink-0 text-[#f59e0b]" />
              <span className="truncate">{node.name}</span>
              {isDirty ? (
                <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[#f04438]" />
              ) : null}
            </button>
            {expanded ? (
              <div>{renderTreeNodes(node.children, depth + 1)}</div>
            ) : null}
          </div>
        );
      }

      const index = node.fileIndex ?? 0;
      const file = files[index];
      const FileIcon = fileIconFor(file?.name ?? node.name);
      const isDirty = fileIsDirty(file);

      return (
        <button
          aria-current={index === activeFile ? "page" : undefined}
          className={`flex h-9 w-full min-w-0 items-center rounded-md pr-2 text-left font-mono text-xs font-bold transition ${
            index === activeFile
              ? "bg-[#2563eb] text-white"
              : "text-[#475467] hover:bg-[#eef2f7] hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white"
          }`}
          key={node.id}
          onClick={() => setActiveFile(index)}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={file?.name ?? node.name}
          type="button"
        >
          <FileIcon className="mr-1.5 size-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
          {isDirty ? (
            <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[#f04438]" />
          ) : null}
        </button>
      );
    });
  }

  return (
    <ConsoleSurface
      actions={
        active ? (
          <ConsoleButton
            disabled={!codePackage || isSaving || !hasDraftChanges}
            onClick={saveCode}
            title="Save and deploy code (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save & deploy code
          </ConsoleButton>
        ) : null
      }
      description={`Type: ${codePackage?.codeType || codeType || "unknown"} · Size: ${codeSize} · Runtime: ${runtime || "-"}${codePackage ? ` · Previewing ${files.length} of ${codePackage.files.length} files` : ""}`}
      status={
        dirtyFileCount || saveStatus ? (
          <>
            {dirtyFileCount ? (
              <p className="text-xs font-black text-[#b54708] dark:text-[#fdba74]">
                {dirtyFileCount} unsaved{" "}
                {dirtyFileCount === 1 ? "file" : "files"}
              </p>
            ) : null}
            {saveStatus ? (
              <p className="flex items-center gap-1.5 text-xs font-bold text-[#667085] dark:text-[#98a2b3]">
                {saveStatus === "Saved" ? (
                  <Check className="size-3.5 text-[#12b76a]" />
                ) : null}
                {saveStatus}
              </p>
            ) : null}
          </>
        ) : null
      }
      title="Code"
    >
      {active ? (
        <div className="bg-[#f8fafc] dark:bg-[#0b1220]">
          {files.length > 1 ? (
            <ConsoleSidecarLayout
              className="min-h-[420px] border-t-0"
              columnsClassName={
                filesCollapsed
                  ? "lg:grid-cols-[56px_minmax(0,1fr)]"
                  : "lg:grid-cols-[260px_minmax(0,1fr)]"
              }
              contentClassName="bg-white p-0 dark:bg-[#0b1220]"
              sidebar={
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {filesCollapsed ? null : (
                      <span className="text-xs font-black uppercase tracking-[0.12em] text-[#667085] dark:text-[#98a2b3]">
                        Files
                      </span>
                    )}
                    <ConsoleIconButton
                      aria-label={
                        filesCollapsed
                          ? "Expand file sidebar"
                          : "Collapse file sidebar"
                      }
                      onClick={() => setFilesCollapsed((current) => !current)}
                      title={
                        filesCollapsed
                          ? "Expand file sidebar"
                          : "Collapse file sidebar"
                      }
                    >
                      <ChevronLeft
                        className={`size-4 transition-transform ${
                          filesCollapsed ? "rotate-180" : "rotate-0"
                        }`}
                      />
                    </ConsoleIconButton>
                  </div>
                  <div className="grid max-h-64 gap-1 overflow-auto lg:max-h-[680px]">
                    {filesCollapsed
                      ? files.map((file, index) => {
                          const FileIcon = fileIconFor(file.name);
                          const isDirty = fileIsDirty(file);

                          return (
                            <button
                              aria-current={
                                index === activeFile ? "page" : undefined
                              }
                              className={`relative grid h-9 place-items-center rounded-md transition ${
                                index === activeFile
                                  ? "bg-[#2563eb] text-white"
                                  : "text-[#475467] hover:bg-[#eef2f7] hover:text-[#101828] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white"
                              }`}
                              key={file.name}
                              onClick={() => setActiveFile(index)}
                              title={file.name}
                              type="button"
                            >
                              <FileIcon className="size-3.5" />
                              {isDirty ? (
                                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#f04438]" />
                              ) : null}
                            </button>
                          );
                        })
                      : renderTreeNodes(fileTree.tree)}
                  </div>
                </>
              }
            >
              <HighlightedCodeEditor
                fileName={active.name}
                onChange={(value) => {
                  setDrafts((current) => ({
                    ...current,
                    [active.name]: value,
                  }));
                  setSaveStatus("");
                }}
                value={activeContent}
              />
            </ConsoleSidecarLayout>
          ) : (
            <div className="bg-white dark:bg-[#0b1220]">
              <HighlightedCodeEditor
                fileName={active.name}
                onChange={(value) => {
                  setDrafts((current) => ({
                    ...current,
                    [active.name]: value,
                  }));
                  setSaveStatus("");
                }}
                value={activeContent}
              />
            </div>
          )}
          <PackageInsights
            codeSize={codeSize}
            files={files}
            runtime={runtime}
          />
        </div>
      ) : (
        <div className="p-5">
          <ConsoleInsetPanel dashed title="Code preview unavailable">
            {status}
          </ConsoleInsetPanel>
        </div>
      )}
    </ConsoleSurface>
  );
}
