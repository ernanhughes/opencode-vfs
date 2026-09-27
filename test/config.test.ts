import { describe, expect, test } from "bun:test"
import { resolveConfig } from "../src/config.js"
import { protectPayload } from "../src/redact.js"

describe("configuration", () => {
  test("defaults to external sidecar storage", () => {
    const config = resolveConfig(undefined, "demo", "/src/demo")
    expect(config.storage.target).toBe("external")
    expect(config.storage.repo).toContain("demo")
    expect(config.privacy.mode).toBe("redacted")
  })

  test("current mode writes into source repository", () => {
    const config = resolveConfig(
      { storage: { target: "current" } },
      "demo",
      "/src/demo",
    )
    expect(config.storage.repo).toBe("/src/demo")
  })
})

describe("privacy", () => {
  test("redacts secret-like keys and bearer tokens", () => {
    const config = resolveConfig(undefined, "demo", "/src/demo")
    const value = protectPayload(
      {
        password: "hunter2",
        text: "Authorization: Bearer abcdefghijklmnop",
      },
      config.privacy,
    ) as Record<string, unknown>

    expect(value.password).toBe("[REDACTED]")
    expect(String(value.text)).not.toContain("abcdefghijklmnop")
  })

  test("hash-only stores no raw payload", () => {
    const config = resolveConfig(
      { privacy: { mode: "hash-only" } },
      "demo",
      "/src/demo",
    )
    const value = protectPayload({ prompt: "private" }, config.privacy) as Record<string, unknown>
    expect(value.sha256).toBeTruthy()
    expect(JSON.stringify(value)).not.toContain("private")
  })
})
