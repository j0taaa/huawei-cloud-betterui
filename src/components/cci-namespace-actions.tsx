"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleDescriptionList,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalMessage,
} from "@/components/console-ui";

type DeleteNamespaceResponse = {
  error?: string;
  ok?: boolean;
};

export function DeleteCciNamespaceButton({
  canDelete,
  namespaceId,
  namespaceName,
  projectId,
  resourceSummary,
  variant = "table",
}: {
  canDelete: boolean;
  namespaceId: string;
  namespaceName: string;
  projectId: string;
  resourceSummary: string;
  variant?: "hero" | "table";
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === namespaceName,
    [confirmName, namespaceName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/cci/namespaces/${encodeURIComponent(namespaceId)}`,
      {
        body: JSON.stringify({ confirmName, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as DeleteNamespaceResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Namespace deletion failed.");
      setPending(false);
      return;
    }

    setMessage("Namespace deletion submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className={variant === "table" ? "text-xs font-black" : undefined}
        disabled={!canDelete}
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        title={
          canDelete
            ? "Delete empty CCI namespace"
            : "Only empty CCI namespaces can be deleted from this UI."
        }
        size={variant === "hero" ? "lg" : "sm"}
        variant="dangerOutline"
      >
        <Trash2 className={variant === "hero" ? "size-4" : "size-3.5"} />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          closeLabel="Close delete dialog"
          description={<>This submits a namespace delete request for {namespaceName}.</>}
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                Namespaces with resources are blocked before the API call.
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
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          onClose={() => setOpen(false)}
          title="Delete CCI namespace"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleDescriptionList
                items={[
                  { label: "Namespace ID", value: namespaceId },
                  { label: "Project", value: projectId },
                  { label: "Resources", value: resourceSummary },
                ]}
                tone="danger"
              />
              <ConsoleField label="Type the namespace name to confirm">
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
