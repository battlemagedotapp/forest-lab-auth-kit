import { mkdtemp, writeFile, readdir, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { prepareRelease } from "./release-package.mjs";
const root = resolve(".");
const directory = await mkdtemp(join(tmpdir(), "reactive-auth-package-"));
if (!process.env.AUTH_CLIENT_GIT_SOURCE) {
  const release = await prepareRelease({ parentDirectory: directory });
  execFileSync("pnpm", ["--dir", release.directory, "pack", "--pack-destination", directory], {
    cwd: root,
    stdio: "pipe",
  });
}
const tarball = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
await writeFile(
  join(directory, "package.json"),
  JSON.stringify({
    private: true,
    type: "module",
    packageManager: "pnpm@12.0.0",
    dependencies: {
      "@forest-lab/auth-kit":
        process.env.AUTH_CLIENT_GIT_SOURCE ?? `file:${join(directory, tarball)}`,
      "better-auth": "1.6.22",
      "@convex-dev/better-auth": "0.12.5",
      convex: "1.45.0",
      "@tanstack/react-query": "5.102.8",
      react: "19.2.3",
      "@types/react": "19.2.4",
      zod: "4.6.4",
    },
  }),
);
await writeFile(
  join(directory, "pnpm-workspace.yaml"),
  "allowBuilds:\n  esbuild: true\nminimumReleaseAgeExclude:\n  - zod@4.6.4\n",
);
execFileSync("pnpm", ["--dir", directory, "install"], { cwd: root, stdio: "inherit" });
if (process.env.AUTH_CLIENT_GIT_SOURCE) {
  await rm(join(directory, "node_modules"), { recursive: true, force: true });
  execFileSync("pnpm", ["--dir", directory, "install", "--frozen-lockfile"], {
    cwd: root,
    stdio: "inherit",
  });
}
{
  const releaseManifest = JSON.parse(
    await readFile(join(directory, "node_modules/@forest-lab/auth-kit/package.json"), "utf8"),
  );
  if (releaseManifest.scripts || releaseManifest.devDependencies || releaseManifest.packageManager)
    throw new Error("Release contains install/build machinery");
}
if (process.env.AUTH_CLIENT_EXPECTED_VERSION) {
  const installed = JSON.parse(
    await readFile(join(directory, "node_modules/@forest-lab/auth-kit/package.json"), "utf8"),
  );
  if (installed.version !== process.env.AUTH_CLIENT_EXPECTED_VERSION)
    throw new Error("Git installation did not use the release tag's version");
}
const installedRoot = join(directory, "node_modules/@forest-lab/auth-kit");
// Runtime bundle checks cannot catch frontend types leaking into backend declarations.
const declarations = ["convex/index.d.ts", "convex/component.d.ts"].map((file) =>
  join(installedRoot, "dist", file),
);
const visitedDeclarations = new Set();
while (declarations.length) {
  const path = declarations.pop();
  if (visitedDeclarations.has(path)) continue;
  visitedDeclarations.add(path);
  if (/\/dist\/(?:client|workflows)\//.test(path))
    throw new Error("Backend declarations include frontend client/workflow types");
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\(\s*)["'](\.[^"']+)["']/g))
    declarations.push(resolve(dirname(path), match[1].replace(/\.js$/, ".d.ts")));
}
for (const entry of ["index", "convex/index", "convex/component"]) {
  for (const suffix of [".js.map", ".d.ts.map"]) {
    const mapPath = join(installedRoot, "dist", entry + suffix);
    const map = JSON.parse(await readFile(mapPath, "utf8"));
    for (const source of map.sources) {
      const target = resolve(dirname(mapPath), source);
      if (!target.startsWith(join(installedRoot, "src") + "/"))
        throw new Error("Source map escapes the installed package");
      await access(target);
    }
  }
}
await writeFile(
  join(directory, "consumer.ts"),
  `import {createAuthClient} from 'better-auth/react';
import {createAuthDataClient,type InvalidationApi} from '@forest-lab/auth-kit';
import {authSignalTables} from '@forest-lab/auth-kit/convex';
import {lookup} from '@forest-lab/auth-kit/convex/component';
const client=createAuthDataClient({authClient:createAuthClient(),api:{} as InvalidationApi,features:{sessions:true}});
void [client,authSignalTables,lookup];`,
);
const fixtures = [
  "endpoint-inference.types.ts",
  "capabilities.types.ts",
  "backend.types.ts",
  "gaia-compatibility.types.ts",
  "invitations.types.tsx",
  "organization-session.types.tsx",
  "authentication.types.tsx",
  "accounts.types.ts",
];
for (const fixture of fixtures) {
  const source = await readFile(join(root, "tests", fixture), "utf8");
  const packed = source
    .replaceAll("../packages/auth-client/src/index.js", "@forest-lab/auth-kit")
    .replaceAll("../packages/auth-client/src/client/types.js", "@forest-lab/auth-kit")
    .replaceAll("../packages/auth-client/src/convex/index.js", "@forest-lab/auth-kit/convex")
    .replaceAll(
      "../packages/auth-client/src/convex/component.js",
      "@forest-lab/auth-kit/convex/component",
    )
    .replaceAll(
      "../packages/auth-client/src/better-auth/index.js",
      "@forest-lab/auth-kit/better-auth",
    );
  await writeFile(join(directory, fixture), packed);
}
execFileSync(
  process.execPath,
  [
    join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--noUncheckedIndexedAccess",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--jsx",
    "react-jsx",
    "consumer.ts",
    ...fixtures,
  ],
  { cwd: directory, stdio: "inherit" },
);
const baseline = `export {createAuthClient} from 'better-auth/react';export {organizationClient} from 'better-auth/client/plugins';export {ConvexReactClient} from 'convex/react';export {ConvexBetterAuthProvider} from '@convex-dev/better-auth/react';`;
const sizes = [];
for (const source of [
  baseline,
  baseline + `export {createAuthDataClient,AuthDataProvider} from '@forest-lab/auth-kit';`,
]) {
  const result = await build({
    stdin: { contents: source, resolveDir: directory },
    metafile: true,
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (Object.keys(result.metafile.inputs).some((path) => /auth-client\/dist\/convex\//.test(path)))
    throw new Error("Client export includes backend code");
  if (
    Object.keys(result.metafile.inputs).some((path) =>
      /@hookform\/resolvers\/(?!zod\/|dist\/)/.test(path),
    )
  )
    throw new Error("Client export includes an unused validation integration");
  sizes.push({
    bytes: result.outputFiles[0].contents.length,
    gzip: gzipSync(result.outputFiles[0].contents).length,
  });
}
const backend = await build({
  stdin: {
    contents:
      "export * from '@forest-lab/auth-kit/convex'; export * from '@forest-lab/auth-kit/convex/component';",
    resolveDir: directory,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  metafile: true,
});
if (
  Object.keys(backend.metafile.inputs).some((path) =>
    /node_modules\/(?:\.pnpm\/)?(?:react|@tanstack)/.test(path),
  )
)
  throw new Error("Backend exports include React or TanStack Query");
console.log(
  JSON.stringify(
    {
      source: process.env.AUTH_CLIENT_GIT_SOURCE ?? join(directory, tarball),
      consumer: "passed",
      baseline: sizes[0],
      withAdapter: sizes[1],
      incremental: { bytes: sizes[1].bytes - sizes[0].bytes, gzip: sizes[1].gzip - sizes[0].gzip },
    },
    null,
    2,
  ),
);
