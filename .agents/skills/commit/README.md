# commit skill

A skill for agents that turns staged changes into clean, atomic git commits using [gitmoji](https://gitmoji.dev/), with all-lowercase messages.

## Usage

```
/commit              # analyze staged changes and commit (with pre-commit checks)
/commit --no-verify  # skip pre-commit checks
/commit --push       # push to current branch after committing
```

The assistant will inspect staged files, propose a message, and wait for your confirmation before committing.

## Commit Format

```
<emoji> <lowercase imperative summary>
```

The emoji carries the type signal — no `feat:` or `fix:` prefix needed. Message and body are always lowercase.

**examples**

```
✨ add support for server sent events
🐛 fix parameter aliases when using query dependencies
📝 update docs for pyproject.toml entrypoint configuration
⬆️ bump pydantic from 2.12.5 to 2.13.2
♻️ simplify pydantic v2 compatibility utils
🔥 remove april fool's @app.vibe() decorator
👷 run tests with pytest-xdist and pytest-cov
🔒️ add strict content-type checking for json requests
```

For complex changes, add a body after a blank line:

```
♻️ simplify pydantic v2 compatibility utils

removes the compat shim introduced in #1234 now that we require pydantic >=2.5;
the upstream fix landed in that release and covers all the edge cases we patched
```

## Installation

```bash
npx skills@latest add pavelsimo/skills
```

## Gitmoji Reference

| Emoji | Code | When to use |
|-------|------|-------------|
| ✨ | `:sparkles:` | introduce new features |
| 🐛 | `:bug:` | fix a bug |
| 🚑️ | `:ambulance:` | critical hotfix |
| 🩹 | `:adhesive_bandage:` | simple fix for a non-critical issue |
| 📝 | `:memo:` | add or update documentation |
| ✏️ | `:pencil2:` | fix typos |
| 💬 | `:speech_balloon:` | add or update text and literals |
| 🎨 | `:art:` | improve structure or format of code |
| ♻️ | `:recycle:` | refactor code |
| ⚡️ | `:zap:` | improve performance |
| ✅ | `:white_check_mark:` | add, update, or pass tests |
| 🧪 | `:test_tube:` | add a failing test |
| 💄 | `:lipstick:` | add or update UI and style files |
| 🔧 | `:wrench:` | add or update configuration files |
| 🔨 | `:hammer:` | add or update development scripts |
| 👷 | `:construction_worker:` | add or update CI/CD pipeline |
| ⬆️ | `:arrow_up:` | upgrade dependencies |
| ➕ | `:heavy_plus_sign:` | add a dependency |
| ➖ | `:heavy_minus_sign:` | remove a dependency or drop support |
| 🔥 | `:fire:` | remove code or files |
| ⚰️ | `:coffin:` | remove dead code |
| 🗑️ | `:wastebasket:` | deprecate code that needs cleanup |
| 🔒️ | `:lock:` | fix security issues |
| 🎉 | `:tada:` | begin a project |
| 🔖 | `:bookmark:` | release / version tag |
| 🚧 | `:construction:` | work in progress |
| 🌐 | `:globe_with_meridians:` | internationalization and localization |
| 👥 | `:busts_in_silhouette:` | add or update contributor(s) |
| 💡 | `:bulb:` | add or update comments in source code |
| 🚨 | `:rotating_light:` | fix compiler/linter warnings |

Full reference: [gitmoji.dev](https://gitmoji.dev/)

## Contributing

Open an issue or pull request. Keep commits atomic and follow the format above.

## License

MIT
