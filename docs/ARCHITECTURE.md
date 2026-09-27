# Architecture

## Purpose

opencode-vfs is a Git-backed provenance layer for AI-assisted work.

Git answers **what changed**. opencode-vfs records **why it changed, which interaction caused it, which model/tool acted, and which source state was affected**.

It is intentionally a foundation layer. It captures evidence; it does not judge whether a change is correct.

## Two repositories, one history

The source repository and provenance repository may be the same Git repository or different repositories.

```text
OpenCode session
  |
  +-- prompts / responses / tool calls / session events
  |
  +-- source Git state
          |
          +--> SOURCE REPO
          |      commit / branch / diff / status
          |
          +--> PROVENANCE GIT
                 projects/<project>/sessions/...
```

### External mode

External mode is the default.

```text
C:\Projects\language
  source Git

~/.opencode/provenance/<project-id>
  provenance Git
```

No provenance files are written into the source repository.

### Current mode

Current mode stores provenance under `.opencode-vfs/` in the source repository and commits only that path.

This mode is explicit because prompts and model traces may be private.

## Event model

A provenance event contains:

- project ID
- session ID
- sequence
- timestamp
- event kind
- source repository state
- protected payload

Captured surfaces include:

- user prompt admission (`chat.message`)
- assistant message updates and message parts
- tool execution before/after
- `session.diff`
- file/command/session lifecycle events
- exact model identity when OpenCode supplies it

Each event is content hashed. Session segments are append-only files; an existing segment is never overwritten.

## Source linkage

Each captured event records:

- source repository root
- origin remote when available
- branch
- HEAD
- porcelain status
- SHA-256 of staged + unstaged binary diff

That means provenance can describe work before the source repository has a final commit.

A later segment naturally observes the resulting source commit.

## Privacy

Default privacy mode is `redacted`.

Supported modes:

- `redacted`: recursively redact common secret keys and token patterns
- `full`: preserve full payloads
- `hash-only`: retain only payload digest and byte count

The provenance repository should be treated as private unless deliberately published.

## Commit policy

At `session.idle`, pending events are written as a new immutable segment and committed to the provenance Git target.

When `push: true`, the provenance repository is pushed only after a successful commit. A remote must already be configured; the plugin never invents a remote.

## Non-goals

v0.1 does not:

- decide whether a patch is good
- rewrite source history
- automatically publish provenance
- automatically merge source branches
- claim deterministic replay of LLM outputs
- store hidden model reasoning

The goal is provenance reproducibility: retaining the observable interaction and repository state that produced a change.
