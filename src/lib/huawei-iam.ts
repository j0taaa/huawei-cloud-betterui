import "server-only";

import type { HuaweiProjectSession } from "@/lib/auth-session";

type IamLoginInput = {
  accountName: string;
  iamEndpoint?: string;
  password: string;
  username: string;
};

type HuaweiIamTokenBody = {
  token?: {
    expires_at?: string;
    project?: {
      id?: string;
      name?: string;
    };
    user?: {
      id?: string;
    };
  };
};

type HuaweiProject = {
  enabled?: boolean;
  id?: string;
  is_domain?: boolean;
  name?: string;
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

async function requestToken(
  endpoint: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${endpoint}/v3/auth/tokens?nocatalog=true`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json;charset=utf8",
    },
    method: "POST",
  });
  const responseBody = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        responseBody,
        "Huawei IAM rejected the login. Check the account name, IAM username, password, and API access permissions.",
      ),
    );
  }

  const token = response.headers.get("x-subject-token");
  const tokenBody = isIamTokenBody(responseBody)
    ? responseBody.token
    : undefined;

  if (!token || !tokenBody?.expires_at) {
    throw new Error("Huawei IAM did not return a usable token.");
  }

  return {
    expiresAt: tokenBody.expires_at,
    projectId: tokenBody.project?.id,
    projectName: tokenBody.project?.name,
    token,
    userId: tokenBody.user?.id,
  };
}

async function listAccessibleProjects(endpoint: string, token: string) {
  const response = await fetch(`${endpoint}/v3/auth/projects`, {
    cache: "no-store",
    headers: {
      "X-Auth-Token": token,
    },
  });
  const body = (await response.json().catch(() => null)) as {
    projects?: HuaweiProject[];
  } | null;

  if (!response.ok) {
    throw new Error(
      getErrorMessage(body, "Could not discover Huawei Cloud projects."),
    );
  }

  return (body?.projects ?? []).filter(
    (project): project is Required<Pick<HuaweiProject, "id" | "name">> &
      HuaweiProject =>
      !!project.id && !!project.name && project.enabled !== false && !project.is_domain,
  );
}

export async function createHuaweiIamSession({
  accountName,
  iamEndpoint,
  password,
  username,
}: IamLoginInput) {
  const endpoint = normalizeEndpoint(iamEndpoint);
  const unscopedToken = await requestToken(endpoint, {
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
    },
  });
  const projects = await listAccessibleProjects(endpoint, unscopedToken.token);
  const projectTokens = await Promise.all(
    projects.map(async (project): Promise<HuaweiProjectSession | null> => {
      try {
        const scopedToken = await requestToken(endpoint, {
          auth: {
            identity: {
              methods: ["token"],
              token: {
                id: unscopedToken.token,
              },
            },
            scope: {
              project: {
                id: project.id,
              },
            },
          },
        });

        if (!scopedToken.projectId || !scopedToken.projectName) {
          return null;
        }

        return {
          expiresAt: scopedToken.expiresAt,
          projectId: scopedToken.projectId,
          projectName: scopedToken.projectName,
          region: scopedToken.projectName,
          token: scopedToken.token,
        };
      } catch {
        return null;
      }
    }),
  );
  const usableProjects = projectTokens.filter(
    (project): project is HuaweiProjectSession => !!project,
  );
  const primaryProject =
    usableProjects.find((project) => project.projectName === "sa-brazil-1") ??
    usableProjects[0];

  if (!primaryProject) {
    throw new Error("No usable Huawei Cloud projects were discovered.");
  }

  return {
    expiresAt: primaryProject.expiresAt,
    iamEndpoint: endpoint,
    projects: usableProjects,
    projectId: primaryProject.projectId,
    projectName: primaryProject.projectName,
    region: primaryProject.region,
    token: primaryProject.token,
    userId: unscopedToken.userId,
  };
}
