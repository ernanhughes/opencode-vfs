import { sha256, stableStringify } from "./redact.js"
import type { SourceState } from "./types.js"

export const EDGE_SCHEMA = "opencode-vfs.edge.v1" as const
export const EDGE_RECORD_SCHEMA = "opencode-vfs.edge-record.v1" as const
export const ARTIFACT_REGISTRATION_SCHEMA = "opencode-vfs.artifact-registration.v1" as const

export type WorkRef = { kind: "work"; work_id: string; version?: number }
export type ArtifactRef = {
  kind: "artifact"
  artifact_id: string
  schema: string
  producer?: { component: string; version?: string }
}
export type EventRef = { kind: "event"; event_id: string; session_id: string }
export type OperationRef = { kind: "operation"; work_id: string; op_id: string }
export type NodeRef = WorkRef | ArtifactRef | EventRef | OperationRef

export type ProvenanceRef = {
  project_id: string
  session_id: string
  event_id?: string
  segment?: string
  source_head?: string
  source_diff_sha256?: string
  work_id?: string
}

export const CAUSAL_RELATIONS = [
  "BELONGS_TO_WORK",
  "USED",
  "PRODUCED",
  "OBSERVED_BY",
  "VERIFIED_BY",
  "SUPPORTED_BY",
  "ACCEPTED_BY",
  "DEPENDS_ON",
] as const
export type CausalRelation = (typeof CAUSAL_RELATIONS)[number]

export type CausalEdge = {
  schema: typeof EDGE_SCHEMA
  edge_id: string
  project_id: string
  work?: WorkRef
  from: NodeRef
  relation: CausalRelation
  to: NodeRef
  producer: { component: string; version: string }
  provenance?: ProvenanceRef
  source?: SourceState
}

export type EdgeRecord = {
  schema: typeof EDGE_RECORD_SCHEMA
  record_id: string
  edge: CausalEdge
  recorded_at: string
  recorder: { component: "opencode-vfs"; version: string }
}

export type ArtifactRegistration = {
  schema: typeof ARTIFACT_REGISTRATION_SCHEMA
  registration_id: string
  project_id: string
  artifact: ArtifactRef
  provenance?: ProvenanceRef
  source?: SourceState
  registered_at: string
  recorder: { component: "opencode-vfs"; version: string }
}

export type Validation<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
const HASH = /^[0-9a-f]{64}$/
const ID_MAX = 512
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX
const fail = <T>(code: string, message: string): Validation<T> => ({ ok: false, code, message })

export function validateWorkRef(value: unknown): Validation<WorkRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("WORK_REF_MALFORMED", "work ref must be an object")
  const v = value as Record<string, unknown>
  if (v.kind !== "work" || !nonEmpty(v.work_id)) return fail("WORK_REF_BAD_ID", "work ref requires kind=work and work_id")
  if (v.version !== undefined && (!Number.isInteger(v.version) || (v.version as number) < 1)) return fail("WORK_REF_BAD_VERSION", "work version must be a positive integer")
  return { ok: true, value: value as WorkRef }
}

export function validateArtifactRef(value: unknown): Validation<ArtifactRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("ARTIFACT_REF_MALFORMED", "artifact ref must be an object")
  const v = value as Record<string, unknown>
  if (v.kind !== "artifact" || !nonEmpty(v.artifact_id) || !nonEmpty(v.schema)) return fail("ARTIFACT_REF_BAD_ID", "artifact ref requires kind, artifact_id, and schema")
  if (v.producer !== undefined) {
    const p = v.producer as Record<string, unknown>
    if (!p || typeof p !== "object" || !nonEmpty(p.component) || (p.version !== undefined && !nonEmpty(p.version))) return fail("ARTIFACT_REF_BAD_PRODUCER", "producer component/version is malformed")
  }
  return { ok: true, value: value as ArtifactRef }
}

export function validateNodeRef(value: unknown): Validation<NodeRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("NODE_REF_MALFORMED", "endpoint must be an object")
  const v = value as Record<string, unknown>
  if (v.kind === "work") return validateWorkRef(value)
  if (v.kind === "artifact") return validateArtifactRef(value)
  if (v.kind === "event" && nonEmpty(v.event_id) && nonEmpty(v.session_id)) return { ok: true, value: value as EventRef }
  if (v.kind === "operation" && nonEmpty(v.work_id) && nonEmpty(v.op_id)) return { ok: true, value: value as OperationRef }
  return fail("NODE_REF_UNSUPPORTED", "endpoint kind or identity is unsupported")
}

export function validateProvenanceRef(value: unknown, projectID?: string): Validation<ProvenanceRef> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("PROVENANCE_MALFORMED", "provenance must be an object")
  const v = value as Record<string, unknown>
  if (!nonEmpty(v.project_id) || !nonEmpty(v.session_id)) return fail("PROVENANCE_MISSING_ID", "project_id and session_id are required")
  if (projectID !== undefined && v.project_id !== projectID) return fail("PROVENANCE_PROJECT_MISMATCH", "provenance project does not match ledger")
  for (const key of ["event_id", "segment", "source_head", "work_id"] as const) if (v[key] !== undefined && !nonEmpty(v[key])) return fail("PROVENANCE_BAD_FIELD", `${key} must be non-empty`)
  if (v.source_diff_sha256 !== undefined && (typeof v.source_diff_sha256 !== "string" || !HASH.test(v.source_diff_sha256))) return fail("PROVENANCE_BAD_DIFF", "source_diff_sha256 must be 64 lowercase hex chars")
  return { ok: true, value: value as ProvenanceRef }
}

export function validateSourceState(value: unknown): Validation<SourceState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("SOURCE_MALFORMED", "source must be an object")
  const v = value as Record<string, unknown>
  if (!nonEmpty(v.root) || typeof v.status !== "string" || typeof v.diffSha256 !== "string" || !HASH.test(v.diffSha256)) return fail("SOURCE_BAD_STATE", "source root/status/diffSha256 are invalid")
  for (const key of ["remote", "branch", "head"] as const) if (v[key] !== null && typeof v[key] !== "string") return fail("SOURCE_BAD_STATE", `${key} must be string or null`)
  return { ok: true, value: value as SourceState }
}

export function edgeIdentity(input: Omit<CausalEdge, "schema" | "edge_id">): string {
  return sha256(stableStringify({ schema: EDGE_SCHEMA, project_id: input.project_id, work: input.work ?? null, from: input.from, relation: input.relation, to: input.to, producer: input.producer }))
}

export function buildEdge(input: Omit<CausalEdge, "schema" | "edge_id">): CausalEdge {
  const edge = { schema: EDGE_SCHEMA, edge_id: "", ...input } as CausalEdge
  edge.edge_id = edgeIdentity(input)
  const valid = validateEdge(edge, input.project_id)
  if (!valid.ok) throw new Error(`${valid.code}: ${valid.message}`)
  return edge
}

export function validateEdge(value: unknown, projectID?: string): Validation<CausalEdge> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("EDGE_MALFORMED", "edge must be an object")
  const v = value as Record<string, unknown>
  if (v.schema !== EDGE_SCHEMA || typeof v.edge_id !== "string" || !HASH.test(v.edge_id)) return fail("EDGE_BAD_SCHEMA_OR_ID", "edge schema/id invalid")
  if (!nonEmpty(v.project_id) || (projectID !== undefined && v.project_id !== projectID)) return fail("EDGE_BAD_PROJECT", "edge project invalid")
  if (!(CAUSAL_RELATIONS as readonly unknown[]).includes(v.relation)) return fail("EDGE_BAD_RELATION", "unknown causal relation")
  for (const endpoint of [v.from, v.to]) { const result = validateNodeRef(endpoint); if (!result.ok) return result as Validation<CausalEdge> }
  if (v.work !== undefined) { const result = validateWorkRef(v.work); if (!result.ok) return result as Validation<CausalEdge> }
  const p = v.producer as Record<string, unknown>
  if (!p || typeof p !== "object" || !nonEmpty(p.component) || !nonEmpty(p.version)) return fail("EDGE_BAD_PRODUCER", "edge producer required")
  if (v.provenance !== undefined) { const result = validateProvenanceRef(v.provenance, v.project_id as string); if (!result.ok) return result as Validation<CausalEdge> }
  if (v.source !== undefined) { const result = validateSourceState(v.source); if (!result.ok) return result as Validation<CausalEdge> }
  const { schema: _s, edge_id: _i, ...body } = v
  if (edgeIdentity(body as Omit<CausalEdge, "schema" | "edge_id">) !== v.edge_id) return fail("EDGE_ID_MISMATCH", "edge id does not match semantic content")
  return { ok: true, value: value as CausalEdge }
}
