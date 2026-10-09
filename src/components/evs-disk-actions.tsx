"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DatabaseBackup,
  Edit3,
  HardDriveDownload,
  Link2,
  Loader2,
  Maximize2,
  Plus,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleCheckbox,
  ConsoleActionFeedback,
  ConsoleDescriptionList,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalFooterNote,
  ConsoleModalMessage,
  ConsoleMutedText,
  ConsoleSelect,
  ConsoleTextarea,
  SimpleTable,
  type SimpleTableRow,
} from "@/components/console-ui";

type EvsOption = {
  label: string;
  value: string;
};

type CreateDiskResponse = {
  error?: string;
  jobId?: string | null;
  volumeId?: string | null;
};

type DeleteDiskResponse = {
  error?: string;
  jobId?: string | null;
};

type DiskActionResponse = {
  error?: string;
  jobId?: string | null;
};

type SnapshotActionResponse = {
  error?: string;
  jobId?: string | null;
};

type BulkDeleteDisk = {
  attachedTo: string;
  id: string;
  name: string;
  projectId: string;
  region: string;
  status: string;
};

type EvsActionDisk = BulkDeleteDisk & {
  attachedDevice: string;
  attachedServerId: string;
  availabilityZone: string;
  description: string;
  rawSizeGb: number;
  size: string;
  type: string;
};

type EvsAttachInstance = {
  availabilityZone: string;
  id: string;
  name: string;
  projectId: string;
  region: string;
  status: string;
};

type EvsSnapshotDisk = {
  attachedTo: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
};

type CreateSnapshotResponse = {
  error?: string;
  id?: string | null;
};

type EvsSnapshotAction = {
  diskId: string;
  id: string;
  name: string;
  projectId: string;
  status: string;
};

type EvsSnapshotDiskSource = {
  availabilityZone: string;
  rawSizeGb: number;
  type: string;
};

type EvsSnapshotCreateSource = EvsSnapshotAction & {
  projectName: string;
  rawSizeGb: number;
  region: string;
  size: string;
};

export function CreateEvsDiskButton({
  availabilityZones,
  projects,
  volumeTypes,
}: {
  availabilityZones: string[];
  projects: EvsOption[];
  volumeTypes: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    availabilityZone: availabilityZones[0] ?? "",
    description: "",
    isShareable: false,
    name: "",
    projectId: projects[0]?.value ?? "",
    sizeGb: "100",
    volumeType: volumeTypes[0] ?? "SSD",
  });
  const canSubmit =
    form.name.trim() &&
    form.availabilityZone.trim() &&
    form.volumeType.trim() &&
    Number.isInteger(Number(form.sizeGb)) &&
    Number(form.sizeGb) >= 10;

  async function submit() {
    if (!canSubmit) {
      setMessage("Name, availability zone, disk type, and size are required.");
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/disks", {
      body: JSON.stringify({
        ...form,
        sizeGb: Number(form.sizeGb),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as CreateDiskResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk creation failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.jobId
        ? `Disk creation submitted: ${result.jobId}`
        : result.volumeId
          ? `Disk creation submitted: ${result.volumeId}`
          : "Disk creation submitted.",
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
      >
        <Plus className="size-4" />
        Create disk
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Creates a pay-per-use disk in the selected project."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Billable action. The request is submitted to Huawei Cloud as pay-per-use.
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
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Submit
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          title="Create EVS disk"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField label="Name">
                <ConsoleInput
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                  value={form.name}
                />
              </ConsoleField>
              <ConsoleField label="Size (GB)">
                <ConsoleInput
                  min={10}
                  onChange={(event) => setForm((value) => ({ ...value, sizeGb: event.target.value }))}
                  type="number"
                  value={form.sizeGb}
                />
              </ConsoleField>
              <ConsoleField label="Availability zone">
                <ConsoleInput
                  list="evs-availability-zones"
                  onChange={(event) =>
                    setForm((value) => ({ ...value, availabilityZone: event.target.value }))
                  }
                  value={form.availabilityZone}
                />
                <datalist id="evs-availability-zones">
                  {availabilityZones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </ConsoleField>
              <ConsoleField label="Disk type">
                <ConsoleInput
                  list="evs-volume-types"
                  onChange={(event) =>
                    setForm((value) => ({ ...value, volumeType: event.target.value }))
                  }
                  value={form.volumeType}
                />
                <datalist id="evs-volume-types">
                  {volumeTypes.map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Project">
                <ConsoleSelect
                  onChange={(event) =>
                    setForm((value) => ({ ...value, projectId: event.target.value }))
                  }
                  value={form.projectId}
                >
                  {projects.map((project) => (
                    <option key={project.value} value={project.value}>
                      {project.label}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Description">
                <ConsoleTextarea
                  onChange={(event) =>
                    setForm((value) => ({ ...value, description: event.target.value }))
                  }
                  value={form.description}
                />
              </ConsoleField>
              <ConsoleCheckbox
                checked={form.isShareable}
                className="md:col-span-2"
                label="Shared disk"
                onChange={(event) =>
                  setForm((value) => ({ ...value, isShareable: event.target.checked }))
                }
              />
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage>{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function CreateEvsDiskFromSnapshotButton({
  availabilityZones,
  snapshot,
  sourceDisk,
  volumeTypes,
}: {
  availabilityZones: string[];
  snapshot: EvsSnapshotCreateSource;
  sourceDisk?: EvsSnapshotDiskSource;
  volumeTypes: string[];
}) {
  const router = useRouter();
  const minimumSizeGb = Math.max(10, snapshot.rawSizeGb);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    availabilityZone: sourceDisk?.availabilityZone ?? availabilityZones[0] ?? "",
    description: `Created from snapshot ${snapshot.name}`,
    name: `${snapshot.name}-disk`,
    sizeGb: String(Math.max(minimumSizeGb, sourceDisk?.rawSizeGb ?? 0)),
    volumeType: sourceDisk?.type ?? volumeTypes[0] ?? "SSD",
  });
  const hasPlacementOptions = Boolean(form.availabilityZone && form.volumeType);
  const canSubmit =
    Boolean(form.name.trim()) &&
    hasPlacementOptions &&
    Number.isInteger(Number(form.sizeGb)) &&
    Number(form.sizeGb) >= minimumSizeGb;

  async function submit() {
    if (!canSubmit) {
      setMessage(`Name, AZ, type, and a size of at least ${minimumSizeGb} GB are required.`);
      return;
    }

    setPending(true);
    setMessage("");
    const response = await fetch("/api/cloud/evs/disks", {
      body: JSON.stringify({
        ...form,
        projectId: snapshot.projectId,
        sizeGb: Number(form.sizeGb),
        snapshotId: snapshot.id,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as CreateDiskResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk creation from snapshot failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.jobId
        ? `Disk creation submitted: ${result.jobId}`
        : result.volumeId
          ? `Disk creation submitted: ${result.volumeId}`
          : "Disk creation submitted.",
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={snapshot.status.toLowerCase() !== "available" || !hasPlacementOptions}
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="md"
        title={
          snapshot.status.toLowerCase() !== "available"
            ? "Snapshot must be available."
            : hasPlacementOptions
              ? "Create disk from snapshot"
              : "No availability zone is visible for this snapshot's project."
        }
        variant="primaryOutline"
      >
        <HardDriveDownload className="size-4" />
        Create disk
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>Create a pay-per-use EVS disk from snapshot {snapshot.name}.</>}
          footer={(
            <>
              <ConsoleModalFooterNote>
                The new disk must remain in {snapshot.projectName} and cannot be smaller than the snapshot.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton onClick={() => setOpen(false)} size="md" variant="neutral">Cancel</ConsoleButton>
                <ConsoleButton disabled={pending || !canSubmit} onClick={submit} size="md">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <HardDriveDownload className="size-4" />}
                  Submit
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          title="Create disk from snapshot"
        >
          <ConsoleModalBody className="md:grid-cols-2">
            <div className="md:col-span-2">
              <ConsoleDescriptionList
                items={[
                  { label: "Snapshot", value: snapshot.name },
                  { label: "Snapshot size", value: snapshot.size },
                  { label: "Project", value: `${snapshot.projectName} / ${snapshot.region}` },
                ]}
              />
            </div>
            <ConsoleField label="Disk name">
              <ConsoleInput onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} value={form.name} />
            </ConsoleField>
            <ConsoleField label="Size (GB)">
              <ConsoleInput min={minimumSizeGb} onChange={(event) => setForm((value) => ({ ...value, sizeGb: event.target.value }))} type="number" value={form.sizeGb} />
            </ConsoleField>
            <ConsoleField label="Availability zone">
              <ConsoleSelect onChange={(event) => setForm((value) => ({ ...value, availabilityZone: event.target.value }))} value={form.availabilityZone}>
                {Array.from(new Set([...(sourceDisk ? [sourceDisk.availabilityZone] : []), ...availabilityZones])).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </ConsoleSelect>
            </ConsoleField>
            <ConsoleField label="Disk type">
              <ConsoleSelect onChange={(event) => setForm((value) => ({ ...value, volumeType: event.target.value }))} value={form.volumeType}>
                {Array.from(new Set([...(sourceDisk ? [sourceDisk.type] : []), ...volumeTypes])).map((type) => <option key={type} value={type}>{type}</option>)}
              </ConsoleSelect>
            </ConsoleField>
            <ConsoleField className="md:col-span-2" label="Description">
              <ConsoleTextarea onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} value={form.description} />
            </ConsoleField>
          </ConsoleModalBody>
          {message ? <ConsoleModalMessage>{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function CreateEvsSnapshotButton({
  disks,
  selectedDiskId,
}: {
  disks: EvsSnapshotDisk[];
  selectedDiskId?: string;
}) {
  const router = useRouter();
  const initialDiskId = selectedDiskId ?? disks[0]?.id ?? "";
  const initialDisk = disks.find((disk) => disk.id === initialDiskId) ?? disks[0];
  const [description, setDescription] = useState("");
  const [diskId, setDiskId] = useState(initialDiskId);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(
    initialDisk ? `${initialDisk.name}-snapshot` : "",
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const selectedDisk = disks.find((disk) => disk.id === diskId);
  const canSubmit = Boolean(selectedDisk && name.trim());

  async function submit() {
    if (!selectedDisk) {
      setMessage("Select a disk before creating a snapshot.");
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/snapshots", {
      body: JSON.stringify({
        description,
        diskId: selectedDisk.id,
        name,
        projectId: selectedDisk.projectId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as CreateSnapshotResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Snapshot creation failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.id ? `Snapshot creation submitted: ${result.id}` : "Snapshot creation submitted.",
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!disks.length}
        onClick={() => {
          const currentDisk = disks.find((disk) => disk.id === initialDiskId) ?? disks[0];
          setDiskId(currentDisk?.id ?? "");
          setName(currentDisk ? `${currentDisk.name}-snapshot` : "");
          setDescription("");
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        title={disks.length ? "Create EVS snapshot" : "No EVS disks are available."}
        variant="purple"
      >
        <DatabaseBackup className="size-4" />
        Create snapshot
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Captures a point-in-time backup for the selected EVS disk."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Snapshot creation is asynchronous and may take several minutes.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !canSubmit}
                  onClick={submit}
                  size="md"
                  variant="purple"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#ddd6fe]"
          title="Create EVS snapshot"
        >
            <ConsoleModalBody>
              <ConsoleField label="Disk">
                <ConsoleSelect
                  disabled={Boolean(selectedDiskId)}
                  focusTone="purple"
                  onChange={(event) => {
                    const nextDisk = disks.find((disk) => disk.id === event.target.value);
                    setDiskId(event.target.value);
                    if (nextDisk && !name.trim()) {
                      setName(`${nextDisk.name}-snapshot`);
                    }
                  }}
                  value={diskId}
                >
                  {disks.map((disk) => (
                    <option key={disk.id} value={disk.id}>
                      {disk.name} · {disk.size} · {disk.projectName} / {disk.region}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              {selectedDisk ? (
                <ConsoleDescriptionList
                  columns={2}
                  items={[
                    { label: "Status", value: selectedDisk.status },
                    { label: "Attached to", value: selectedDisk.attachedTo },
                    { className: "md:col-span-2", label: "Disk ID", value: selectedDisk.id },
                  ]}
                  tone="purple"
                />
              ) : null}
              <ConsoleField label="Snapshot name">
                <ConsoleInput
                  focusTone="purple"
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </ConsoleField>
              <ConsoleField label="Description">
                <ConsoleTextarea
                  focusTone="purple"
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="purple">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function EditEvsDiskButton({ disk }: { disk: EvsActionDisk }) {
  const router = useRouter();
  const [description, setDescription] = useState(disk.description);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(disk.name);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canSubmit = Boolean(name.trim());

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/evs/disks/${encodeURIComponent(disk.id)}/action`, {
      body: JSON.stringify({
        action: "update",
        description,
        name,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as DiskActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk update failed.");
      setPending(false);
      return;
    }

    setMessage("Disk details updated.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        onClick={() => {
          setName(disk.name);
          setDescription(disk.description);
          setMessage("");
          setOpen(true);
        }}
        size="md"
        variant="neutral"
      >
        <Edit3 className="size-4" />
        Edit
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Update the disk name and description."
          footer={(
            <>
              <ConsoleModalFooterNote>{disk.id}</ConsoleModalFooterNote>
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
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Edit3 className="size-4" />}
                  Save
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-xl"
          onClose={() => setOpen(false)}
          title="Edit EVS disk"
        >
            <ConsoleModalBody>
              <ConsoleField label="Name">
                <ConsoleInput onChange={(event) => setName(event.target.value)} value={name} />
              </ConsoleField>
              <ConsoleField label="Description">
                <ConsoleTextarea
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage>{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function ExtendEvsDiskButton({ disk }: { disk: EvsActionDisk }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [sizeGb, setSizeGb] = useState(String(Math.max(disk.rawSizeGb + 10, disk.rawSizeGb)));
  const newSizeGb = Number(sizeGb);
  const canSubmit = Number.isInteger(newSizeGb) && newSizeGb > disk.rawSizeGb && newSizeGb <= 32768;

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/evs/disks/${encodeURIComponent(disk.id)}/action`, {
      body: JSON.stringify({
        action: "extend",
        newSizeGb,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as DiskActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk expansion failed.");
      setPending(false);
      return;
    }

    setMessage(result.jobId ? `Expansion submitted: ${result.jobId}` : "Expansion submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        onClick={() => {
          setSizeGb(String(Math.max(disk.rawSizeGb + 10, disk.rawSizeGb)));
          setMessage("");
          setOpen(true);
        }}
        size="md"
        variant="infoOutline"
      >
        <Maximize2 className="size-4" />
        Extend
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>Increase capacity from the current {disk.size}. Shrinking is not supported.</>}
          footer={(
            <>
              <p className="text-sm font-bold text-[#0369a1]">
                After expansion, extend the partition and filesystem inside the OS.
              </p>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>Cancel</ConsoleButton>
                <ConsoleButton className="border-[#0284c7] bg-[#0284c7] hover:bg-[#0369a1]" disabled={pending || !canSubmit} onClick={submit} size="md" variant="primary">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Maximize2 className="size-4" />}
                  Extend
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          onClose={() => setOpen(false)}
          panelClassName="border-[#bae6fd]"
          title="Extend EVS disk"
        >
            <ConsoleModalBody>
              <ConsoleField label="New size (GB)">
                <ConsoleInput
                  className="border-[#bae6fd]"
                  focusTone="info"
                  min={disk.rawSizeGb + 1}
                  onChange={(event) => setSizeGb(event.target.value)}
                  type="number"
                  value={sizeGb}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="info">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function AttachDetachEvsDiskButton({
  disk,
  instances,
}: {
  disk: EvsActionDisk;
  instances: EvsAttachInstance[];
}) {
  const router = useRouter();
  const eligibleInstances = instances.filter(
    (instance) =>
      instance.projectId === disk.projectId &&
      instance.region === disk.region &&
      instance.availabilityZone === disk.availabilityZone &&
      ["ACTIVE", "SHUTOFF"].includes(instance.status),
  );
  const [device, setDevice] = useState("/dev/sdb");
  const [force, setForce] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverId, setServerId] = useState(eligibleInstances[0]?.id ?? "");
  const isAttached = Boolean(disk.attachedServerId);
  const canSubmit = isAttached || Boolean(serverId);

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/evs/disks/${encodeURIComponent(disk.id)}/action`, {
      body: JSON.stringify(
        isAttached
          ? {
              action: "detach",
              force,
              serverId: disk.attachedServerId,
            }
          : {
              action: "attach",
              device,
              serverId,
            },
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as DiskActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk attachment action failed.");
      setPending(false);
      return;
    }

    setMessage(
      result.jobId
        ? `${isAttached ? "Detach" : "Attach"} submitted: ${result.jobId}`
        : `${isAttached ? "Detach" : "Attach"} submitted.`,
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        onClick={() => {
          setServerId(eligibleInstances[0]?.id ?? "");
          setDevice("/dev/sdb");
          setForce(false);
          setMessage("");
          setOpen(true);
        }}
        size="md"
        variant="successOutline"
      >
        {isAttached ? <Unlink className="size-4" /> : <Link2 className="size-4" />}
        {isAttached ? "Detach" : "Attach"}
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={isAttached
            ? "Detach this disk from its current ECS instance."
            : "Attach this available disk to an ECS in the same project and AZ."}
          footer={(
            <>
              <ConsoleActionFeedback tone="success">
                Confirm OS mount/unmount steps before changing disk attachment.
              </ConsoleActionFeedback>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>Cancel</ConsoleButton>
                <ConsoleButton disabled={pending || !canSubmit} onClick={submit} size="md" variant="success">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : isAttached ? <Unlink className="size-4" /> : <Link2 className="size-4" />}
                  {isAttached ? "Detach" : "Attach"}
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#bbf7d0]"
          title={isAttached ? "Detach EVS disk" : "Attach EVS disk"}
        >
            <ConsoleModalBody>
              {isAttached ? (
                <>
                  <ConsoleDescriptionList
                    items={[
                      { label: "ECS ID", value: disk.attachedServerId },
                      { label: "Device", value: disk.attachedDevice || "-" },
                    ]}
                    tone="good"
                  />
                  <ConsoleCheckbox checked={force} label="Force detach" onChange={(event) => setForce(event.target.checked)} />
                </>
              ) : (
                <>
                  <ConsoleField label="ECS instance">
                    <ConsoleSelect focusTone="success" onChange={(event) => setServerId(event.target.value)} value={serverId}>
                      {eligibleInstances.map((instance) => (
                        <option key={instance.id} value={instance.id}>
                          {instance.name} · {instance.status}
                        </option>
                      ))}
                    </ConsoleSelect>
                  </ConsoleField>
                  <ConsoleField label="Device">
                    <ConsoleInput focusTone="success" onChange={(event) => setDevice(event.target.value)} value={device} />
                  </ConsoleField>
                  {!eligibleInstances.length ? (
                    <ConsoleCallout tone="warning">
                      No running or stopped ECS instances were found in the same project, region, and availability zone.
                    </ConsoleCallout>
                  ) : null}
                </>
              )}
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="success">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteEvsDiskButton({
  attachedTo,
  diskId,
  diskName,
  projectId,
  status,
}: {
  attachedTo: string;
  diskId: string;
  diskName: string;
  projectId: string;
  status: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isAttached = attachedTo !== "-";
  const canDelete = !isAttached && status.toLowerCase() !== "in-use";
  const confirmationMatches = useMemo(
    () => confirmName.trim() === diskName,
    [confirmName, diskName],
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/evs/disks/${encodeURIComponent(diskId)}`, {
      body: JSON.stringify({ confirmName, projectId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as DeleteDiskResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Disk deletion failed.");
      setPending(false);
      return;
    }

    setMessage(result.jobId ? `Deletion submitted: ${result.jobId}` : "Deletion submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="min-w-40"
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        title={canDelete ? "Delete disk" : "Detach this disk before deleting it."}
        variant="danger"
      >
        <Trash2 className="size-4" />
        Delete disk
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>This submits a destructive delete request for {diskName}.</>}
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                {canDelete
                  ? "Detached disks can be deleted after name confirmation."
                  : "Detach this disk before deleting it."}
              </p>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !confirmationMatches || !canDelete}
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
          title="Delete EVS disk"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleDescriptionList
                items={[
                  { label: "Disk ID", value: diskId },
                  { label: "Project", value: projectId },
                ]}
                tone="danger"
              />
              <ConsoleField label="Type the disk name to confirm">
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

export function BulkDeleteEvsDisksButton({
  disks,
}: {
  disks: BulkDeleteDisk[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const eligibleDisks = useMemo(
    () =>
      disks.filter(
        (disk) => disk.attachedTo === "-" && disk.status.toLowerCase() !== "in-use",
      ),
    [disks],
  );
  const blockedDisks = disks.length - eligibleDisks.length;
  const canSubmit = eligibleDisks.length > 0 && confirmText.trim() === "DELETE";
  const diskRows: SimpleTableRow[] = disks.map((disk) => {
    const eligible = disk.attachedTo === "-" && disk.status.toLowerCase() !== "in-use";

    return {
      key: disk.id,
      cells: [
        <div key="disk">
          <p className="font-black text-[#101828]">{disk.name}</p>
          <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
            {disk.id}
          </p>
        </div>,
        <span className="font-bold" key="status">{disk.status}</span>,
        <span className="font-bold" key="delete">{eligible ? "Ready" : "Blocked"}</span>,
      ],
    };
  });

  async function submit() {
    setPending(true);
    setMessage("");

    const results = await Promise.all(
      eligibleDisks.map(async (disk) => {
        const response = await fetch(
          `/api/cloud/evs/disks/${encodeURIComponent(disk.id)}`,
          {
            body: JSON.stringify({
              confirmName: disk.name,
              projectId: disk.projectId,
            }),
            headers: { "Content-Type": "application/json" },
            method: "DELETE",
          },
        );
        const result = (await response.json().catch(() => ({}))) as DeleteDiskResponse;

        return {
          disk,
          error: response.ok ? null : result.error ?? "Disk deletion failed.",
          jobId: result.jobId ?? null,
        };
      }),
    );
    const failed = results.filter((result) => result.error);
    const succeeded = results.length - failed.length;

    setMessage(
      failed.length
        ? `${succeeded} delete requests submitted. ${failed.length} failed: ${failed
            .map((result) => result.disk.name)
            .join(", ")}.`
        : `${succeeded} delete requests submitted.`,
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!disks.length}
        onClick={() => {
          setConfirmText("");
          setMessage("");
          setOpen(true);
        }}
        size="md"
        variant="danger"
      >
        <Trash2 className="size-4" />
        Delete selected
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={
            <>
              {eligibleDisks.length} of {disks.length} selected disks can be deleted.
              {blockedDisks ? ` ${blockedDisks} attached or in-use disks will be skipped.` : ""}
            </>
          }
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">
                Bulk delete submits one guarded request per eligible detached disk.
              </p>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !canSubmit}
                  onClick={submit}
                  size="md"
                  variant="danger"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete {eligibleDisks.length}
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-2xl"
          onClose={() => setOpen(false)}
          title="Delete selected EVS disks"
          tone="danger"
        >
            <ConsoleModalBody>
              <SimpleTable
                className="max-h-64 rounded-lg border border-[#fee4e2]"
                columns={[
                  { header: "Disk", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                  { header: "Status", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                  { header: "Delete", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                ]}
                emptyState={
                  <ConsoleMutedText weight="semibold">
                    No selected EVS disks.
                  </ConsoleMutedText>
                }
                minWidthClassName="min-w-[520px]"
                rows={diskRows}
              />
              <ConsoleField label="Type DELETE to confirm bulk deletion">
                <ConsoleInput
                  className="border-[#fda29b]"
                  focusTone="danger"
                  onChange={(event) => setConfirmText(event.target.value)}
                  value={confirmText}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="danger">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function BulkDeleteEvsSnapshotsButton({
  snapshots,
}: {
  snapshots: EvsSnapshotAction[];
}) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const eligibleSnapshots = useMemo(
    () => snapshots.filter((snapshot) => ["available", "error", "error_deleting"].includes(snapshot.status.toLowerCase())),
    [snapshots],
  );
  const canSubmit = eligibleSnapshots.length > 0 && confirmText.trim() === "DELETE";

  async function submit() {
    setPending(true);
    setMessage("");
    const results = await Promise.all(eligibleSnapshots.map(async (snapshot) => {
      const response = await fetch("/api/cloud/evs/snapshots", {
        body: JSON.stringify({ projectId: snapshot.projectId, snapshotId: snapshot.id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as SnapshotActionResponse;
      return { error: response.ok ? null : result.error ?? "Snapshot deletion failed.", snapshot };
    }));
    const failed = results.filter((result) => result.error);

    setMessage(
      failed.length
        ? `${results.length - failed.length} delete requests submitted. ${failed.length} failed: ${failed.map((result) => result.snapshot.name).join(", ")}.`
        : `${results.length} delete requests submitted.`,
    );
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton disabled={!snapshots.length} onClick={() => { setConfirmText(""); setMessage(""); setOpen(true); }} size="md" variant="danger">
        <Trash2 className="size-4" />
        Delete selected
      </ConsoleButton>
      {open ? (
        <ConsoleModal
          description={`${eligibleSnapshots.length} of ${snapshots.length} selected snapshots can be deleted.`}
          footer={(
            <ConsoleModalActions>
              <ConsoleButton onClick={() => setOpen(false)} size="md" variant="neutral">Cancel</ConsoleButton>
              <ConsoleButton disabled={pending || !canSubmit} onClick={submit} size="md" variant="danger">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Delete {eligibleSnapshots.length}
              </ConsoleButton>
            </ConsoleModalActions>
          )}
          onClose={() => setOpen(false)}
          title="Delete selected EVS snapshots"
          tone="danger"
        >
          <ConsoleModalBody>
            <ConsoleCallout tone={eligibleSnapshots.length === snapshots.length ? "warning" : "danger"}>
              {snapshots.length - eligibleSnapshots.length
                ? `${snapshots.length - eligibleSnapshots.length} snapshots are busy and will be skipped.`
                : "Snapshot deletion cannot be undone."}
            </ConsoleCallout>
            <ConsoleField label="Type DELETE to confirm">
              <ConsoleInput className="border-[#fda29b]" focusTone="danger" onChange={(event) => setConfirmText(event.target.value)} value={confirmText} />
            </ConsoleField>
          </ConsoleModalBody>
          {message ? <ConsoleModalMessage tone="danger">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteEvsSnapshotButton({
  snapshot,
}: {
  snapshot: EvsSnapshotAction;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canDelete = ["available", "error", "error_deleting"].includes(
    snapshot.status.toLowerCase(),
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/snapshots", {
      body: JSON.stringify({
        projectId: snapshot.projectId,
        snapshotId: snapshot.id,
      }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as SnapshotActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Snapshot deletion failed.");
      setPending(false);
      return;
    }

    setMessage("Snapshot deletion submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!canDelete}
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="md"
        title={canDelete ? "Delete snapshot" : "Snapshot must be available or error to delete."}
        variant="dangerOutline"
      >
        <Trash2 className="size-4" />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>This deletes snapshot {snapshot.name}.</>}
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">This action cannot be undone.</p>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>Cancel</ConsoleButton>
                <ConsoleButton disabled={pending || !canDelete} onClick={submit} size="md" variant="danger">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          onClose={() => setOpen(false)}
          title="Delete EVS snapshot"
          tone="danger"
        >
            {message ? <ConsoleModalMessage tone="danger">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function RollbackEvsSnapshotButton({
  snapshot,
}: {
  snapshot: EvsSnapshotAction;
}) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canRollback = snapshot.status.toLowerCase() === "available";
  const canSubmit = canRollback && confirmText.trim() === "ROLLBACK";

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/snapshots", {
      body: JSON.stringify({
        action: "rollback",
        diskId: snapshot.diskId,
        projectId: snapshot.projectId,
        snapshotId: snapshot.id,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as SnapshotActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Snapshot rollback failed.");
      setPending(false);
      return;
    }

    setMessage(result.jobId ? `Rollback submitted: ${result.jobId}` : "Rollback submitted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!canRollback}
        onClick={() => {
          setConfirmText("");
          setMessage("");
          setOpen(true);
        }}
        size="md"
        title={canRollback ? "Rollback source disk" : "Snapshot must be available to roll back."}
        variant="orangeOutline"
      >
        <RotateCcw className="size-4" />
        Rollback
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>Restore the source disk to snapshot {snapshot.name}.</>}
          footer={(
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>Cancel</ConsoleButton>
              <ConsoleButton className="border-[#f97316] bg-[#f97316] hover:bg-[#ea580c]" disabled={pending || !canSubmit} onClick={submit} size="md" variant="orange">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Rollback
              </ConsoleButton>
            </div>
          )}
          onClose={() => setOpen(false)}
          panelClassName="border-[#fed7aa]"
          title="Rollback EVS snapshot"
        >
            <ConsoleModalBody>
              <ConsoleCallout tone="warning">
                Rolling back overwrites disk data created after the snapshot point.
              </ConsoleCallout>
              <ConsoleField label="Type ROLLBACK to confirm">
                <ConsoleInput className="border-[#fed7aa]" focusTone="orange" onChange={(event) => setConfirmText(event.target.value)} value={confirmText} />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="orange">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
