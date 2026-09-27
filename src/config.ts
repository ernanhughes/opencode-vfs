import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ProvenanceOptions, ResolvedConfig } from "./types.js"

const DEFAULT_REDACT_KEYS = [
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
]

export function resolveConfig(
  options: ProvenanceOptions | undefined,
  projectID: string,
  sourceRoot: string,
): ResolvedConfig {
  const target = options?.storage?.target ?? "external"
  const repo =
    target === "current"
      ? sourceRoot
      : resolve(
          expandHome(
            options?.storage?.repo ??
              join(homedir(), ".opencode", "provenance", projectID),
          ),
        )

  return {
    storage: {
      target,
      repo,
      path: options?.storage?.path ?? ".opencode-vfs",
      autoCommit: options?.storage?.autoCommit ?? true,
      push: options?.storage?.push ?? false,
    },
    capture: {
      prompts: options?.capture?.prompts ?? true,
      responses: options?.capture?.responses ?? true,
      tools: options?.capture?.tools ?? true,
      diffs: options?.capture?.diffs ?? true,
      events: options?.capture?.events ?? true,
    },
    privacy: {
      mode: options?.privacy?.mode ?? "redacted",
      maxStringBytes: options?.privacy?.maxStringBytes ?? 128_000,
      redactKeys: [
        ...DEFAULT_REDACT_KEYS,
        ...(options?.privacy?.redactKeys ?? []),
      ],
    },
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2))
  }
  return value
}
