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

type DeleteImageResponse = {
  error?: string;
  ok?: boolean;
};

export function DeleteImsImageButton({
  imageId,
  imageName,
  imageType,
  isProtected,
  projectId,
  status,
  visibility,
}: {
  imageId: string;
  imageName: string;
  imageType: string;
  isProtected: boolean;
  projectId: string;
  status: string;
  visibility: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const normalizedType = imageType.toLowerCase();
  const normalizedVisibility = visibility.toLowerCase();
  const canDelete =
    !isProtected &&
    (normalizedType === "private" || normalizedVisibility === "private");
  const confirmationMatches = useMemo(
    () => confirmName.trim() === imageName,
    [confirmName, imageName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/ims/images/${encodeURIComponent(imageId)}`,
      {
        body: JSON.stringify({ confirmName, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as DeleteImageResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Image deletion failed.");
      setPending(false);
      return;
    }

    setMessage("Image deletion submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        disabled={!canDelete}
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        title={
          canDelete
            ? "Delete private image"
            : "Only unprotected private images can be deleted here."
        }
        variant="dangerOutline"
      >
        <Trash2 className="size-3.5" />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>This permanently deletes the private image {imageName}.</>}
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                Public, shared, marketplace, and protected images are blocked.
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
          title="Delete IMS image"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleDescriptionList
                items={[
                  { label: "Image ID", value: imageId },
                  { label: "Project", value: projectId },
                  { label: "Status", value: status },
                ]}
                tone="danger"
              />
              <ConsoleField label="Type the image name to confirm">
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
