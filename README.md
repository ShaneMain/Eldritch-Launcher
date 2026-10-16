# Eldritch Launcher

Eldritch Launcher is a fork of [Godot Launcher](https://github.com/godotlauncher/launcher) by Mario Debono, a free, open-source desktop app for managing Godot versions and projects on Windows, macOS and Linux. It is not the original Godot Launcher and is not maintained or endorsed by its maintainers; please report issues with this fork [here](https://github.com/ShaneMain/Eldritch-Launcher/issues), not upstream.

[Download](https://github.com/ShaneMain/Eldritch-Launcher/releases) | [Upstream project](https://github.com/godotlauncher/launcher) | [Upstream documentation](https://docs.godotlauncher.org)

## What this fork adds

- **Engine fork sources.** Install editor builds published as GitHub releases of engine forks, including private repositories, next to the official Godot releases.
- **GitHub device-flow login.** Sign in to GitHub with the device flow; no token server is involved and nothing secret ships with the app.
- **"Behind" indicators.** Project cards show when the project's Git branch or its pinned engine build is behind its upstream.

Configuration lives in `~/.eldritch-launcher`, separate from an upstream Godot Launcher install. Projects keep the upstream `.godotlauncher` pin file, so they stay compatible with Godot Launcher.

## Inherited features

- **Godot versions and custom builds.** Install stable or pre-release versions, register custom builds, and choose an editor for each project. Generate custom editor manifests in the app. The launcher focuses on Godot 4.0 and later.
- **GitHub projects.** Browse and import repositories you can access, including private repositories, or clone a public HTTPS Git repository without connecting an account.
- **Git setup.** Initialise a repository with an optional initial commit and Git LFS configuration. Manage your Git identity and save a separate identity preset for new projects.
- **Code editors.** Configure Visual Studio Code or VSCodium as your default or choose one per project, while preserving unrelated settings.
- **Per-project settings.** Keep separate Godot editor preferences for each project. Import and export settings to reuse them or share them with teammates.
- **Project access.** Switch between Cards and a compact List view, pin and reorder projects, and open a project's folder in a supported terminal. Open recent projects from the system tray where available.

## Releases and updates

Releases follow [Semantic Versioning](https://semver.org/), with suffixes such as `-beta.1` for pre-release builds.

The launcher does not update itself. To update, download the latest build from [GitHub Releases](https://github.com/ShaneMain/Eldritch-Launcher/releases) and install it over your current version.

Builds are **not code-signed**. Windows shows a SmartScreen warning on first install; macOS builds are unsigned as well.

## Local development

Install Node.js **24.15.0 or later** and the npm version declared in [package.json](package.json), then run:

```sh
npm ci
npm run dev
```

See the upstream [contribution guide](CONTRIBUTING.md) for dependency, lockfile and testing guidance.

## License

Eldritch Launcher is released under the [MIT License](LICENSE.txt), like the upstream Godot Launcher (Copyright (c) 2024-present Mario Debono). Third-party assets and libraries have their own licence terms; see [COPYRIGHT.txt](COPYRIGHT.txt).
