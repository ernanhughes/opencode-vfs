export type StorageTarget = "current" | "external"
export type CaptureMode = "full" | "redacted" | "hash-only"

export interface ProvenanceOptions {
  storage?: {
    target?: StorageTarget
    repo?: string
    path?: string
    autoCommit?: boolean
    push?: boolean
  }
  capture?: {
    prompts?: boolean
    responses?: boolean
    tools?: boolean
    diffs?: boolean
    events?: boolean
  }
  privacy?: {
    mode?: CaptureMode
    maxStringBytes?: number
    redactKeys?: string[]
  }
}

export interface ResolvedConfig {
  storage: {
    target: StorageTarget
    repo: string
    path: string
    autoCommit: boolean
    push: boolean
  }
  capture: {
    prompts: boolean
    responses: boolean
    tools: boolean
    diffs: boolean
    events: boolean
  }
  privacy: {
    mode: CaptureMode
    maxStringBytes: number
    redactKeys: string[]
  }
}

export interface SourceState {
  root: string
  remote: string | null
  branch: string | null
  head: string | null
  status: string
  diffSha256: string
}

export interface ProvenanceEvent {
  schema: "opencode-vfs.event.v1"
  eventID: string
  projectID: string
  sessionID: string
  sequence: number
  at: string
  kind: string
  source: SourceState
  payload: unknown
}

export interface SessionBuffer {
  sessionID: string
  sequence: number
  flushed: number
  events: ProvenanceEvent[]
}
