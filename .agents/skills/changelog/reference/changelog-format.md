# changelog format

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2024-01-15

### Added
- New feature X

### Fixed
- Bug Y

## [1.0.0] - 2024-01-01

### Added
- Initial release

[Unreleased]: https://github.com/owner/repo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/owner/repo/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/owner/repo/releases/tag/v1.0.0
```

Format rules:
- version headers: `## [X.Y.Z] - YYYY-MM-DD` (always bracketed, date required on versioned sections)
- type sub-sections: `### Added`, `### Changed`, etc. (title case)
- entries: `-` bullets, no trailing period, imperative user-facing language
- versions in reverse chronological order — newest first
- `[Unreleased]` section always present at the top, even when empty
- comparison link definitions live at the very bottom of the file
