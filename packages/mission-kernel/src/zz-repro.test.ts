import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitWorkspaceService, type GitCommand } from "./git-workspace-service";

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
const realGit: GitCommand = async (args, cwd, options) => {
  const result = await execFileAsync("git", args, { cwd, env: options?.env });
  return { stdout: result.stdout, stderr: result.stderr };
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("repro", () => {
  it("reproduces dirty root after promote", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "orrery-mission-"));
    dirs.push(repositoryRoot);
    await execFileAsync("git", ["init", "--initial-branch", "main"], { cwd: repositoryRoot });
    await execFileAsync("git", ["config", "user.email", "test@orrery.local"], { cwd: repositoryRoot });
    await execFileAsync("git", ["config", "user.name", "Orrery Test"], { cwd: repositoryRoot });
    await writeFile(join(repositoryRoot, "fixture.txt"), "initial\n");
    await execFileAsync("git", ["add", "fixture.txt"], { cwd: repositoryRoot });
    await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repositoryRoot });

    const service = new GitWorkspaceService({ git: realGit });
    const workspace = await service.createMissionWorkspace({
      missionId: crypto.randomUUID(),
      repositoryRoot,
      targetBranch: "main",
    });
    await writeFile(join(workspace.worktreePath, "fixture.txt"), "promoted\n");
    const snapshot = await service.inspectChanges(workspace);
    const result = await service.promote(workspace, "main", "reviewer@example.test", snapshot, "2099-01-01T00:00:00.000Z");
    console.log("promote result:", JSON.stringify(result));

    const status = await realGit(["status", "--porcelain=v1", "--", ".", ":!.orrery/"], repositoryRoot);
    console.log("status:", JSON.stringify(status.stdout));
    const diff = await realGit(["diff", "--", "fixture.txt"], repositoryRoot);
    console.log("diff:", JSON.stringify(diff.stdout));
    const debug = await realGit(["ls-files", "--debug", "--", "fixture.txt"], repositoryRoot);
    console.log("ls-files --debug:\n" + debug.stdout);
    const stat = await realGit(["status", "--porcelain=v1", "--", ".", ":!.orrery/"], repositoryRoot);
    console.log("status again:", JSON.stringify(stat.stdout));
    const content = await readFile(join(repositoryRoot, "fixture.txt"), "utf8");
    console.log("content:", JSON.stringify(content));
    expect(true).toBe(true);
  });
});
