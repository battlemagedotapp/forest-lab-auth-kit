import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("appends compiled releases, preserves old tags, and refuses to replace a version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auth-release-test-"));
  try {
    const remote = join(directory, "owner/auth-client.git");
    await mkdir(join(directory, "owner"));
    await mkdir(join(directory, "bin"));
    // Only Git is real: no GitHub authentication or publication leaves this fixture.
    await writeFile(join(directory, "bin/gh"), "#!/usr/bin/env node\nprocess.exit(0);\n", {
      mode: 0o755,
    });
    const env = {
      ...process.env,
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GITHUB_ACTIONS: "true",
      GH_TOKEN: "fixture",
      GITHUB_SERVER_URL: pathToFileURL(directory).href,
      GITHUB_REPOSITORY: "owner/auth-client",
      SOURCE_REVISION: "a".repeat(40),
    };
    execFileSync("git", ["init", "--bare", remote], { env, stdio: "pipe" });
    const publish = async (version: string) => {
      const release = await mkdtemp(join(directory, "package-"));
      await writeFile(
        join(release, "package.json"),
        JSON.stringify({ name: "@forest-lab/auth-kit", version }),
      );
      if (version === "0.1.0") await writeFile(join(release, "obsolete.js"), "export {};\n");
      return spawnSync(process.execPath, [resolve("tools/publish-release.mjs")], {
        env: { ...env, RELEASE_DIRECTORY: release, RELEASE_VERSION: version },
        encoding: "utf8",
      });
    };
    expect((await publish("0.1.0")).status).toBe(0);
    expect((await publish("0.1.1")).status).toBe(0);
    const git = (...args: string[]) =>
      execFileSync("git", ["--git-dir", remote, ...args], { env, encoding: "utf8" });
    expect(JSON.parse(git("show", "v0.1.0:package.json")).version).toBe("0.1.0");
    expect(JSON.parse(git("show", "dist:package.json")).version).toBe("0.1.1");
    expect(git("ls-tree", "--name-only", "dist")).not.toContain("obsolete.js");
    expect(git("rev-list", "--count", "dist").trim()).toBe("2");
    const duplicate = await publish("0.1.0");
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("already exists");
    expect(JSON.parse(git("show", "v0.1.0:package.json")).version).toBe("0.1.0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
