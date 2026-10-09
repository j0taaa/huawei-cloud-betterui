"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, Loader2, Play, Plus, Trash2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleCodeBlock,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalFooterNote,
  ConsoleModalMessage,
  ConsoleSelect,
  ConsoleTextarea,
} from "@/components/console-ui";

type ProjectOption = {
  label: string;
  value: string;
};

type ActionResponse = {
  body?: unknown;
  error?: string;
  id?: string;
  log?: string;
  name?: string;
  requestId?: string;
  status?: number;
  summary?: string;
  urn?: string;
};

const defaultPythonCode = `def handler(event, context):
    return {"message": "Hello from FunctionGraph", "event": event}
`;

function PrettyResult({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);

  return (
    <ConsoleCodeBlock className="max-h-72 rounded-lg border-transparent bg-[#0b1220] p-3 text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]">
      {text}
    </ConsoleCodeBlock>
  );
}

export function CreateFunctionGraphFunctionButton({
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
  const [open, setOpen] = useState(false);
  const [packageName, setPackageName] = useState("default");
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const [runtime, setRuntime] = useState("Python3.10");
  const [timeout, setTimeout] = useState("3");
  const validName = /^[A-Za-z][A-Za-z0-9_-]{0,58}[A-Za-z0-9]$|^[A-Za-z]$/.test(
    name.trim(),
  );

  async function submit() {
    setPending(true);
    setMessage("");

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
    const result = (await response.json().catch(() => ({}))) as ActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Function creation failed.");
      setPending(false);
      return;
    }

    setMessage(result.name ? `Function created: ${result.name}` : "Function created.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        variant="purple"
      >
        <Plus className="size-4" />
        Create function
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Creates a small inline-code function in FunctionGraph."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Inline code is sent as a base64 payload to FunctionGraph.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !validName}
                  onClick={submit}
                  size="md"
                  variant="purple"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Code2 className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-4xl"
          onClose={() => setOpen(false)}
          panelClassName="max-h-[92vh] overflow-hidden border-[#ddd6fe]"
          title="Create event function"
        >
            <ConsoleModalBody className="max-h-[70vh] overflow-y-auto lg:grid-cols-2">
              <ConsoleField label="Function name">
                <ConsoleInput
                  focusTone="purple"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="betterui-demo"
                  value={name}
                />
              </ConsoleField>
              <ConsoleField label="Package">
                <ConsoleInput
                  focusTone="purple"
                  onChange={(event) => setPackageName(event.target.value)}
                  value={packageName}
                />
              </ConsoleField>
              <ConsoleField label="Runtime">
                <ConsoleSelect
                  focusTone="purple"
                  onChange={(event) => {
                    const nextRuntime = event.target.value;
                    setRuntime(nextRuntime);
                    if (nextRuntime.startsWith("Node.js")) {
                      setHandler("index.handler");
                      setCode(`exports.handler = async (event, context) => ({ message: "Hello from FunctionGraph", event });
`);
                    } else {
                      setHandler("index.handler");
                      setCode(defaultPythonCode);
                    }
                  }}
                  value={runtime}
                >
                  <option value="Python3.10">Python 3.10</option>
                  <option value="Python3.9">Python 3.9</option>
                  <option value="Node.js18.15">Node.js 18.15</option>
                  <option value="Node.js16.17">Node.js 16.17</option>
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Handler">
                <ConsoleInput
                  focusTone="purple"
                  onChange={(event) => setHandler(event.target.value)}
                  value={handler}
                />
              </ConsoleField>
              <ConsoleField label="Memory">
                <ConsoleSelect
                  focusTone="purple"
                  onChange={(event) => setMemorySize(event.target.value)}
                  value={memorySize}
                >
                  {[128, 256, 512, 1024, 2048, 3072, 4096].map((size) => (
                    <option key={size} value={size}>
                      {size} MB
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Timeout">
                <ConsoleInput
                  focusTone="purple"
                  min={3}
                  onChange={(event) => setTimeout(event.target.value)}
                  type="number"
                  value={timeout}
                />
              </ConsoleField>
              <ConsoleField className="lg:col-span-2" label="Project">
                <ConsoleSelect
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
              <ConsoleField className="lg:col-span-2" label="Description">
                <ConsoleInput
                  focusTone="purple"
                  maxLength={512}
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
                />
              </ConsoleField>
              <ConsoleField className="lg:col-span-2" label="Inline code">
                <ConsoleTextarea
                  className="min-h-56 bg-[#0b1220] font-mono text-xs leading-5 text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]"
                  focusTone="purple"
                  onChange={(event) => setCode(event.target.value)}
                  value={code}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="purple">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function InvokeFunctionGraphFunctionButton({
  functionId,
  projectId,
  size = "md",
}: {
  functionId: string;
  projectId: string;
  size?: "sm" | "md";
}) {
  const [event, setEvent] = useState('{\n  "message": "hello"\n}');
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResponse | null>(null);
  const validJson = useMemo(() => {
    try {
      JSON.parse(event || "{}");
      return true;
    } catch {
      return false;
    }
  }, [event]);

  async function submit() {
    setPending(true);
    setMessage("");
    setResult(null);

    const response = await fetch(
      `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/invoke`,
      {
        body: JSON.stringify({ event, includeLogs: true, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    const payload = (await response.json().catch(() => ({}))) as ActionResponse;

    if (!response.ok) {
      setMessage(payload.error ?? "Invocation failed.");
      setPending(false);
      return;
    }

    setResult(payload);
    setPending(false);
  }

  return (
    <>
      <ConsoleButton
        className={size === "sm" ? "text-xs" : undefined}
        onClick={() => {
          setMessage("");
          setResult(null);
          setOpen(true);
        }}
        size={size === "sm" ? "sm" : "lg"}
        variant="success"
      >
        <Play className={size === "sm" ? "size-3.5" : "size-4"} />
        Invoke
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Runs a synchronous test event and returns the response body and tail logs."
          footer={(
            <>
              <ConsoleModalFooterNote>
                The event is sent directly to the selected FunctionGraph function.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Close
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !validJson}
                  onClick={submit}
                  size="md"
                  variant="success"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Invoke
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-3xl"
          onClose={() => setOpen(false)}
          panelClassName="overflow-hidden border-[#bbf7d0]"
          title="Invoke function"
        >
            <ConsoleModalBody>
              <ConsoleField label="Event JSON">
                <ConsoleTextarea
                  className="min-h-44 bg-[#0b1220] font-mono text-xs leading-5 text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]"
                  focusTone="success"
                  onChange={(event) => setEvent(event.target.value)}
                  value={event}
                />
              </ConsoleField>
              {result ? (
                <div className="grid gap-3">
                  <ConsoleCallout className="rounded-lg p-3" tone="success">
                    Status {result.status ?? 200}
                    {result.requestId ? ` · Request ${result.requestId}` : ""}
                    {result.summary ? ` · ${result.summary}` : ""}
                  </ConsoleCallout>
                  <PrettyResult value={result.body} />
                  {result.log ? (
                    <ConsoleCodeBlock className="max-h-48 rounded-lg p-3">
                      {result.log}
                    </ConsoleCodeBlock>
                  ) : null}
                </div>
              ) : null}
            </ConsoleModalBody>
            {message ? (
              <ConsoleModalMessage className="text-[#b42318] dark:text-[#fecdd3]" tone="success">
                {message}
              </ConsoleModalMessage>
            ) : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteFunctionGraphFunctionButton({
  functionId,
  functionName,
  projectId,
  size = "sm",
}: {
  functionId: string;
  functionName: string;
  projectId: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === functionName,
    [confirmName, functionName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/functiongraph/${encodeURIComponent(functionId)}`,
      {
        body: JSON.stringify({ confirmName, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as ActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Function deletion failed.");
      setPending(false);
      return;
    }

    setMessage(result.name ? `Function deleted: ${result.name}` : "Function deleted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className={size === "sm" ? "text-xs font-black" : "font-black"}
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        size={size}
        variant="dangerOutline"
      >
        <Trash2 className={size === "sm" ? "size-3.5" : "size-4"} />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="This deletes the function and its versions, aliases, and triggers."
          footer={(
            <>
              <ConsoleModalFooterNote>This action cannot be undone.</ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !confirmationMatches}
                  onClick={submit}
                  size="md"
                  variant="danger"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-xl"
          onClose={() => setOpen(false)}
          title="Delete function"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleCallout>
                Type <span className="font-mono">{functionName}</span> to confirm deletion.
              </ConsoleCallout>
              <ConsoleField label={`Type ${functionName}`}>
                <ConsoleInput
                  focusTone="danger"
                  onChange={(event) => setConfirmName(event.target.value)}
                  value={confirmName}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? (
              <ConsoleModalMessage className="text-[#b42318] dark:text-[#fecdd3]" tone="danger">
                {message}
              </ConsoleModalMessage>
            ) : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
