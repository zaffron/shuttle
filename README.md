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

- macOS 11 or later (Apple Silicon **or** Intel — the DMG is universal)
- [`aws` CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
  [`session-manager-plugin`](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html),
  and `ssh` on your `PATH`
- An AWS profile with EC2 Instance Connect + SSM access to the bastion

Install the AWS tools with Homebrew if you don't have them:

```sh
brew install awscli session-manager-plugin
```

## Install

1. Download **`Shuttle_<version>_universal.dmg`** from the
   [latest release](https://github.com/zaffron/shuttle/releases/latest).
2. Open the `.dmg` and drag **Shuttle** into your **Applications** folder.
3. Eject the DMG.

### First launch (Gatekeeper)

Shuttle is **not yet code-signed / notarized**, so on first launch macOS will
warn that it "cannot verify the developer." This is expected. Pick one:

**Option A — via System Settings (recommended)**

1. Double-click **Shuttle** → you'll see the warning → click **Done**.
2. Open  **System Settings → Privacy & Security**, scroll to the bottom, and
   click **Open Anyway** next to the Shuttle message.
3. Launch Shuttle again and confirm with **Open**.

**Option B — via Terminal (one command)**

```sh
xattr -dr com.apple.quarantine /Applications/Shuttle.app
```

Then open Shuttle normally. You only need to do this once.

## First-run setup

Shuttle ships with placeholder settings — point it at your bastion the first
time you open it:

1. Click **Bastion** in the top bar and fill in your **AWS profile**,
   **region**, bastion **instance ID**, **OS user**, and SSH key paths, then
   **Save**. (The badges in the top bar confirm `aws`, `ssh`, and
   `ssm-plugin` are found on your `PATH`.)
2. Click **Sign in** to run `aws sso login` for that profile (skip if your
   profile doesn't use SSO). Use **Test connection** to verify.
3. Add your tunnels with **+ Add tunnel** (name, local port, remote host,
   remote port), then hit **Start**. A green dot means it's connected.

Your configuration is saved to
`~/Library/Application Support/com.zaffron.shuttle/config.json`.

## Updating

Download the newer DMG from the
[releases page](https://github.com/zaffron/shuttle/releases) and replace the
app in Applications (re-run the Gatekeeper step above). Your saved
configuration is preserved.

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
workflow, which builds a universal macOS DMG and publishes a GitHub Release
with the DMG attached as a downloadable asset:

```sh
git tag v0.2.0
git push origin v0.2.0
```

## Tech

Tauri 2 · React 19 · TypeScript · Tailwind CSS v4 · Vite · Rust
