"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Loader2, Trash2, UploadCloud } from "lucide-react";

import { ConsoleActionFeedback, ConsoleActionStack, ConsoleButton } from "@/components/console-ui";

export function UploadObsObjectButton({
  bucket,
  prefix = "",
}: {
  bucket: string;
  prefix?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    const defaultKey = `${prefix}${file.name}`;
    const key = window.prompt("Object key:", defaultKey);

    if (!key) {
      inputRef.current!.value = "";
      return;
    }

    const formData = new FormData();
    formData.set("bucket", bucket);
    formData.set("key", key);
    formData.set("file", file);
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/obs/objects", {
      body: formData,
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    inputRef.current!.value = "";

    if (!response.ok) {
      setMessage(result.error ?? "Object upload failed.");
      setPending(false);
      return;
    }

    setMessage(`Uploaded ${key}.`);
    setPending(false);
    router.refresh();
  }

  return (
    <ConsoleActionStack gap="xs">
      <input
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void upload(file);
          }
        }}
        ref={inputRef}
        type="file"
      />
      <ConsoleButton
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        size="md"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
        Upload object
      </ConsoleButton>
      {message ? <ConsoleActionFeedback size="xs">{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}

export function CreateObsFolderButton({
  bucket,
  prefix = "",
}: {
  bucket: string;
  prefix?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function createFolder() {
    const name = window.prompt("Folder name:");

    if (!name?.trim()) {
      return;
    }

    const key = `${prefix}${name.trim().replace(/^\/+/, "")}`;
    const formData = new FormData();
    formData.set("bucket", bucket);
    formData.set("key", key);
    formData.set("createFolder", "true");
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/obs/objects", {
      body: formData,
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Folder creation failed.");
      setPending(false);
      return;
    }

    setMessage(`Created ${key.endsWith("/") ? key : `${key}/`}.`);
    setPending(false);
    router.refresh();
  }

  return (
    <ConsoleActionStack gap="xs">
      <ConsoleButton
        disabled={pending}
        onClick={() => void createFolder()}
        size="md"
        variant="neutral"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
        New folder
      </ConsoleButton>
      {message ? <ConsoleActionFeedback size="xs">{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}

export function DeleteObsObjectButton({
  bucket,
  objectKey,
  redirectTo,
  small = false,
}: {
  bucket: string;
  objectKey: string;
  redirectTo?: string;
  small?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function deleteObject() {
    if (!window.confirm(`Delete object ${objectKey}?`)) {
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/obs/objects?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(objectKey)}`,
      { method: "DELETE" },
    );
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Object deletion failed.");
      setPending(false);
      return;
    }

    setPending(false);

    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
      return;
    }

    setMessage("Deleted.");
    router.refresh();
  }

  return (
    <ConsoleActionStack gap="xs">
      <ConsoleButton
        className={small ? "text-xs font-black" : undefined}
        disabled={pending}
        onClick={() => void deleteObject()}
        size={small ? "sm" : "md"}
        variant="dangerOutline"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        Delete
      </ConsoleButton>
      {message ? <ConsoleActionFeedback size="xs" tone="danger">{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}

export function DeleteObsBucketButton({
  bucket,
  redirectTo,
  small = false,
}: {
  bucket: string;
  redirectTo?: string;
  small?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function deleteBucket() {
    if (!window.confirm(`Delete empty bucket ${bucket}?`)) {
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/obs/buckets?bucket=${encodeURIComponent(bucket)}`,
      { method: "DELETE" },
    );
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Bucket deletion failed.");
      setPending(false);
      return;
    }

    setPending(false);

    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
      return;
    }

    setMessage("Deleted.");
    router.refresh();
  }

  return (
    <ConsoleActionStack gap="xs">
      <ConsoleButton
        className={small ? "text-xs font-black" : undefined}
        disabled={pending}
        onClick={() => void deleteBucket()}
        size={small ? "sm" : "md"}
        title="Only empty buckets can be deleted."
        variant="dangerOutline"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        Delete
      </ConsoleButton>
      {message ? <ConsoleActionFeedback size="xs" tone="danger">{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}
