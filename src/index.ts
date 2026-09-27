import { createHash } from "node:crypto"
import type { Plugin } from "@opencode-ai/plugin"
import { resolveConfig } from "./config.js"
import { GitRepo } from "./git.js"
import { protectPayload, sha256, stableStringify } from "./redact.js"
import { ProvenanceStore } from "./store.js"
import type {
  ProvenanceEvent,
  ProvenanceOptions,
  SessionBuffer,
} from "./types.js"

export const OpenCodeVFS: Plugin = async (
  { project, directory, worktree },
  options,
) => {
  const sourceRoot = worktree || directory
  const source = new GitRepo(sourceRoot)
  if (!source.isRepo()) {
    throw new Error(`opencode-vfs requires a Git source repository: ${sourceRoot}`)
  }

  const projectID = deriveProjectID(project as unknown as Record<string, unknown>, source)
  const config = resolveConfig(options as ProvenanceOptions | undefined, projectID, sourceRoot)
  const store = new ProvenanceStore(config, projectID, source)
  const sessions = new Map<string, SessionBuffer>()

  const record = (sessionID: string, kind: string, payload: unknown) => {
    const buffer = getBuffer(sessions, sessionID)
    const protectedPayload = protectPayload(payload, config.privacy)
    const at = new Date().toISOString()
    const event: ProvenanceEvent = {
      schema: "opencode-vfs.event.v1",
      eventID: sha256(
        stableStringify({
          projectID,
          sessionID,
          sequence: buffer.sequence,
          at,
          kind,
          protectedPayload,
        }),
      ),
      projectID,
      sessionID,
      sequence: buffer.sequence++,
      at,
      kind,
      source: source.describeSource(),
      payload: protectedPayload,
    }
    buffer.events.push(event)
  }

  const flush = (sessionID: string) => {
    const buffer = sessions.get(sessionID)
    if (!buffer) return
    const pending = buffer.events.slice(buffer.flushed)
    if (pending.length === 0) return
    store.writeSegment(sessionID, pending)
    buffer.flushed = buffer.events.length
  }

  return {
    "chat.message": async (input, output) => {
      if (!config.capture.prompts) return
      record(input.sessionID, "chat.message", {
        actor: "user",
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
        message: output.message,
        parts: output.parts,
      })
    },

    "tool.execute.before": async (input, output) => {
      if (!config.capture.tools) return
      record(input.sessionID, "tool.execute.before", {
        tool: input.tool,
        callID: input.callID,
        args: output.args,
      })
    },

    "tool.execute.after": async (input, output) => {
      if (!config.capture.tools) return
      record(input.sessionID, "tool.execute.after", {
        tool: input.tool,
        callID: input.callID,
        args: input.args,
        title: output.title,
        output: output.output,
        metadata: output.metadata,
      })
    },

    event: async ({ event }) => {
      const raw = event as unknown as {
        type?: string
        properties?: Record<string, unknown>
      }
      const type = raw.type ?? "unknown"
      const properties = raw.properties ?? {}
      const sessionID = extractSessionID(properties)
      if (!sessionID) return

      if (isOwnProvenanceEvent(type, properties, config.storage.repo, config.storage.path)) {
        return
      }

      if (type === "session.idle") {
        if (config.capture.events) record(sessionID, type, raw)
        flush(sessionID)
        return
      }

      if (type === "session.deleted") {
        if (config.capture.events) record(sessionID, type, raw)
        flush(sessionID)
        sessions.delete(sessionID)
        return
      }

      if (type === "session.diff") {
        if (config.capture.diffs) record(sessionID, type, raw)
        return
      }

      if (
        type === "message.updated" ||
        type === "message.part.updated" ||
        type === "message.part.removed" ||
        type === "message.removed"
      ) {
        if (config.capture.responses) record(sessionID, type, raw)
        return
      }

      if (
        type === "file.edited" ||
        type === "command.executed" ||
        type === "session.created" ||
        type === "session.updated" ||
        type === "session.error" ||
        type === "session.compacted" ||
        type === "session.status"
      ) {
        if (config.capture.events) record(sessionID, type, raw)
      }
    },

    dispose: async () => {
      for (const sessionID of sessions.keys()) flush(sessionID)
    },
  }
}

export default OpenCodeVFS

function deriveProjectID(project: Record<string, unknown>, source: GitRepo): string {
  if (typeof project.id === "string" && project.id.trim()) {
    return sanitize(project.id)
  }
  const identity = source.remote() ?? source.root
  return `repo-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`
}

function getBuffer(
  sessions: Map<string, SessionBuffer>,
  sessionID: string,
): SessionBuffer {
  let buffer = sessions.get(sessionID)
  if (!buffer) {
    buffer = { sessionID, sequence: 0, flushed: 0, events: [] }
    sessions.set(sessionID, buffer)
  }
  return buffer
}

function extractSessionID(properties: Record<string, unknown>): string | null {
  if (typeof properties.sessionID === "string") return properties.sessionID
  const info = properties.info
  if (info && typeof info === "object") {
    const id = (info as Record<string, unknown>).id
    if (typeof id === "string") return id
  }
  const part = properties.part
  if (part && typeof part === "object") {
    const id = (part as Record<string, unknown>).sessionID
    if (typeof id === "string") return id
  }
  const message = properties.message
  if (message && typeof message === "object") {
    const id = (message as Record<string, unknown>).sessionID
    if (typeof id === "string") return id
  }
  return null
}

function isOwnProvenanceEvent(
  type: string,
  properties: Record<string, unknown>,
  repoRoot: string,
  provenancePath: string,
): boolean {
  if (type !== "file.edited" && type !== "file.watcher.updated") return false
  const candidate =
    typeof properties.path === "string"
      ? properties.path
      : typeof properties.file === "string"
        ? properties.file
        : ""
  if (!candidate) return false
  const normalized = candidate.replaceAll("\\", "/")
  const repo = repoRoot.replaceAll("\\", "/")
  const marker = provenancePath.replaceAll("\\", "/")
  return normalized.startsWith(repo) && normalized.includes(`/${marker}/`)
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}
