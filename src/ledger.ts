import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { ARTIFACT_REGISTRATION_SCHEMA, EDGE_RECORD_SCHEMA, buildEdge, validateArtifactRef, validateEdge, validateProvenanceRef, type ArtifactRef, type ArtifactRegistration, type CausalEdge, type EdgeRecord, type ProvenanceRef, type WorkRef } from "./contracts.js"
import { sha256, stableStringify } from "./redact.js"
import type { SourceState } from "./types.js"
import { ensureParent } from "./git.js"

const VERSION = "0.2.0"
const QUERY_CHUNK = 64 * 1024

export class ProvenanceLedger {
  private observationSequence = 0
  constructor(readonly projectRoot: string, readonly projectID: string) {}

  registerArtifact(artifact: ArtifactRef, options: { provenance?: ProvenanceRef; source?: SourceState; registered_at?: string } = {}): ArtifactRegistration {
    const valid = validateArtifactRef(artifact); if (!valid.ok) throw new Error(`${valid.code}: ${valid.message}`)
    if (options.provenance) { const p = validateProvenanceRef(options.provenance, this.projectID); if (!p.ok) throw new Error(`${p.code}: ${p.message}`) }
    const semantic = sha256(stableStringify({ project_id: this.projectID, artifact }))
    const path = join(this.projectRoot, "artifacts", sha256(artifact.artifact_id), "identity.json")
    const registered_at = options.registered_at ?? new Date().toISOString()
    const record: ArtifactRegistration = { schema: ARTIFACT_REGISTRATION_SCHEMA, registration_id: semantic, project_id: this.projectID, artifact, ...(options.provenance ? { provenance: options.provenance } : {}), ...(options.source ? { source: options.source } : {}), registered_at, recorder: { component: "opencode-vfs", version: VERSION } }
    const bytes = JSON.stringify(record, null, 2) + "\n"
    if (existsSync(path)) {
      const current = JSON.parse(readFileSync(path, "utf8")) as ArtifactRegistration
      if (stableStringify(current.artifact) !== stableStringify(artifact)) throw new Error(`ARTIFACT_ID_COLLISION: ${artifact.artifact_id}`)
      return current
    }
    ensureParent(path); writeFileSync(path, bytes, { encoding: "utf8", flag: "wx" })
    this.appendIndex("artifact", artifact.artifact_id, { type: "artifact", path, artifact_id: artifact.artifact_id, work_id: options.provenance?.work_id ?? null })
    return record
  }

  recordEdge(input: Omit<CausalEdge, "schema" | "edge_id">, recorded_at = new Date().toISOString()): EdgeRecord {
    const edge = buildEdge(input)
    const valid = validateEdge(edge, this.projectID); if (!valid.ok) throw new Error(`${valid.code}: ${valid.message}`)
    const record_id = sha256(stableStringify({ edge_id: edge.edge_id, recorded_at, sequence: this.observationSequence++ }))
    const record: EdgeRecord = { schema: EDGE_RECORD_SCHEMA, record_id, edge, recorded_at, recorder: { component: "opencode-vfs", version: VERSION } }
    const path = join(this.projectRoot, "causal", "records", `${record_id}.json`)
    ensureParent(path); writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" })
    for (const endpoint of [edge.from, edge.to]) if (endpoint.kind === "artifact") this.appendIndex("artifact", endpoint.artifact_id, { type: "edge", path, edge_id: edge.edge_id, record_id, work_id: edge.work?.work_id ?? null })
    const workIDs = new Set<string>()
    if (edge.work) workIDs.add(edge.work.work_id)
    for (const endpoint of [edge.from, edge.to]) if (endpoint.kind === "work" || endpoint.kind === "operation") workIDs.add(endpoint.work_id)
    for (const workID of workIDs) this.appendIndex("work", workID, { type: "edge", path, edge_id: edge.edge_id, record_id, work_id: workID })
    return record
  }

  getEdgesForArtifact(artifactID: string, options: { limit?: number; offset?: number } = {}): EdgeRecord[] { return this.readEdgeIndex("artifact", artifactID, options) }
  getWorkHistory(work: WorkRef | string, options: { limit?: number; offset?: number } = {}): EdgeRecord[] { return this.readEdgeIndex("work", typeof work === "string" ? work : work.work_id, options) }

  private indexPath(kind: "artifact" | "work", id: string): string { return join(this.projectRoot, "indexes", kind, `${sha256(id)}.jsonl`) }
  private appendIndex(kind: "artifact" | "work", id: string, entry: Record<string, unknown>): void { const path = this.indexPath(kind, id); ensureParent(path); appendFileSync(path, JSON.stringify({ id, ...entry }) + "\n", "utf8") }
  private readEdgeIndex(kind: "artifact" | "work", id: string, options: { limit?: number; offset?: number }): EdgeRecord[] {
    const limit = options.limit ?? 100; const offset = options.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new Error("QUERY_BOUNDS: limit must be 1..1000 and offset non-negative")
    const path = this.indexPath(kind, id); if (!existsSync(path)) return []
    const records: EdgeRecord[] = []
    let matched = 0
    streamLines(path, (line) => {
      if (records.length >= limit) return false
      const entry = JSON.parse(line) as { type?: string; path?: string }
      if (entry.type !== "edge" || typeof entry.path !== "string") return true
      if (matched < offset) { matched++; return true }
      records.push(JSON.parse(readFileSync(entry.path, "utf8")) as EdgeRecord); return true
    })
    return records
  }
}

function streamLines(path: string, visit: (line: string) => boolean): void {
  const fd = openSync(path, "r"); const buffer = Buffer.allocUnsafe(QUERY_CHUNK); const decoder = new StringDecoder("utf8"); let carry = ""
  try { for (;;) { const count = readSync(fd, buffer, 0, buffer.length, null); if (!count) break; const text = carry + decoder.write(buffer.subarray(0, count)); const lines = text.split("\n"); carry = lines.pop() ?? ""; for (const line of lines) if (line && !visit(line)) return } const final = carry + decoder.end(); if (final) visit(final) } finally { closeSync(fd) }
}
