# release skill

A skill for agents that cuts a full versioned release in one step: updates `CHANGELOG.md`, commits it, creates an annotated git tag, and pushes everything to the remote.

## Usage

```
/release 1.2.0        # normalize and tag as v1.2.0
/release v1.2.0       # explicit v prefix, same result
/release 2.0.0-rc.1   # pre-release versions supported
```

The assistant runs pre-flight checks, shows a numbered plan with the exact commands it will execute, and waits for your confirmation before touching anything.

## Release Flow

When you run `/release 1.2.0`, the assistant displays the exact commands before doing anything:

```
release plan for v1.2.0

  1. /changelog --release 1.2.0              update CHANGELOG.md: rename [Unreleased] → [1.2.0] - 2025-05-11
  2. /commit                                 commit CHANGELOG.md with message: 🔖 release v1.2.0
  3. git tag -a v1.2.0 -m "release v1.2.0"  create annotated tag on the changelog commit
  4. git push origin HEAD                    push branch to remote
     git push origin v1.2.0                  push tag to remote

proceed with release? (yes / cancel)
```

Before showing the plan, it validates the version, checks that the tag does not already exist, confirms `CHANGELOG.md` is present, and detects whether `origin` can be pushed to.

After you confirm, the release moves through one path:

```text
validate -> changelog -> commit -> tag -> push
```

- `validate`: check semver, existing tags, changelog, branch, and remote
- `changelog`: promote `[Unreleased]` to a dated release section
- `commit`: commit the changelog with `🔖 release v<version>`
- `tag`: create an annotated release tag
- `push`: push the branch and tag to `origin`

If no remote is configured, the push step is skipped and the assistant prints the manual commands instead.

## Prerequisites

- `CHANGELOG.md` must exist with an `## [Unreleased]` section — run `/changelog` first to populate it
- The [`/changelog`](https://github.com/pavelsimo/changelog) and [`/commit`](https://github.com/pavelsimo/commit) skills must be installed alongside this one

## Installation

```bash
npx skills@latest add pavelsimo/skills
```

## Contributing

Open an issue or pull request. Keep commits atomic and follow the [commit conventions](https://github.com/pavelsimo/commit).

## License

MIT
