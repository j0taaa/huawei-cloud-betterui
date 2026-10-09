"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

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

type ProjectOption = {
  label: string;
  value: string;
};

type EipActionResponse = {
  error?: string;
  id?: string | null;
  ipAddress?: string | null;
  status?: string | null;
};

export function CreateEipButton({
  projects,
}: {
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [bandwidthChargeMode, setBandwidthChargeMode] = useState("traffic");
  const [bandwidthName, setBandwidthName] = useState("betterui-eip-bandwidth");
  const [bandwidthSize, setBandwidthSize] = useState("5");
  const [enterpriseProjectId, setEnterpriseProjectId] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [portId, setPortId] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const [shareType, setShareType] = useState<"PER" | "WHOLE">("PER");
  const [sharedBandwidthId, setSharedBandwidthId] = useState("");
  const [type, setType] = useState("5_bgp");
  const size = Number(bandwidthSize);
  const aliasValid =
    !alias.trim() || /^[A-Za-z0-9_.-]{1,64}$/.test(alias.trim());
  const canSubmit =
    projectId &&
    aliasValid &&
    ((shareType === "PER" &&
      bandwidthName.trim() &&
      Number.isInteger(size) &&
      size >= 1 &&
      size <= 300) ||
      (shareType === "WHOLE" && sharedBandwidthId.trim()));

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/eip/publicips", {
      body: JSON.stringify({
        alias,
        bandwidthChargeMode,
        bandwidthName,
        bandwidthSize: size,
        enterpriseProjectId,
        ipAddress,
        portId,
        projectId,
        shareType,
        sharedBandwidthId,
        type,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as EipActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "EIP assignment failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.ipAddress
        ? `EIP assignment accepted: ${result.ipAddress}`
        : result.id
          ? `EIP assignment accepted: ${result.id}`
          : "EIP assignment accepted.",
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="border-[#155eef] bg-[#155eef] hover:bg-[#174ea6]"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="lg"
      >
        <Plus className="size-4" />
        Assign EIP
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          closeLabel="Close assign EIP dialog"
          description="Allocate a pay-per-use public IP with dedicated or shared bandwidth."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Default IPv4 allocation is used unless you provide a specific address.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  className="border-[#155eef] bg-[#155eef] hover:bg-[#174ea6]"
                  disabled={pending || !canSubmit}
                  onClick={submit}
                  size="md"
                  variant="primary"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Assign
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-3xl"
          onClose={() => setOpen(false)}
          panelClassName="max-h-[92vh] overflow-y-auto border-[#bfdbfe]"
          title="Assign Elastic IP"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField label="Project">
                <ConsoleSelect
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
              <ConsoleField label="EIP type">
                <ConsoleSelect
                  onChange={(event) => setType(event.target.value)}
                  value={type}
                >
                  <option value="5_bgp">Dynamic BGP</option>
                  <option value="5_sbgp">Static BGP</option>
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Name">
                <ConsoleInput
                  maxLength={64}
                  onChange={(event) => setAlias(event.target.value)}
                  placeholder="production-nat-eip"
                  value={alias}
                />
              </ConsoleField>
              <ConsoleField label="Specific IP address">
                <ConsoleInput
                  onChange={(event) => setIpAddress(event.target.value)}
                  placeholder="Optional"
                  value={ipAddress}
                />
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Bind to port ID">
                <ConsoleInput
                  onChange={(event) => setPortId(event.target.value)}
                  placeholder="Optional NIC or virtual IP port"
                  value={portId}
                />
              </ConsoleField>
              <ConsoleField label="Bandwidth mode">
                <ConsoleSelect
                  onChange={(event) => setShareType(event.target.value as "PER" | "WHOLE")}
                  value={shareType}
                >
                  <option value="PER">Dedicated bandwidth</option>
                  <option value="WHOLE">Existing shared bandwidth</option>
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Charge mode">
                <ConsoleSelect
                  onChange={(event) => setBandwidthChargeMode(event.target.value)}
                  value={bandwidthChargeMode}
                >
                  <option value="traffic">Traffic</option>
                  <option value="bandwidth">Bandwidth</option>
                </ConsoleSelect>
              </ConsoleField>
              {shareType === "PER" ? (
                <>
                  <ConsoleField label="Bandwidth name">
                    <ConsoleInput
                      maxLength={64}
                      onChange={(event) => setBandwidthName(event.target.value)}
                      value={bandwidthName}
                    />
                  </ConsoleField>
                  <ConsoleField label="Bandwidth size">
                    <ConsoleInput
                      max={300}
                      min={1}
                      onChange={(event) => setBandwidthSize(event.target.value)}
                      type="number"
                      value={bandwidthSize}
                    />
                  </ConsoleField>
                </>
              ) : (
                <ConsoleField className="md:col-span-2" label="Shared bandwidth ID">
                  <ConsoleInput
                    onChange={(event) => setSharedBandwidthId(event.target.value)}
                    value={sharedBandwidthId}
                  />
                </ConsoleField>
              )}
              <ConsoleField className="md:col-span-2" label="Enterprise project ID">
                <ConsoleInput
                  onChange={(event) => setEnterpriseProjectId(event.target.value)}
                  placeholder="Optional; defaults to 0"
                  value={enterpriseProjectId}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="info">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function ReleaseEipButton({
  disabledReason,
  ipAddress,
  name,
  publicIpId,
  projectId,
}: {
  disabledReason?: string;
  ipAddress: string;
  name: string;
  publicIpId: string;
  projectId: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === name || confirmName.trim() === ipAddress,
    [confirmName, ipAddress, name],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(
      `/api/cloud/eip/publicips/${encodeURIComponent(publicIpId)}`,
      {
        body: JSON.stringify({ confirmName, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as EipActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "EIP release failed.");
      setPending(false);
      return;
    }

    setMessage("EIP release accepted.");
    setPending(false);
    router.refresh();
  }

  if (disabledReason) {
    return (
      <ConsoleButton
        className="text-xs font-black text-[#98a2b3]"
        disabled
        size="sm"
        title={disabledReason}
        variant="neutral"
      >
        <Trash2 className="size-3.5" />
        Release
      </ConsoleButton>
    );
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
        Release
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          closeLabel="Close release EIP dialog"
          description="Only unbound EIPs can be released from this console."
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                Release is irreversible.
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
                  Release
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          onClose={() => setOpen(false)}
          title="Release EIP"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleConfirmSummary>
                {name} / {ipAddress}
              </ConsoleConfirmSummary>
              <ConsoleField label="Type the EIP name or public IP to confirm">
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
