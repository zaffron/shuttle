<div align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="Shuttle" />
  <h1>Shuttle</h1>
  <p>A minimalist macOS GUI for managing SSH port-forwards through an AWS SSM bastion.</p>
</div>

---

Shuttle replaces a pile of shell functions for tunnelling to internal services
(Redis, databases, …) behind an SSM-only bastion. It pushes your SSH key via
EC2 Instance Connect, opens `ssh -N -L` tunnels through an SSM `ProxyCommand`,
and gives you start/stop, live status, and logs in a native app.

## Features

- **One-click tunnels** — start/stop with live connection status
- **AWS SSO sign-in** built in (`aws sso login`) — no dropping to a terminal
- **Editable, persisted config** — bastion settings + any number of tunnels
- **Dark / light / system** theming (system by default)
- Reuses your installed `aws`, `ssh`, and `session-manager-plugin`

## Requirements

- macOS
- [`aws` CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
  [`session-manager-plugin`](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html),
  and `ssh` on your `PATH`
- An AWS profile with EC2 Instance Connect + SSM access to the bastion

## Development

```sh
make deps      # install JS deps + fetch Rust crates
make dev       # run with hot reload
make check     # type-check frontend + Rust
```

Run `make` to see all targets.

## Build

```sh
make build     # universal .app + .dmg under src-tauri/target/release/bundle
make install   # build, then copy Shuttle.app to /Applications
```

> Local builds are unsigned. macOS may require right-click → Open, or
> `xattr -dr com.apple.quarantine /Applications/Shuttle.app`, on first launch.

## Releases

Pushing a `v*` tag triggers the [`release`](.github/workflows/release.yml)
workflow, which builds a universal macOS DMG and attaches it to a draft
GitHub Release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Tech

Tauri 2 · React 19 · TypeScript · Tailwind CSS v4 · Vite · Rust
