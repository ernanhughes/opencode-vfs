import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { sha256 } from "./redact.js"
import type { SourceState } from "./types.js"

export class GitRepo {
  constructor(readonly root: string) {}

  static ensure(root: string): GitRepo {
    mkdirSync(root, { recursive: true })
    const repo = new GitRepo(root)
    if (!repo.isRepo()) {
      repo.run(["init", "-b", "main"])
    }
    return repo
  }

  isRepo(): boolean {
    return this.run(["rev-parse", "--is-inside-work-tree"], false).stdout.trim() === "true"
  }

  run(args: string[], check = true, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    const status = result.status ?? 1
    if (check && status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status,
    }
  }

  currentHead(): string | null {
    const result = this.run(["rev-parse", "HEAD"], false)
    return result.status === 0 ? result.stdout.trim() : null
  }

  currentBranch(): string | null {
    const result = this.run(["branch", "--show-current"], false)
    return result.status === 0 ? result.stdout.trim() || null : null
  }

  remote(): string | null {
    const result = this.run(["remote", "get-url", "origin"], false)
    return result.status === 0 ? result.stdout.trim() || null : null
  }

  status(): string {
    return this.run(["status", "--porcelain"], false).stdout
  }

  diff(): string {
    const unstaged = this.run(["diff", "--no-ext-diff", "--binary"], false).stdout
    const staged = this.run(["diff", "--cached", "--no-ext-diff", "--binary"], false).stdout
    return [unstaged, staged].filter(Boolean).join("\n")
  }

  describeSource(): SourceState {
    const diff = this.diff()
    return {
      root: this.root,
      remote: this.remote(),
      branch: this.currentBranch(),
      head: this.currentHead(),
      status: this.status(),
      diffSha256: sha256(diff),
    }
  }

  commitPath(path: string, message: string): string | null {
    // A normal `git commit` includes everything already staged by the user.
    // Build the provenance commit through an isolated temporary index, then
    // refresh only this path in the real index. Unrelated staged bytes remain
    // staged and can never enter the provenance commit.
    const tempRoot = join(tmpdir(), `opencode-vfs-index-${process.pid}-${Date.now()}`)
    mkdirSync(tempRoot, { recursive: true })
    const env = { GIT_INDEX_FILE: join(tempRoot, "index") }
    try {
      if (this.currentHead()) this.run(["read-tree", "HEAD"], true, env)
      this.run(["add", "--", path], true, env)
      const staged = this.run(["diff", "--cached", "--quiet"], false, env)
      if (staged.status === 0) return this.currentHead()
      const result = this.run(["commit", "-m", message], false, env)
      if (result.status !== 0) throw new Error(`git commit failed: ${result.stderr || result.stdout}`)
      this.run(["reset", "-q", "HEAD", "--", path])
      return this.currentHead()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }

  push(): void {
    const branch = this.currentBranch()
    if (!branch) throw new Error("Cannot push provenance from detached HEAD")
    this.run(["push", "-u", "origin", branch])
  }
}

export function ensureParent(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
}
