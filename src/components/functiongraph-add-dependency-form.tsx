"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus } from "lucide-react";

import {
  CompactFactList,
  ConsoleButton,
  ConsoleCallout,
  ConsoleField,
  ConsoleFormFieldGrid,
  ConsoleFormActions,
  ConsoleFormLayout,
  ConsoleFormSummaryCard,
  ConsoleInput,
  ConsolePanel,
  ConsolePanelBody,
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

export function FunctionGraphAddDependencyForm({
  functions,
}: {
  functions: DependencyFunctionOption[];
}) {
  const router = useRouter();
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

      router.push(`/services/functiongraph/${encodeURIComponent(selectedFunction.id)}`);
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
    <ConsoleFormLayout>
      <ConsoleFormSummaryCard
        description="Updates the selected function package manifest, uploads the new code package, and returns to the function."
        icon={<PackagePlus className="size-6" />}
        iconClassName="bg-[#fdf2f8] text-[#be185d]"
        title="Add package dependency"
      >
        <CompactFactList
          className="mt-5"
          items={[
            { label: "Function", value: selectedFunction?.name ?? "-" },
            { label: "Runtime", value: selectedFunction?.runtime ?? "-" },
            { label: "Manifest", value: manifestType },
          ]}
        />
      </ConsoleFormSummaryCard>

      <ConsolePanel
        description="Python dependencies are written to requirements.txt. Node dependencies are written to package.json."
        title="Dependency details"
      >
        <ConsolePanelBody>
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

          <ConsoleFormFieldGrid>
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

            <ConsoleField className="font-black text-[#344054]" label="Version">
              <ConsoleInput
                className="border-[#d0d5dd]"
                focusTone="rose"
                onChange={(event) => setVersion(event.target.value)}
                placeholder={manifestType === "package.json" ? "^4.17.21" : ">=10.0.0"}
                value={version}
              />
            </ConsoleField>
          </ConsoleFormFieldGrid>

          <ConsoleField className="font-black text-[#344054]" label="Dependency">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="rose"
              onChange={(event) => setDependencyName(event.target.value)}
              placeholder={manifestType === "package.json" ? "lodash" : "Pillow"}
              value={dependencyName}
            />
          </ConsoleField>

          {status ? <ConsoleCallout>{status}</ConsoleCallout> : null}
        </ConsolePanelBody>

        <ConsoleFormActions
          actions={
            <ConsoleButton
              className="border-[#be185d] bg-[#be185d] font-black hover:bg-[#9d174d] disabled:bg-[#98a2b3]"
              disabled={!dependencyName.trim() || saving || !selectedFunction}
              onClick={submit}
              size="md"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              Add dependency
            </ConsoleButton>
          }
          align="end"
        />
      </ConsolePanel>
    </ConsoleFormLayout>
  );
}
