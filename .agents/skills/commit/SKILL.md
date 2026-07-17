---
name: commit
description: Creates a conventional git commit with gitmoji prefix and lowercase imperative message. Use when the user is ready to commit staged changes or wants help composing a clean, atomic commit message.
---

# commit skill

A Claude Code skill that analyzes staged changes, selects the right gitmoji, and produces a clean, atomic commit message in lowercase imperative mood — modeled on [fastapi/fastapi](https://github.com/fastapi/fastapi) conventions.

## features

- checks staged files before doing anything; proposes what to stage if nothing is staged
- runs pre-commit checks (lint, build, type-check) by default
- selects the appropriate gitmoji based on the nature of the diff
- enforces lowercase imperative message style
- suggests splitting when staged files span unrelated concerns
- shows the draft message and waits for confirmation before committing

## usage

```
/commit              # with pre-commit checks
/commit --no-verify  # skip pre-commit checks
/commit --push       # push to current branch after committing
```



## workflow

Commit messages use this format:

```
<emoji> <lowercase imperative summary>
```

For complex changes, add a body after a blank line explaining **what** changed and **why** — not how. No trailing period. No type prefix; the emoji carries that signal. Read [reference/gitmoji.md](reference/gitmoji.md) when selecting the emoji.

1. run `git diff --cached --name-only` to inspect staged files
2. if nothing is staged:
   - run `git status` to show unstaged and untracked files
   - propose a logical grouping of files to stage
   - wait for user confirmation before running `git add`
3. run `git diff --cached` to read the full diff
4. if the staged diff spans unrelated concerns, suggest splitting into separate commits
5. unless `--no-verify` is passed, run available pre-commit checks (lint, build, type-check) and surface any failures before proceeding
6. select the single most appropriate emoji from [reference/gitmoji.md](reference/gitmoji.md)
7. draft the commit message: `<emoji> <lowercase imperative summary>` — keep the summary short (under 60 chars); name the outcome, not the mechanism — write "fix crash when user has no email" not "add null check before accessing user.email"; avoid listing every changed file or detail in the summary
8. only add a body when the *why* is non-obvious and cannot be inferred from the diff; skip the body for straightforward changes
9. show the complete draft message and ask for confirmation or edits
10. on approval, execute: `git commit -m "<message>"`
11. if `--push` was passed, immediately run `git push` to push to the current branch after committing

## best practices

- **atomic commits** — one logical change per commit; if the diff touches unrelated things, offer to split
- **imperative mood** — "add feature" not "added feature" or "adding feature"
- **summary names outcomes** — describe what changes, not how: "fix crash when X" not "add null check for X"; "simplify token parser" not "replace for loop with list comprehension"
- **all lowercase** — summary and body both lowercase; no trailing period
- **body explains why** — the diff shows what changed; the body explains the motivation
- **reference issues** — mention related issues or PRs in the body when relevant (`closes #123`)
- **no --no-verify by default** — only skip checks when the user explicitly passes the flag
- **--push** — runs `git push` after committing; combine with `--no-verify` to also skip pre-commit checks
