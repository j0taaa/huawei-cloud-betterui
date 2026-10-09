"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus, Loader2, Trash2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleConfirmSummary,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalFooterNote,
  ConsoleModalMessage,
  ConsoleSelect,
} from "@/components/console-ui";

type SmnProjectOption = {
  label: string;
  value: string;
};

type SmnActionResponse = {
  error?: string;
  requestId?: string | null;
  topicUrn?: string | null;
};

export function CreateSmnTopicButton({
  projects,
}: {
  projects: SmnProjectOption[];
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const validName = /^[a-zA-Z0-9_-]{1,255}$/.test(name.trim());

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/smn/topics", {
      body: JSON.stringify({ displayName, name, projectId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as SmnActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Topic creation failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.topicUrn
        ? `Topic created: ${result.topicUrn}`
        : result.requestId
          ? `Topic creation accepted: ${result.requestId}`
          : "Topic created.",
    );
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
        variant="orange"
      >
        <BellPlus className="size-4" />
        Create topic
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Creates a notification topic for alarm, event, and workflow delivery."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Subscriptions are added after the topic exists.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !validName}
                  onClick={submit}
                  size="md"
                  variant="orange"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <BellPlus className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-xl"
          onClose={() => setOpen(false)}
          title="Create SMN topic"
        >
            <ConsoleModalBody>
              <ConsoleField
                helpText="Letters, numbers, underscores, and hyphens only."
                label="Topic name"
              >
                <ConsoleInput
                  focusTone="orange"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </ConsoleField>
              <ConsoleField label="Display name">
                <ConsoleInput
                  focusTone="orange"
                  onChange={(event) => setDisplayName(event.target.value)}
                  value={displayName}
                />
              </ConsoleField>
              <ConsoleField label="Project">
                <ConsoleSelect
                  focusTone="orange"
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
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="orange">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteSmnTopicButton({
  projectId,
  topicName,
  topicUrn,
}: {
  projectId: string;
  topicName: string;
  topicUrn: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === topicName,
    [confirmName, topicName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/smn/topics/${encodeURIComponent(topicUrn)}`,
      {
        body: JSON.stringify({ confirmName, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as SmnActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Topic deletion failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.requestId ? `Topic deletion accepted: ${result.requestId}` : "Topic deleted.",
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        size="sm"
        variant="dangerOutline"
      >
        <Trash2 className="size-3.5" />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="This removes the topic and its notification routing."
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                Delete is irreversible.
              </p>
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
          onClose={() => setOpen(false)}
          title="Delete SMN topic"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleConfirmSummary>
                {topicUrn}
              </ConsoleConfirmSummary>
              <ConsoleField label="Type the topic name to confirm">
                <ConsoleInput
                  className="border-[#fda29b]"
                  focusTone="danger"
                  onChange={(event) => setConfirmName(event.target.value)}
                  value={confirmName}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="danger">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
