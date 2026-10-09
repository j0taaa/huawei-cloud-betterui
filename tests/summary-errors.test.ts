import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudLoadError } from "@/lib/huawei/errors";
import { summaryErrors } from "@/lib/huawei/summary-errors";
import { loadAcrossProjects } from "@/lib/huawei/projects";
import { project, session } from "./fixtures/session";

test("regional inventory never queries MOS, including existing sessions", async () => {
  const calls: string[] = [];
  const data = await loadAcrossProjects(
    {
      ...session,
      projects: [
        { ...project, projectId: "obs", projectName: "MOS", region: "MOS" },
        project,
      ],
    },
    async (item) => {
      calls.push(item.projectId);
      return [item.projectId];
    },
  );
  assert.deepEqual(calls, [project.projectId]);
  assert.deepEqual(data, [project.projectId]);
});

test("dashboard groups repeated regional failures and identifies every affected service", async () => {
  const denied = {
    ...project,
    projectId: "denied",
    projectName: "cn-north-1",
    region: "cn-north-1",
  };
  const results = await Promise.allSettled(
    ["ECS", "EVS", "VPC"].map(() =>
      loadAcrossProjects(
        { ...session, projects: [project, denied] },
        async (item) => {
          if (item.projectId === denied.projectId)
            throw new Error("403 permission denied");
          return [{ id: "available" }];
        },
      ),
    ),
  );
  assert.deepEqual(summaryErrors(results, ["ECS", "EVS", "VPC"]), [
    "cn-north-1 — ECS, EVS, VPC: 403 permission denied",
  ]);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected")
      assert.deepEqual(result.reason.partialData, [{ id: "available" }]);
  }
});

test("dashboard retains distinct failures and subprojects sharing a region", () => {
  const issue = {
    projectId: "a",
    projectName: "eu-west-0_team",
    region: "eu-west-0",
    message: "403 permission denied",
  };
  const results: PromiseSettledResult<unknown>[] = [
    { status: "rejected", reason: new CloudLoadError("failure", [], [issue]) },
    {
      status: "rejected",
      reason: new CloudLoadError(
        "failure",
        [],
        [{ ...issue, projectId: "b", projectName: "eu-west-0_other" }],
      ),
    },
    {
      status: "rejected",
      reason: new CloudLoadError(
        "failure",
        [],
        [{ ...issue, message: "Huawei Cloud could not be reached." }],
      ),
    },
    { status: "fulfilled", value: [] },
    { status: "rejected", reason: new Error("Sign in again.") },
  ];
  assert.deepEqual(
    summaryErrors(results, ["ECS", "EVS", "VPC", "ELB", "RDS"]),
    [
      "eu-west-0_team (eu-west-0) — ECS: 403 permission denied",
      "eu-west-0_other (eu-west-0) — EVS: 403 permission denied",
      "eu-west-0_team (eu-west-0) — VPC: Huawei Cloud could not be reached.",
      "RDS: Sign in again.",
    ],
  );
  assert.deepEqual(
    summaryErrors([{ status: "fulfilled", value: [] }], ["ECS"]),
    [],
  );
});
