"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";

import {
  ConsoleActionStack,
  ConsoleButton,
  ConsoleCallout,
  ConsoleField,
  ConsoleInput,
  ConsoleInsetPanel,
  ConsoleTextarea,
} from "@/components/console-ui";

type ResourceKind = "security-groups" | "subnets" | "vpcs";

export function NetworkResourceActions({
  description = "",
  id,
  kind,
  name,
  projectId,
  vpcId,
}: {
  description?: string;
  id: string;
  kind: ResourceKind;
  name: string;
  projectId?: string;
  vpcId?: string;
}) {
  const router = useRouter();
  const [draftDescription, setDraftDescription] = useState(description);
  const [draftName, setDraftName] = useState(name);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"delete" | "save" | null>(null);

  async function save() {
    if (!draftName.trim()) {
      setMessage("Name is required.");
      return;
    }

    setPending("save");
    setMessage("");

    const response = await fetch(`/api/cloud/network/${kind}/${id}`, {
      body: JSON.stringify({
        description: draftDescription.trim(),
        name: draftName.trim(),
        projectId,
        vpcId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    setPending(null);

    if (!response.ok) {
      setMessage(result.error ?? "Update failed.");
      return;
    }

    setEditing(false);
    setMessage("Changes saved.");
    router.refresh();
  }

  async function deleteResource() {
    const confirmation = window.prompt(
      `Type ${name} to delete this ${resourceLabel(kind)}.`,
    );

    if (confirmation !== name) {
      return;
    }

    setPending("delete");
    setMessage("");

    const response = await fetch(`/api/cloud/network/${kind}/${id}`, {
      body: JSON.stringify({ confirmName: name, projectId, vpcId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    setPending(null);

    if (!response.ok) {
      setMessage(result.error ?? "Delete failed.");
      return;
    }

    router.push("/services/network");
    router.refresh();
  }

  return (
    <ConsoleActionStack gap="md">
      <div className="flex flex-wrap gap-2">
        <ConsoleButton
          disabled={!!pending}
          onClick={() => setEditing((value) => !value)}
          size="lg"
          variant="neutral"
        >
          <Pencil className="size-4" />
          Edit
        </ConsoleButton>
        <ConsoleButton
          disabled={!!pending}
          onClick={deleteResource}
          size="lg"
          variant="dangerOutline"
        >
          {pending === "delete" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete
        </ConsoleButton>
      </div>

      {editing ? (
        <ConsoleInsetPanel className="grid gap-3">
          <ConsoleField label="Name">
            <ConsoleInput
              onChange={(event) => setDraftName(event.target.value)}
              value={draftName}
            />
          </ConsoleField>
          {kind !== "subnets" ? (
            <ConsoleField label="Description">
              <ConsoleTextarea
                className="min-h-20"
                onChange={(event) => setDraftDescription(event.target.value)}
                value={draftDescription}
              />
            </ConsoleField>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <ConsoleButton
              disabled={!!pending}
              onClick={save}
              size="md"
            >
              {pending === "save" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Save
            </ConsoleButton>
            <ConsoleButton
              onClick={() => {
                setDraftDescription(description);
                setDraftName(name);
                setEditing(false);
                setMessage("");
              }}
              size="md"
              variant="neutral"
            >
              Cancel
            </ConsoleButton>
          </div>
        </ConsoleInsetPanel>
      ) : null}

      {message ? <ConsoleCallout>{message}</ConsoleCallout> : null}
    </ConsoleActionStack>
  );
}

function resourceLabel(kind: ResourceKind) {
  if (kind === "security-groups") {
    return "security group";
  }

  return kind.slice(0, -1);
}
