---
name: release
description: Cuts a versioned release by updating CHANGELOG.md, committing, creating an annotated git tag, and pushing to remote in one step. Use when the user wants to publish a new version of their project.
---

# release skill

A skill that orchestrates a full versioned release: updates `CHANGELOG.md`, commits it, creates an annotated git tag, and pushes to the remote — all from a single command with a confirmation gate before any git operations run.

## features

- normalizes version input to `v` prefix (accepts `1.2.0` or `v1.2.0`)
- validates semver format before proceeding
- runs pre-flight checks (tag exists? remote configured? CHANGELOG.md present?) before showing the plan
- presents a numbered step-by-step plan and waits for explicit confirmation
- invokes `/changelog --release <version>` to promote `[Unreleased]` to a versioned, dated section
- invokes `/commit` to commit the `CHANGELOG.md` update with a `🔖 release v<version>` message
- creates an annotated tag pointing to the changelog commit
- pushes both the branch and the tag to the remote
- skips push gracefully when no remote is configured or when in detached HEAD state

## usage

```
/release 1.2.0        # normalize and tag as v1.2.0
/release v1.2.0       # explicit v prefix, same result
/release 2.0.0-rc.1   # pre-release versions supported
```

## workflow

### pre-flight checks (run before showing the plan)

1. parse the version argument; if missing, show usage and stop:
   ```
   usage: /release <version>
   examples: /release 1.2.0  |  /release v2.0.0-rc.1
   ```
2. normalize the version: strip any leading `v`, then re-add it to produce `v<version>`; the bare version (without `v`) is used in CHANGELOG.md headers and as the `--release` argument; the `v`-prefixed form is used for the git tag
3. validate that the bare version is a valid semver string — `MAJOR.MINOR.PATCH` with optional pre-release suffix (`-rc.1`, `-beta.2`) and build metadata (`+build.1`); if invalid, show an error and stop:
   ```
   error: "<input>" is not a valid semver string
   expected format: MAJOR.MINOR.PATCH (e.g. 1.2.0, 2.0.0-rc.1)
   ```
4. run `git tag --list "v<version>"` to check whether the tag already exists; if it does, abort:
   ```
   error: tag v<version> already exists — bump the version or delete the existing tag first
   ```
5. check whether `CHANGELOG.md` exists in the current directory; if not, abort:
   ```
   error: CHANGELOG.md not found — run /changelog first to generate it
   ```
6. run `git remote get-url origin` to detect the remote; store the result; if no remote is found, note that step 4 of the plan will be skipped
7. run `git symbolic-ref --short HEAD 2>/dev/null` to detect detached HEAD state; if the command fails (detached HEAD), warn the user:
   ```
   warning: currently in detached HEAD state — the tag will be created, but the push step will be skipped
   ```
8. run `git status --short` to check for uncommitted changes unrelated to the release; if any exist, warn:
   ```
   warning: working tree has uncommitted changes — they will not be included in the release tag
   ```
   ask: `continue anyway? (yes / cancel)` — stop on anything other than `yes`

### confirmation gate

Display the following plan, substituting the real version and today's date:

```
release plan for v<version>

  1. /changelog --release <version>              update CHANGELOG.md: rename [Unreleased] → [<version>] - <today>
  2. /commit                                     commit CHANGELOG.md with message: 🔖 release v<version>
  3. git tag -a v<version> -m "release v<version>"   create annotated tag on the changelog commit
  4. git push origin HEAD                        push branch to remote
     git push origin v<version>                  push tag to remote
```

If no remote was detected, replace step 4 with:

```
  4. (skipped — no remote configured)
     to push manually: git push origin HEAD && git push origin v<version>
```

Ask: `proceed with release? (yes / cancel)`

On anything other than `yes` (case-insensitive), print `release cancelled` and stop.

### execution

Execute the confirmed steps in order:

**step 1 — update changelog**

Invoke `/changelog --release <version>`.

This sub-skill will:
- validate that `CHANGELOG.md` exists and contains `## [Unreleased]`
- warn if `[Unreleased]` is empty and ask whether to proceed
- rename `## [Unreleased]` to `## [<version>] - <today>`, insert a fresh empty `## [Unreleased]` above it, and rewrite the comparison link block
- show a preview and ask for confirmation before writing

Wait for the sub-skill to complete. If the user cancels inside the sub-skill, print `release cancelled — CHANGELOG.md was not updated` and stop.

**step 2 — commit the changelog**

Invoke `/commit`.

The `/commit` sub-skill will detect `CHANGELOG.md` as the staged change and propose a message. Guide it toward `🔖 release v<version>` (the `🔖 :bookmark:` gitmoji signals a release / version tag). Do not pre-stage `CHANGELOG.md` before invoking — let `/commit` handle staging to avoid accidentally including unrelated files.

If `/commit` reports no staged changes after step 1 (e.g., the changelog was already up to date), skip the commit and continue with the current HEAD for the tag.

**step 3 — create annotated tag**

Run:
```
git tag -a v<version> -m "release v<version>"
```

Verify the tag was created:
```
git tag --list "v<version>"
```

**step 4 — push branch and tag**

If a remote was detected and not in detached HEAD:

```
git push origin HEAD
git push origin v<version>
```

If `git push origin HEAD` fails because the branch has no upstream tracking ref, retry with:
```
git push --set-upstream origin <current-branch>
```

If `git push origin v<version>` is rejected because the tag already exists on the remote (e.g., deleted locally but still present remotely), abort with:
```
error: remote already has tag v<version> — do not force-push tags
to resolve: git push origin :v<version> to delete the remote tag first, then re-run /release
```

Never run `git push --force` on a tag.

If no remote was configured, skip this step and print the manual push instructions.


After all steps complete successfully, print the summary using [reference/completion-summary.md](reference/completion-summary.md).

## best practices

- **run `/changelog` first** — populate `[Unreleased]` with meaningful entries before cutting a release; an empty changelog section produces a release with no notes
- **clean working tree** — commit or stash unrelated changes before releasing; they will not be captured in the tag
- **never re-tag** — annotated tags are permanent anchors in git history; if a release shipped with a bug, cut a patch release (`v1.2.1`) instead of moving or deleting the existing tag
- **pre-release versions** — `v1.2.0-rc.1`, `v2.0.0-beta.1` are fully supported; they follow the same workflow and produce a real tag
- **confirmation is not optional** — the skill always shows the plan and waits; it never proceeds silently even when all pre-flight checks pass
- **sub-skill cancellation propagates** — if the user cancels at any sub-skill prompt (`/changelog`, `/commit`), the entire release is aborted; no partial state is left behind
