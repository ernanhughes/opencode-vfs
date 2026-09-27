import { createHash } from "node:crypto"
import type { ResolvedConfig } from "./types.js"

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [
    /\b(AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*[^\s]+/gi,
    "$1=[REDACTED]",
  ],
]

export function protectPayload(
  value: unknown,
  config: ResolvedConfig["privacy"],
): unknown {
  if (config.mode === "hash-only") {
    const raw = stableStringify(value)
    return {
      sha256: sha256(raw),
      bytes: Buffer.byteLength(raw, "utf8"),
    }
  }
  if (config.mode === "full") return value
  return redactValue(value, config, new WeakSet<object>())
}

function redactValue(
  value: unknown,
  config: ResolvedConfig["privacy"],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return redactString(value, config.maxStringBytes)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value as object)) return "[CIRCULAR]"
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, config, seen))
  }

  const blocked = new Set(config.redactKeys.map((key) => key.toLowerCase()))
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, "_")
    if (blocked.has(normalized) || /(secret|password|token|authorization|cookie|api_?key)/i.test(key)) {
      output[key] = "[REDACTED]"
      continue
    }
    output[key] = redactValue(item, config, seen)
  }
  return output
}

function redactString(input: string, maxBytes: number): string {
  let value = input
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    value = value.replace(pattern, replacement)
  }
  const buffer = Buffer.from(value, "utf8")
  if (buffer.length <= maxBytes) return value
  return buffer.subarray(0, maxBytes).toString("utf8") + "\n[TRUNCATED]"
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    )
  }
  return value
}
