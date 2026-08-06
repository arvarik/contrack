# CI and Release Pipeline

One workflow, `.github/workflows/ci.yml`, covers testing, container publishing,
and GitHub releases.

## What runs when

| Event                    | Tests | Container image   | GitHub release |
| ------------------------ | ----- | ----------------- | -------------- |
| Pull request into `main` | ✅    | —                 | —              |
| Push to `main`           | ✅    | `latest`, `<sha>` | —              |
| Push of a `v*` tag       | ✅    | `X.Y.Z`, `X.Y`    | ✅             |
| Manual dispatch          | ✅    | —                 | —              |

`build-and-test` runs lint (ESLint + `tsc --noEmit` under strict), a Prettier
check, the full test suite with coverage, and a production build on Node 22 —
the version the Docker image ships.

## Container images

Images are published to `ghcr.io/arvarik/contrack` for **linux/amd64 and
linux/arm64**. Apple Silicon and ARM homelab hosts are a primary target for a
self-hosted app, and releases through v1.3.0 were amd64-only, so those hosts
could not pull them at all.

Each architecture builds on a runner of that architecture rather than emulating
one through QEMU. This project compiles native modules (`better-sqlite3`,
`onnxruntime` via Transformers.js), and building those under emulation is
dramatically slower. Public repositories get free arm64 runners, so neither
architecture pays an emulation penalty.

The two jobs push untagged manifests **by digest**; `merge-image` then assembles
the digests into a single multi-arch tag and asserts that both architectures are
present before the run is allowed to pass. That last check exists because an
amd64-only image is not obviously broken — it pulls fine on the machine that
built it and fails only for someone else.

### Publishing a release

```bash
npm version minor --no-git-tag-version    # or edit package.json
# update CHANGELOG.md
git commit -am "docs: add CHANGELOG entry and bump to vX.Y.Z"
git push origin main

git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z

# Publish with hand-written notes. Do this *before* the workflow's release job
# gets there and the job becomes a no-op; skip it and you get auto-generated
# notes (a commit list) instead.
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file notes.md --verify-tag
```

The `release` job only creates a release if one doesn't already exist for the
tag, so publishing your own notes first is the intended flow.

## Self-hosted runner (hppc)

`hppc` is registered as a self-hosted runner with the labels
`self-hosted, hppc, contrack` (plus the automatic `Linux`/`X64`). It exists as an escape hatch: when
GitHub's hosted pool is congested or degraded, re-run the workflow through
**Actions → CI → Run workflow** and choose `hppc` for the runner input.

It is deliberately **not** the default. Making it the default would trade a
GitHub outage for a "my desktop is asleep" outage, and release builds should not
depend on a machine at home.

### Security

contrack is a public repository, so workflow code from a fork pull request is
untrusted input. The runner is set up accordingly:

- **Fork pull requests never reach it.** `build-and-test` only selects the
  self-hosted runner for a manual `workflow_dispatch`, which requires write
  access to trigger. Every `pull_request` event runs on GitHub-hosted runners.
- **It runs as a dedicated `ghrunner` system account** — not the login user. A
  compromised job cannot read `~/.ssh`, cloud credentials, or anything else
  owned by `arvarik`.
- **No sudo and no `docker` group.** Membership in `docker` is effectively root,
  and contrack's CI only needs Node — so the runner is not given it. This is
  also why container images build on GitHub-hosted runners rather than here.
- The systemd unit sets `ProtectSystem=strict`, `ProtectHome=true`,
  `PrivateTmp=true`, and `NoNewPrivileges=true`.

Keep **Settings → Actions → Fork pull request workflows** set to require
approval for outside collaborators. That is the control that stops a drive-by PR
from running anything at all.

### Operating it

```bash
# status / logs
systemctl status 'actions.runner.arvarik-contrack.*'
journalctl -u 'actions.runner.arvarik-contrack.*' -f

# restart
sudo systemctl restart 'actions.runner.arvarik-contrack.*'
```

The service is `Restart=always` and enabled at boot. To upgrade the runner or
re-register it, re-run the setup script — it is idempotent.

## Known limitations

- A self-hosted runner does **not** insulate you from a GitHub Actions control
  plane outage. Jobs are still dispatched by GitHub; during the incident on
  2026-08-06 self-hosted runners were explicitly affected too. It helps with
  queue congestion and hosted-pool capacity, not with Actions being down.
- Coverage is collected but no threshold is enforced.
