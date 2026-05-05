import "server-only";

type IamLoginInput = {
  accountName: string;
  iamEndpoint?: string;
  password: string;
  projectName: string;
  username: string;
};

type HuaweiIamTokenBody = {
  token?: {
    catalog?: unknown[];
    expires_at?: string;
    issued_at?: string;
    project?: {
      id?: string;
      name?: string;
    };
    user?: {
      id?: string;
      name?: string;
    };
  };
};

const defaultIamEndpoint =
  process.env.HUAWEI_CLOUD_IAM_ENDPOINT ?? "https://iam.myhuaweicloud.com";

function normalizeEndpoint(endpoint: string | undefined) {
  return (endpoint || defaultIamEndpoint).replace(/\/+$/, "");
}

function getErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const record = body as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;

  if (typeof error?.message === "string") {
    return error.message;
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return fallback;
}

function isIamTokenBody(body: unknown): body is HuaweiIamTokenBody {
  return (
    !!body &&
    typeof body === "object" &&
    "token" in body &&
    typeof (body as HuaweiIamTokenBody).token === "object"
  );
}

export async function createHuaweiIamToken({
  accountName,
  iamEndpoint,
  password,
  projectName,
  username,
}: IamLoginInput) {
  const endpoint = normalizeEndpoint(iamEndpoint);
  const response = await fetch(`${endpoint}/v3/auth/tokens?nocatalog=true`, {
    body: JSON.stringify({
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              domain: {
                name: accountName,
              },
              name: username,
              password,
            },
          },
        },
        scope: {
          project: {
            name: projectName,
          },
        },
      },
    }),
    headers: {
      "Content-Type": "application/json;charset=utf8",
    },
    method: "POST",
  });

  const body = (await response.json().catch(() => null)) as
    | HuaweiIamTokenBody
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        body,
        "Huawei IAM rejected the login. Check the account name, IAM username, password, project, and API access permissions.",
      ),
    );
  }

  const token = response.headers.get("x-subject-token");
  const tokenBody = isIamTokenBody(body) ? body.token : undefined;
  const expiresAt = tokenBody?.expires_at;

  if (!token || !expiresAt) {
    throw new Error("Huawei IAM did not return a usable token.");
  }

  return {
    catalog: tokenBody?.catalog,
    expiresAt,
    iamEndpoint: endpoint,
    projectName: tokenBody?.project?.name ?? projectName,
    token,
    userId: tokenBody?.user?.id,
  };
}
