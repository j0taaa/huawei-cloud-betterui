"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Loader2, Trash2 } from "lucide-react";

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
  ConsoleTextarea,
} from "@/components/console-ui";

type DnsProjectOption = {
  label: string;
  value: string;
};

type DnsActionResponse = {
  error?: string;
  id?: string | null;
  status?: string | null;
};

export function CreateDnsZoneButton({
  projects,
}: {
  projects: DnsProjectOption[];
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const [ttl, setTtl] = useState("300");
  const validName =
    name.trim().length <= 254 &&
    /^(?=.{1,254}\.?$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/.test(
      name.trim(),
    );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/dns/zones", {
      body: JSON.stringify({ description, email, name, projectId, ttl: Number(ttl) }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as DnsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Zone creation failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.id
        ? `Zone creation accepted: ${result.id}`
        : result.status
          ? `Zone creation status: ${result.status}`
          : "Zone creation accepted.",
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="border-[#0891b2] bg-[#0891b2] hover:bg-[#0e7490]"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        variant="teal"
      >
        <Globe2 className="size-4" />
        Create zone
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Adds a public zone and prepares SOA/NS records for domain hosting."
          footer={(
            <>
              <ConsoleModalFooterNote>
                DNS creates default SOA and NS records automatically.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  className="border-[#0891b2] bg-[#0891b2] hover:bg-[#0e7490]"
                  disabled={pending || !validName}
                  onClick={submit}
                  size="md"
                  variant="teal"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Globe2 className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          title="Create public DNS zone"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField className="md:col-span-2" label="Zone name">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="example.com."
                  value={name}
                />
              </ConsoleField>
              <ConsoleField label="TTL">
                <ConsoleInput
                  focusTone="teal"
                  min={1}
                  onChange={(event) => setTtl(event.target.value)}
                  type="number"
                  value={ttl}
                />
              </ConsoleField>
              <ConsoleField label="Administrator email">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  value={email}
                />
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Project">
                <ConsoleSelect
                  focusTone="teal"
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
              <ConsoleField className="md:col-span-2" label="Description">
                <ConsoleTextarea
                  focusTone="teal"
                  maxLength={255}
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="info">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteDnsZoneButton({
  recordCount,
  zoneId,
  zoneName,
}: {
  recordCount: number;
  zoneId: string;
  zoneName: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === zoneName,
    [confirmName, zoneName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/dns/zones/${encodeURIComponent(zoneId)}`, {
      body: JSON.stringify({ confirmName }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as DnsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Zone deletion failed.");
      setPending(false);
      return;
    }

    setMessage(result.id ? `Zone deletion accepted: ${result.id}` : "Zone deleted.");
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
          description="This removes the zone and all DNS records inside it."
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
          title="Delete DNS zone"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleConfirmSummary>
                {zoneName} · {recordCount} record sets
              </ConsoleConfirmSummary>
              <ConsoleField label="Type the zone name to confirm">
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
