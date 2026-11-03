import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Invoked only by the manually dispatched release workflow.
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GH_TOKEN)
  throw new Error("Publish through the GitHub Release workflow.");
const directory = process.env.RELEASE_DIRECTORY;
const version = process.env.RELEASE_VERSION;
const source = process.env.SOURCE_REVISION;
const repository = process.env.GITHUB_REPOSITORY;
if (
  !directory ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "") ||
  !/^[a-f0-9]{40}$/.test(source ?? "") ||
  !repository
)
  throw new Error("Missing or invalid release metadata.");
const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
if (manifest.version !== version || manifest.scripts || manifest.devDependencies)
  throw new Error("Invalid compiled release manifest.");
const tag = `v${version}`;
const remote = `${process.env.GITHUB_SERVER_URL}/${repository}.git`;
const git = (...args) =>
  execFileSync("git", args, { cwd: directory, stdio: "pipe", encoding: "utf8" });
execFileSync("gh", ["auth", "setup-git"], { stdio: "inherit" });
const exists = (ref) => {
  const result = spawnSync("git", ["ls-remote", "--exit-code", remote, ref], { encoding: "utf8" });
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(`Cannot read remote refs: ${result.stderr}`);
};
if (exists(`refs/tags/${tag}`))
  throw new Error(`${tag} already exists; releases cannot be replaced.`);
git("init", "--initial-branch=dist");
git("remote", "add", "origin", remote);
if (exists("refs/heads/dist")) {
  git("fetch", "--depth=1", "origin", "dist");
  // Keep only the freshly built files while attaching to distribution history.
  git("reset", "--soft", "FETCH_HEAD");
}
git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("add", "--all");
git("commit", "-m", `Release ${tag}\n\nSource: ${source}`);
git("tag", "-a", tag, "-m", `Release ${tag}\nSource: ${source}`);
git("push", "--atomic", "origin", "HEAD:refs/heads/dist", `refs/tags/${tag}`);
const notes = `Precompiled @forest-lab/auth-kit ${version}.\n\nSource: ${process.env.GITHUB_SERVER_URL}/${repository}/commit/${source}\n\nInstall: pnpm add '@forest-lab/auth-kit@github:${repository}#${tag}'`;
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--verify-tag",
    "--title",
    tag,
    "--notes",
    notes,
    ...(version.includes("-") ? ["--prerelease"] : []),
  ],
  { stdio: "inherit" },
);
