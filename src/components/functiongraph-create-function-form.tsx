"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, Loader2 } from "lucide-react";

import {
  CompactFactList,
  ConsoleButton,
  ConsoleField,
  ConsoleFormActions,
  ConsoleFormLayout,
  ConsoleFormSummaryCard,
  ConsoleInput,
  ConsoleModalMessage,
  ConsoleMutedText,
  ConsolePanel,
  ConsolePanelBody,
  ConsoleSelect,
  ConsoleTextarea,
} from "@/components/console-ui";

type ProjectOption = {
  label: string;
  value: string;
};

type CreateFunctionResponse = {
  error?: string;
  id?: string;
  name?: string;
  ok?: boolean;
  urn?: string;
};

const defaultPythonCode = `def handler(event, context):
    return {"message": "Hello from FunctionGraph", "event": event}
`;

const defaultNodeCode = `exports.handler = async (event, context) => ({ message: "Hello from FunctionGraph", event });
`;

export function FunctionGraphCreateFunctionForm({
  projects,
}: {
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(defaultPythonCode);
  const [description, setDescription] = useState("");
  const [handler, setHandler] = useState("index.handler");
  const [memorySize, setMemorySize] = useState("128");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [packageName, setPackageName] = useState("default");
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const [runtime, setRuntime] = useState("Python3.10");
  const [timeout, setTimeout] = useState("3");
  const validName = /^[A-Za-z][A-Za-z0-9_-]{0,58}[A-Za-z0-9]$|^[A-Za-z]$/.test(
    name.trim(),
  );

  async function submit() {
    if (pending || !validName) {
      return;
    }

    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/cloud/functiongraph/functions", {
        body: JSON.stringify({
          code,
          description,
          handler,
          memorySize: Number(memorySize),
          name,
          packageName,
          projectId,
          runtime,
          timeout: Number(timeout),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as CreateFunctionResponse;

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Function creation failed.");
      }

      router.push(`/services/functiongraph/${encodeURIComponent(result.id || result.urn || name)}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Function creation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ConsoleFormLayout>
      <ConsoleFormSummaryCard
        description="Create an inline-code event function, choose the runtime shape, and open it immediately after creation."
        icon={<Code2 className="size-6" />}
        iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
        title="New FunctionGraph function"
      >
        <CompactFactList
          className="mt-5"
          items={[
            { label: "Runtime", value: runtime },
            { label: "Memory", value: `${memorySize} MB` },
            { label: "Timeout", value: `${timeout}s` },
          ]}
        />
      </ConsoleFormSummaryCard>

      <ConsolePanel
        description="These fields map directly to the FunctionGraph creation API."
        title="Function details"
      >
        <ConsolePanelBody columns="lg-2">
          <ConsoleField className="font-black text-[#344054]" label="Function name">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => setName(event.target.value)}
              placeholder="betterui-demo"
              value={name}
            />
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054]" label="Package">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => setPackageName(event.target.value)}
              value={packageName}
            />
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054]" label="Runtime">
            <ConsoleSelect
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => {
                const nextRuntime = event.target.value;
                setRuntime(nextRuntime);
                setHandler("index.handler");
                setCode(nextRuntime.startsWith("Node.js") ? defaultNodeCode : defaultPythonCode);
              }}
              value={runtime}
            >
              <option value="Python3.10">Python 3.10</option>
              <option value="Python3.9">Python 3.9</option>
              <option value="Node.js18.15">Node.js 18.15</option>
              <option value="Node.js16.17">Node.js 16.17</option>
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054]" label="Handler">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => setHandler(event.target.value)}
              value={handler}
            />
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054]" label="Memory">
            <ConsoleSelect
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => setMemorySize(event.target.value)}
              value={memorySize}
            >
              {[128, 256, 512, 768, 1024, 1280, 1536, 2048, 2560, 3072, 4096].map((size) => (
                <option key={size} value={size}>
                  {size} MB
                </option>
              ))}
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054]" label="Timeout">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="purple"
              min={3}
              onChange={(event) => setTimeout(event.target.value)}
              type="number"
              value={timeout}
            />
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054] lg:col-span-2" label="Project">
            <ConsoleSelect
              className="border-[#d0d5dd]"
              focusTone="purple"
              onChange={(event) => setProjectId(event.target.value)}
              value={projectId}
            >
              {projects.map((project) => (
                <option key={project.value || "current"} value={project.value}>
                  {project.label}
                </option>
              ))}
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054] lg:col-span-2" label="Description">
            <ConsoleInput
              className="border-[#d0d5dd]"
              focusTone="purple"
              maxLength={512}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </ConsoleField>
          <ConsoleField className="font-black text-[#344054] lg:col-span-2" label="Inline code">
            <ConsoleTextarea
              className="min-h-80 border-[#d0d5dd] bg-[#0b1220] px-4 py-3 font-mono text-xs leading-5 text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]"
              focusTone="purple"
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
          </ConsoleField>
        </ConsolePanelBody>

        <ConsoleFormActions
          actions={
            <ConsoleButton
              className="font-black disabled:bg-[#98a2b3]"
              disabled={pending || !validName}
              onClick={submit}
              size="md"
              variant="purple"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Code2 className="size-4" />}
              Create function
            </ConsoleButton>
          }
        >
          <ConsoleMutedText>
            Inline source is uploaded as the initial function code package.
          </ConsoleMutedText>
        </ConsoleFormActions>
        {message ? <ConsoleModalMessage className="text-[#b42318]" tone="danger">{message}</ConsoleModalMessage> : null}
      </ConsolePanel>
    </ConsoleFormLayout>
  );
}
