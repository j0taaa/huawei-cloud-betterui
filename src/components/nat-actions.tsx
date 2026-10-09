"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShieldPlus, Trash2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
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

type Option = {
  label: string;
  value: string;
};

type GatewayOption = Option & {
  adminStateUp: boolean;
  projectId: string;
  status: string;
};

type ActionResponse = {
  error?: string;
  gatewayId?: string | null;
  orderId?: string | null;
  ruleId?: string | null;
};

const natSpecs = [
  { label: "Small - up to 10,000 SNAT connections", value: "1" },
  { label: "Medium - up to 50,000 SNAT connections", value: "2" },
  { label: "Large - up to 200,000 SNAT connections", value: "3" },
  { label: "Extra large - up to 1,000,000 SNAT connections", value: "4" },
  { label: "Enterprise - up to 10,000,000 SNAT connections", value: "5" },
];

export function CreateNatGatewayButton({ projects }: { projects: Option[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    description: "",
    enterpriseProjectId: "",
    name: "",
    projectId: projects[0]?.value ?? "",
    routerId: "",
    spec: "1",
    subnetId: "",
  });
  const canSubmit =
    /^[a-zA-Z0-9_-]{1,64}$/.test(form.name.trim()) &&
    form.routerId.trim() &&
    form.subnetId.trim() &&
    form.spec;

  async function submit() {
    if (!canSubmit) {
      setMessage("Name, VPC ID, subnet network ID, and spec are required.");
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/nat/gateways", {
      body: JSON.stringify(form),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as ActionResponse;

    setPending(false);

    if (!response.ok) {
      setMessage(result.error ?? "NAT gateway creation failed.");
      return;
    }

    setMessage(
      result.gatewayId
        ? `NAT gateway creation submitted: ${result.gatewayId}`
        : result.orderId
          ? `NAT gateway order submitted: ${result.orderId}`
          : "NAT gateway creation submitted.",
    );
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
        variant="teal"
      >
        <Plus className="size-4" />
        Create gateway
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Creates a billable public NAT gateway attached to a VPC and subnet."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Huawei requires the VPC router ID and subnet network ID for this action.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !canSubmit}
                  onClick={submit}
                  size="md"
                  variant="teal"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#ccfbf1]"
          title="Create public NAT gateway"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField label="Gateway name">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                  value={form.name}
                />
              </ConsoleField>
              <ConsoleField label="Spec">
                <ConsoleSelect
                  focusTone="teal"
                  onChange={(event) => setForm((value) => ({ ...value, spec: event.target.value }))}
                  value={form.spec}
                >
                  {natSpecs.map((spec) => (
                    <option key={spec.value} value={spec.value}>
                      {spec.label}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="VPC ID">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) => setForm((value) => ({ ...value, routerId: event.target.value }))}
                  value={form.routerId}
                />
              </ConsoleField>
              <ConsoleField label="Subnet network ID">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) => setForm((value) => ({ ...value, subnetId: event.target.value }))}
                  value={form.subnetId}
                />
              </ConsoleField>
              <ConsoleField label="Project">
                <ConsoleSelect
                  focusTone="teal"
                  onChange={(event) => setForm((value) => ({ ...value, projectId: event.target.value }))}
                  value={form.projectId}
                >
                  {projects.map((project) => (
                    <option key={project.value || "current"} value={project.value}>
                      {project.label}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Enterprise project ID">
                <ConsoleInput
                  focusTone="teal"
                  onChange={(event) =>
                    setForm((value) => ({ ...value, enterpriseProjectId: event.target.value }))
                  }
                  placeholder="Optional"
                  value={form.enterpriseProjectId}
                />
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Description">
                <ConsoleTextarea
                  focusTone="teal"
                  onChange={(event) =>
                    setForm((value) => ({ ...value, description: event.target.value }))
                  }
                  value={form.description}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="teal">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function CreateNatSnatRuleButton({
  gateways,
}: {
  gateways: GatewayOption[];
}) {
  const router = useRouter();
  const usableGateways = gateways.filter(
    (gateway) => gateway.status.toUpperCase() === "ACTIVE" && gateway.adminStateUp,
  );
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    cidr: "",
    description: "",
    floatingIpId: "",
    gatewayId: usableGateways[0]?.value ?? "",
    networkId: "",
    sourceType: "0",
  });
  const selectedGateway = useMemo(
    () => usableGateways.find((gateway) => gateway.value === form.gatewayId),
    [form.gatewayId, usableGateways],
  );
  const usesVpc = form.sourceType === "0";
  const canSubmit =
    form.gatewayId &&
    form.floatingIpId.trim() &&
    (usesVpc ? form.networkId.trim() || form.cidr.trim() : form.cidr.trim());

  async function submit() {
    if (!canSubmit) {
      setMessage("Gateway, EIP ID, and source network are required.");
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/nat/snat-rules", {
      body: JSON.stringify({
        ...form,
        projectId: selectedGateway?.projectId,
        sourceType: Number(form.sourceType),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as ActionResponse;

    setPending(false);

    if (!response.ok) {
      setMessage(result.error ?? "SNAT rule creation failed.");
      return;
    }

    setMessage(result.ruleId ? `SNAT rule created: ${result.ruleId}` : "SNAT rule created.");
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!usableGateways.length}
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        title={!usableGateways.length ? "Create or wait for an active NAT gateway first." : undefined}
        variant="primaryOutline"
      >
        <ShieldPlus className="size-4" />
        Add SNAT rule
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Binds private traffic to one or more EIP IDs through an active NAT gateway."
          footer={(
            <>
              <ConsoleModalFooterNote>
                SNAT rules require an active and unfrozen gateway.
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
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldPlus className="size-4" />}
                  Add rule
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#bfdbfe]"
          title="Add SNAT rule"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField className="md:col-span-2" label="NAT gateway">
                <ConsoleSelect
                  onChange={(event) => setForm((value) => ({ ...value, gatewayId: event.target.value }))}
                  value={form.gatewayId}
                >
                  {usableGateways.map((gateway) => (
                    <option key={gateway.value} value={gateway.value}>
                      {gateway.label}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Source type">
                <ConsoleSelect
                  onChange={(event) =>
                    setForm((value) => ({ ...value, networkId: "", sourceType: event.target.value }))
                  }
                  value={form.sourceType}
                >
                  <option value="0">VPC subnet or CIDR</option>
                  <option value="1">Direct Connect / Cloud Connect CIDR</option>
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="EIP ID">
                <ConsoleInput
                  onChange={(event) =>
                    setForm((value) => ({ ...value, floatingIpId: event.target.value }))
                  }
                  placeholder="Comma-separated IDs are supported"
                  value={form.floatingIpId}
                />
              </ConsoleField>
              {usesVpc ? (
                <ConsoleField label="Subnet network ID">
                  <ConsoleInput
                    onChange={(event) =>
                      setForm((value) => ({ ...value, networkId: event.target.value }))
                    }
                    value={form.networkId}
                  />
                </ConsoleField>
              ) : null}
              <ConsoleField label="CIDR">
                <ConsoleInput
                  onChange={(event) => setForm((value) => ({ ...value, cidr: event.target.value }))}
                  placeholder={usesVpc ? "Optional if subnet ID is provided" : "Required"}
                  value={form.cidr}
                />
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Description">
                <ConsoleTextarea
                  onChange={(event) =>
                    setForm((value) => ({ ...value, description: event.target.value }))
                  }
                  value={form.description}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="info">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteNatGatewayButton({
  gatewayId,
  gatewayName,
  projectId,
  ruleCount,
  status,
}: {
  gatewayId: string;
  gatewayName: string;
  projectId: string;
  ruleCount: number;
  status: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canDelete =
    ruleCount === 0 &&
    !status.toUpperCase().startsWith("PENDING") &&
    confirmName.trim() === gatewayName;

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/nat/gateways/${encodeURIComponent(gatewayId)}`, {
      body: JSON.stringify({ confirmName, projectId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as ActionResponse;

    setPending(false);

    if (!response.ok) {
      setMessage(result.error ?? "NAT gateway deletion failed.");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        disabled={status.toUpperCase().startsWith("PENDING")}
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
          description="Remove SNAT rules first, then type the gateway name to confirm."
          footer={(
            <ConsoleModalActions className="w-full">
              <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                Cancel
              </ConsoleButton>
              <ConsoleButton
                disabled={pending || !canDelete}
                onClick={submit}
                size="md"
                variant="danger"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Delete
              </ConsoleButton>
            </ConsoleModalActions>
          )}
          onClose={() => setOpen(false)}
          title="Delete NAT gateway"
          tone="danger"
        >
            <ConsoleModalBody>
              {ruleCount > 0 ? (
                <ConsoleCallout tone="warning">
                  This gateway still has {ruleCount} SNAT rule{ruleCount === 1 ? "" : "s"}.
                </ConsoleCallout>
              ) : null}
              <ConsoleField label={`Type ${gatewayName}`}>
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

export function DeleteNatSnatRuleButton({
  gatewayId,
  projectId,
  ruleId,
  status,
}: {
  gatewayId: string;
  projectId: string;
  ruleId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit() {
    const confirmId = window.prompt("Type the SNAT rule ID to delete it.");

    if (confirmId !== ruleId) {
      return;
    }

    setPending(true);

    const response = await fetch(`/api/cloud/nat/snat-rules/${encodeURIComponent(ruleId)}`, {
      body: JSON.stringify({ confirmId, gatewayId, projectId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });

    setPending(false);

    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as ActionResponse;
      window.alert(result.error ?? "SNAT rule deletion failed.");
      return;
    }

    router.refresh();
  }

  return (
    <ConsoleButton
      className="text-xs font-black"
      disabled={pending || status.toUpperCase().startsWith("PENDING")}
      onClick={submit}
      size="sm"
      variant="dangerOutline"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      Delete
    </ConsoleButton>
  );
}
