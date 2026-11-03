# Releases

There is one distribution format: a compiled package at a versioned Git tag.

1. Update `packages/auth-client/package.json` to the intended version, complete verification, and commit/push the reviewed source when authorized. Use patch versions for compatible fixes, minor versions for breaking changes before 1.0, and `-beta.1` for opt-in prereleases.
2. In GitHub Actions, select **Release**, choose the reviewed source branch, and click **Run workflow**. The workflow reads the package version, verifies the library and isolated consumers, then publishes the compiled snapshot and its `vVERSION` tag. Development pushes do not publish anything.
3. Install the command shown in the GitHub Release notes. Each project upgrades its own exact tag and lockfile.

The `dist` branch is managed by the workflow. Do not develop on it, merge it into the source branch, or manually tag source commits as releases. Tags are immutable by convention; configure repository rules to prevent deletion or updates of `v*` tags while allowing the workflow to create them. No release is created by local development or verification commands.

`pnpm release:prepare` only builds an inspectable directory under ignored `artifacts/`. It is the same builder used by the workflow and consumer tests. It neither commits nor publishes. `pnpm test:package` packs this output for verification; users install Git tags, not manually managed archives.

The workflow uses GitHub's job token, so no npm account or registry secret is required. It needs permission to write repository contents and update `dist`. The workflow checks library contracts and installation; the example's live browser/Android qualification still requires its isolated backend and should be completed before a release that changes those integrations. Consult `VERIFICATION.md` for the actual exercised platforms.

The distribution commit and annotated tag record the source revision. The branch and tag are pushed atomically and existing tags are rejected. If the Git push succeeds but creating the GitHub Release entry fails, create the missing Release entry from the existing tag; do not delete or move the tag or rerun publication for that version. Edit its notes to include consumer changes and migration guidance.

The Release workflow is registered in `battlemagedotapp/forest-lab-auth-kit` (this fork; upstream is `strawdotdev/auth-client`). Verify each published tag by installing it from that canonical repository; consumers must not depend on transfer redirects.
