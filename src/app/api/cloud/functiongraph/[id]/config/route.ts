import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  invalidateCloudResult,
  updateFunctionGraphFunctionConfig,
  type UpdateFunctionGraphConfigInput,
} from "@/lib/huawei-cloud";

const memorySizes = new Set([
  128, 256, 512, 768, 1024, 1280, 1536, 2048, 2560, 3072, 4096,
]);

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalBoolean(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return value === true || value === "true";
}

function parseJsonField(body: Record<string, unknown>, key: string) {
  const value = body[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${key} must contain valid JSON.`);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!rawBody) {
    return NextResponse.json(
      { error: "Configuration payload is required." },
      { status: 400 },
    );
  }

  let input: UpdateFunctionGraphConfigInput;

  try {
    const memorySize = optionalNumber(rawBody.memorySize);
    const timeout = optionalNumber(rawBody.timeout);
    const initializerTimeout = optionalNumber(rawBody.initializerTimeout);
    const strategyConcurrency = optionalNumber(rawBody.strategyConcurrency);
    const ephemeralStorage = optionalNumber(rawBody.ephemeralStorage);

    input = {
      appXrole: cleanString(rawBody.appXrole),
      customImageConfig: parseJsonField(rawBody, "customImageConfig"),
      description: cleanString(rawBody.description),
      domainNamesConfig: parseJsonField(rawBody, "domainNamesConfig"),
      enableAuthInHeader: optionalBoolean(rawBody.enableAuthInHeader),
      enableLtsLog: optionalBoolean(rawBody.enableLtsLog),
      encryptedUserData: cleanString(rawBody.encryptedUserData),
      enterpriseProjectId: cleanString(rawBody.enterpriseProjectId),
      ephemeralStorage,
      extendConfig: parseJsonField(rawBody, "extendConfig"),
      funcVpcConfig: parseJsonField(rawBody, "funcVpcConfig"),
      handler: cleanString(rawBody.handler),
      initializerHandler: cleanString(rawBody.initializerHandler),
      initializerTimeout,
      logConfig: parseJsonField(rawBody, "logConfig"),
      memorySize,
      mountConfig: parseJsonField(rawBody, "mountConfig"),
      name: cleanString(rawBody.name),
      networkController: parseJsonField(rawBody, "networkController"),
      projectId: cleanString(rawBody.projectId) || undefined,
      runtime: cleanString(rawBody.runtime),
      strategyConcurrency,
      strategyConfig: parseJsonField(rawBody, "strategyConfig"),
      timeout,
      userData: cleanString(rawBody.userData),
      xrole: cleanString(rawBody.xrole),
    };
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid configuration payload.",
      },
      { status: 400 },
    );
  }

  if (
    input.name &&
    !/^[A-Za-z][A-Za-z0-9_-]{0,58}[A-Za-z0-9]$|^[A-Za-z]$/.test(input.name)
  ) {
    return NextResponse.json(
      {
        error:
          "Function name must be 1-60 letters, digits, hyphens, or underscores, start with a letter, and end with a letter or digit.",
      },
      { status: 400 },
    );
  }

  if (
    input.handler &&
    (input.handler.length < 3 || input.handler.length > 128)
  ) {
    return NextResponse.json(
      { error: "Handler must be 3-128 characters." },
      { status: 400 },
    );
  }

  if (input.memorySize !== undefined && !memorySizes.has(input.memorySize)) {
    return NextResponse.json(
      { error: "Choose a supported memory size." },
      { status: 400 },
    );
  }

  if (
    input.timeout !== undefined &&
    (!Number.isInteger(input.timeout) ||
      input.timeout < 3 ||
      input.timeout > 259_200)
  ) {
    return NextResponse.json(
      { error: "Timeout must be an integer between 3 and 259200 seconds." },
      { status: 400 },
    );
  }

  if (
    input.initializerTimeout !== undefined &&
    (!Number.isInteger(input.initializerTimeout) ||
      input.initializerTimeout < 1 ||
      input.initializerTimeout > 300)
  ) {
    return NextResponse.json(
      {
        error:
          "Initializer timeout must be an integer between 1 and 300 seconds.",
      },
      { status: 400 },
    );
  }

  if (
    input.strategyConcurrency !== undefined &&
    (!Number.isInteger(input.strategyConcurrency) ||
      input.strategyConcurrency < 0)
  ) {
    return NextResponse.json(
      { error: "Concurrency must be a positive integer or zero." },
      { status: 400 },
    );
  }

  try {
    const fn = await updateFunctionGraphFunctionConfig(session, id, input);

    await Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.functionGraphCode(id)),
      invalidateCloudResult(session, "listFunctionGraphFunctions"),
    ]);

    return NextResponse.json({ function: fn, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph configuration update failed.",
      },
      { status: 502 },
    );
  }
}
