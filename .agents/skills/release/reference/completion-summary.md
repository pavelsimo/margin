# completion summary

After all steps complete successfully, print:

```
released v<version>

  CHANGELOG.md updated
  commit: <short-sha> 🔖 release v<version>
  tag:    v<version> → <short-sha>
  pushed: origin/<branch> + refs/tags/v<version>
```

If the push was skipped, replace the last line with `  pushed: (skipped — no remote)`.
