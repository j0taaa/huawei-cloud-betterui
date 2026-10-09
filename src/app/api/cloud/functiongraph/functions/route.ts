import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createFunctionGraphFunction,
  invalidateCloudResult,
  type CreateFunctionGraphFunctionInput,
} from "@/lib/huawei-cloud";

const runtimes = new Set(["Python3.10", "Python3.9", "Node.js18.15", "Node.js16.17"]);
const defaultCode = `def handler(event, context):
    return {"message": "Hello from FunctionGraph", "event": event}
`;

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
    description?: unknown;
    handler?: unknown;
    memorySize?: unknown;
    name?: unknown;
    packageName?: unknown;
    projectId?: unknown;
    runtime?: unknown;
    timeout?: unknown;
  } | null;
  const memorySize = Number(body?.memorySize ?? 128);
  const timeout = Number(body?.timeout ?? 3);
  const input: CreateFunctionGraphFunctionInput = {
    code: cleanString(body?.code) || defaultCode,
    description: cleanString(body?.description) || undefined,
    handler: cleanString(body?.handler) || "index.handler",
    memorySize,
    name: cleanString(body?.name),
    packageName: cleanString(body?.packageName) || "default",
    projectId: cleanString(body?.projectId) || undefined,
    runtime: cleanString(body?.runtime) || "Python3.10",
    timeout,
  };

  if (!/^[A-Za-z][A-Za-z0-9_-]{0,58}[A-Za-z0-9]$|^[A-Za-z]$/.test(input.name)) {
    return NextResponse.json(
      {
        error:
          "Function name must be 1-60 letters, digits, hyphens, or underscores, start with a letter, and end with a letter or digit.",
      },
      { status: 400 },
    );
  }

  if (!/^[A-Za-z0-9_-]{1,60}$/.test(input.packageName)) {
    return NextResponse.json(
      { error: "Package must be 1-60 letters, digits, hyphens, or underscores." },
      { status: 400 },
    );
  }

  if (!runtimes.has(input.runtime)) {
    return NextResponse.json(
      { error: "Unsupported runtime for quick creation." },
      { status: 400 },
    );
  }

  if (input.handler.length < 3 || input.handler.length > 128 || !input.handler.includes(".")) {
    return NextResponse.json(
      { error: "Handler must be 3-128 characters and use the file.function format." },
      { status: 400 },
    );
  }

  if (![128, 256, 512, 768, 1024, 1280, 1536, 2048, 2560, 3072, 4096].includes(input.memorySize)) {
    return NextResponse.json(
      { error: "Choose a supported memory size." },
      { status: 400 },
    );
  }

  if (!Number.isInteger(input.timeout) || input.timeout < 3 || input.timeout > 259_200) {
    return NextResponse.json(
      { error: "Timeout must be an integer between 3 and 259200 seconds." },
      { status: 400 },
    );
  }

  if (input.code.length > 200_000) {
    return NextResponse.json(
      { error: "Inline code must be 200 KB or smaller." },
      { status: 400 },
    );
  }

  try {
    const fn = await createFunctionGraphFunction(session, input);

    await invalidateCloudResult(session, "listFunctionGraphFunctions");

    return NextResponse.json({
      id: fn.id,
      name: fn.name,
      ok: true,
      urn: fn.urn,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph function creation failed.",
      },
      { status: 502 },
    );
  }
}
