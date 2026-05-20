"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";

export function UploadObsObjectButton({ bucket }: { bucket: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    const defaultKey = file.name;
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
    <div className="grid gap-1">
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
      <button
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#2563eb] bg-[#2563eb] px-3 text-sm font-bold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-70"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
        Upload object
      </button>
      {message ? <p className="text-xs font-bold text-[#2563eb]">{message}</p> : null}
    </div>
  );
}
