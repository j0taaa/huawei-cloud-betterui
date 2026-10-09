"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCheckbox,
  ConsoleField,
  ConsoleInput,
  ConsoleInsetPanel,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalFooterNote,
  ConsoleModalMessage,
} from "@/components/console-ui";

type CbrVaultSettings = {
  allocatedGb: number;
  autoExpand: boolean;
  chargingMode: string;
  id: string;
  name: string;
  projectId: string;
  sizeGb: number;
  smnNotify: boolean;
  status: string;
  threshold: number | null;
};

type UpdateResponse = {
  error?: string;
  ok?: boolean;
};

function canEdit(status: string) {
  return status.toLowerCase() === "available";
}

export function CbrVaultActions({ vault }: { vault: CbrVaultSettings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    autoExpand: vault.autoExpand,
    name: vault.name,
    sizeGb: String(vault.sizeGb || Math.max(vault.allocatedGb, 10)),
    smnNotify: vault.smnNotify,
    threshold: String(vault.threshold ?? 80),
  });
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const sizeGb = Number(form.sizeGb);
  const threshold = Number(form.threshold);
  const editable = canEdit(vault.status);
  const canSubmit =
    editable &&
    /^[A-Za-z0-9_-]{1,64}$/.test(form.name.trim()) &&
    Number.isInteger(sizeGb) &&
    sizeGb >= Math.max(vault.allocatedGb, 10) &&
    Number.isInteger(threshold) &&
    threshold >= 1 &&
    threshold <= 100;

  async function submit() {
    if (!canSubmit) {
      setMessage("Check the name, size, and notification threshold.");
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/cbr/vaults/${encodeURIComponent(vault.id)}`, {
      body: JSON.stringify({
        autoExpand: form.autoExpand,
        name: form.name.trim(),
        projectId: vault.projectId,
        sizeGb,
        smnNotify: form.smnNotify,
        threshold,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as UpdateResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Vault update failed.");
      setPending(false);
      return;
    }

    setMessage("Vault settings updated.");
    setPending(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        disabled={!editable}
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        title={
          editable
            ? "Edit vault settings."
            : "Vault settings can be changed only when the vault is available."
        }
        variant="neutral"
      >
        <Settings className="size-4" />
        Settings
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Edit non-destructive CBR vault properties for this project."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Size changes may affect billing. The request updates the selected CBR vault only.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !canSubmit}
                  onClick={submit}
                  size="md"
                  variant="primary"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Settings className="size-4" />
                  )}
                  Save
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          title="Vault settings"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField label="Name">
                <ConsoleInput
                  onChange={(event) =>
                    setForm((value) => ({ ...value, name: event.target.value }))
                  }
                  value={form.name}
                />
              </ConsoleField>
              <ConsoleField label="Vault size (GB)">
                <ConsoleInput
                  min={Math.max(vault.allocatedGb, 10)}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, sizeGb: event.target.value }))
                  }
                  type="number"
                  value={form.sizeGb}
                />
              </ConsoleField>
              <ConsoleField label="Capacity alarm threshold">
                <ConsoleInput
                  max={100}
                  min={1}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      threshold: event.target.value,
                    }))
                  }
                  type="number"
                  value={form.threshold}
                />
              </ConsoleField>
              <ConsoleInsetPanel className="rounded-lg p-3 text-sm font-bold text-[#475467]">
                <p>Allocated capacity</p>
                <p className="mt-1 text-lg font-black text-[#101828]">
                  {vault.allocatedGb} GB
                </p>
                <p className="mt-1 text-xs font-semibold text-[#667085]">
                  Billing mode: {vault.chargingMode}
                </p>
              </ConsoleInsetPanel>
              <ConsoleCheckbox
                checked={form.autoExpand}
                className="md:col-span-2"
                label="Enable automatic capacity expansion"
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    autoExpand: event.target.checked,
                  }))
                }
              />
              <ConsoleCheckbox
                checked={form.smnNotify}
                className="md:col-span-2"
                label="Send SMN notifications"
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    smnNotify: event.target.checked,
                  }))
                }
              />
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage>{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
