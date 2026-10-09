"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus } from "lucide-react";

import {
  ConsoleButton,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalMessage,
  ConsoleSelect,
} from "@/components/console-ui";

type DependencyFunctionOption = {
  id: string;
  name: string;
  packageName: string;
  projectId: string;
  projectName: string;
  runtime: string;
};

type DependencyUpdateResponse = {
  error?: string;
  ok?: boolean;
};

function defaultManifestType(runtime: string) {
  return /node/i.test(runtime) ? "package.json" : "requirements.txt";
}

export function FunctionGraphAddDependencyButton({
  functions,
}: {
  functions: DependencyFunctionOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [functionId, setFunctionId] = useState(functions[0]?.id ?? "");
  const selectedFunction = functions.find((fn) => fn.id === functionId) ?? functions[0];
  const inferredManifest = useMemo(
    () => defaultManifestType(selectedFunction?.runtime ?? ""),
    [selectedFunction?.runtime],
  );
  const [manifestType, setManifestType] = useState<"requirements.txt" | "package.json">(
    inferredManifest,
  );
  const [dependencyName, setDependencyName] = useState("");
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  function updateFunction(nextFunctionId: string) {
    const nextFunction = functions.find((fn) => fn.id === nextFunctionId);
    setFunctionId(nextFunctionId);
    setManifestType(defaultManifestType(nextFunction?.runtime ?? ""));
  }

  async function submit() {
    if (!selectedFunction || !dependencyName.trim() || saving) {
      return;
    }

    setSaving(true);
    setStatus("Adding dependency...");

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(selectedFunction.id)}/dependencies`,
        {
          body: JSON.stringify({
            dependencyName,
            manifestType,
            projectId: selectedFunction.projectId,
            version,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json().catch(() => ({}))) as DependencyUpdateResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error || `FunctionGraph dependency update returned ${response.status}.`);
      }

      setDependencyName("");
      setVersion("");
      setStatus("Dependency added.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to add FunctionGraph dependency.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ConsoleButton
        className="font-black disabled:bg-[#98a2b3]"
        disabled={!functions.length}
        onClick={() => {
          setManifestType(inferredManifest);
          setOpen(true);
        }}
        size="md"
      >
        <PackagePlus className="size-4" />
        Add dependency
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Updates the selected function package manifest and redeploys the code package."
          footer={(
            <ConsoleModalActions className="w-full">
              <ConsoleButton
                className="font-black"
                onClick={() => setOpen(false)}
                size="md"
                variant="neutral"
              >
                Cancel
              </ConsoleButton>
              <ConsoleButton
                className="font-black disabled:bg-[#98a2b3]"
                disabled={!dependencyName.trim() || saving}
                onClick={submit}
                size="md"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
                Add dependency
              </ConsoleButton>
            </ConsoleModalActions>
          )}
          maxWidthClassName="max-w-xl"
          onClose={() => setOpen(false)}
          panelClassName="overflow-hidden"
          title="Add code dependency"
        >
            <ConsoleModalBody>
              <ConsoleField className="font-black text-[#344054]" label="Function">
                <ConsoleSelect
                  className="border-[#d0d5dd]"
                  focusTone="rose"
                  onChange={(event) => updateFunction(event.target.value)}
                  value={selectedFunction?.id ?? ""}
                >
                  {functions.map((fn) => (
                    <option key={`${fn.projectId}:${fn.id}`} value={fn.id}>
                      {fn.name} · {fn.runtime} · {fn.projectName}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>

              <ConsoleField className="font-black text-[#344054]" label="Manifest">
                <ConsoleSelect
                  className="border-[#d0d5dd]"
                  focusTone="rose"
                  onChange={(event) =>
                    setManifestType(event.target.value as "requirements.txt" | "package.json")
                  }
                  value={manifestType}
                >
                  <option value="requirements.txt">requirements.txt</option>
                  <option value="package.json">package.json</option>
                </ConsoleSelect>
              </ConsoleField>

              <ConsoleField className="font-black text-[#344054]" label="Dependency">
                <ConsoleInput
                  className="border-[#d0d5dd]"
                  focusTone="rose"
                  onChange={(event) => setDependencyName(event.target.value)}
                  placeholder={manifestType === "package.json" ? "lodash" : "Pillow"}
                  value={dependencyName}
                />
              </ConsoleField>

              <ConsoleField className="font-black text-[#344054]" label="Version">
                <ConsoleInput
                  className="border-[#d0d5dd]"
                  focusTone="rose"
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder={manifestType === "package.json" ? "^4.17.21" : ">=10.0.0"}
                  value={version}
                />
              </ConsoleField>

              {status ? (
                <ConsoleModalMessage className="rounded-lg border p-3 text-[#667085]" tone="rose">
                  {status}
                </ConsoleModalMessage>
              ) : null}
            </ConsoleModalBody>
        </ConsoleModal>
      ) : null}
    </>
  );
}
