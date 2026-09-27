# opencode-vfs

**Git-backed provenance for AI-assisted development.**

opencode-vfs connects an OpenCode interaction to the Git repository being changed. It records the observable prompt/response/tool history alongside source Git state so you can answer:

- What changed?
- Why did it change?
- What did the user ask?
- Which model and tools participated?
- What repository state did the interaction act on?
- What diff or source commit resulted?

The design is descended from Writer vFS, but the OpenCode plugin focuses on **provenance rather than owning the workspace**.

## Core idea

```text
human intent
   ↓
OpenCode interaction
   ↓
model + tools
   ↓
source repository changes
   ↓
Git commit / working tree

          ↘
           provenance Git
           prompt + response + tools + source state
```

Git remains the byte-level source of truth. opencode-vfs adds the semantic/audit trail.

## Storage modes

### External provenance repo (default)

The source code repository stays clean.

```jsonc
{
  "plugin": [
    [
      "opencode-vfs",
      {
        "storage": {
          "target": "external",
          "repo": "C:\\Projects\\provenance\\language",
          "autoCommit": true,
          "push": false
        }
      }
    ]
  ]
}
```

If `repo` is omitted, the default is:

```text
~/.opencode/provenance/<project-id>
```

The plugin initializes that directory as a Git repository if necessary.

### Current source repo

Use this only when provenance belongs with the code:

```jsonc
{
  "plugin": [
    [
      "opencode-vfs",
      {
        "storage": {
          "target": "current",
          "path": ".opencode-vfs",
          "autoCommit": true
        }
      }
    ]
  ]
}
```

Only the provenance path is staged by the plugin; unrelated working-tree changes are not added to its provenance commit.

## What is captured

By default:

- user messages and selected model identity
- assistant message/message-part updates
- tool calls before and after execution
- session diffs
- file, command, and session lifecycle events
- source HEAD, branch, origin, status, and diff hash

OpenCode currently exposes plugin hooks for chat messages, tool execution, generic session/message/file events, and session diffs, which lets provenance be captured at the interaction boundary rather than reconstructed later.

## Privacy

Default: `redacted`.

```jsonc
{
  "privacy": {
    "mode": "redacted",
    "maxStringBytes": 128000,
    "redactKeys": ["my_custom_secret"]
  }
}
```

Modes:

- `redacted` — removes common secret/token fields and patterns
- `full` — stores observable payloads verbatim
- `hash-only` — stores only digest + byte count

**Keep provenance repositories private by default.** Prompts can contain unpublished code, local paths, research notes, or sensitive data.

## Capture controls

```jsonc
{
  "capture": {
    "prompts": true,
    "responses": true,
    "tools": true,
    "diffs": true,
    "events": true
  }
}
```

## Provenance layout

```text
.opencode-vfs/
  projects/
    <project-id>/
      sessions/
        <session-id>/
          <timestamp>-<content-hash>.json
```

Every session segment is append-only and content identified.

## Development

```bash
bun install
bun test
bun run typecheck
```

## Design boundary

opencode-vfs records and links evidence. It does **not** decide whether a change is correct.

That preserves the original Writer vFS principle: tracking infrastructure should remain separate from agents and reviewers that reason about quality.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
