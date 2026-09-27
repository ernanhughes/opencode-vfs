import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
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

  run(args: string[], check = true): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      windowsHide: true,
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
    this.run(["add", "--", path])
    const staged = this.run(["diff", "--cached", "--quiet"], false)
    if (staged.status === 0) return this.currentHead()

    const result = this.run(["commit", "-m", message], false)
    if (result.status !== 0) {
      throw new Error(`git commit failed: ${result.stderr || result.stdout}`)
    }
    return this.currentHead()
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
