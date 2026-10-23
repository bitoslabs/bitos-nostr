# BitOS Nostr deployment

Pushes to `main` run `.github/workflows/deploy.yml`. GitHub builds the pushed
commit, then asks the server to fetch and deploy that exact SHA. Nginx serves
`social.bitos.space` through PM2 `social` on `127.0.0.1:5173`. Production uses the Node adapter
and `build/index.js`, with `ORIGIN=https://social.bitos.space`, `HOST=127.0.0.1`,
`PORT=5173`, and `BODY_SIZE_LIMIT=209715200`. Node loads the release `.env`
using `--env-file-if-exists`. This preserves same-origin form upload checks
behind the HTTPS proxy.

The current app at `/var/www/social.bitos.space/app` comes from the separate
`bitoslabs/bitos-svelte` repository. The new workflow builds this repository in
`/srv/apps/bitos-nostr/releases/<sha>` and switches
`/srv/apps/bitos-nostr/current` after a successful build. On the first failed
health check, it restarts the previous app. Later failed deployments restore the
previous release. The old checkout is retained.

## One-time setup

Install `ops/social-deploy` as `/usr/local/bin/social-deploy` and
`ops/social-ssh-command` as `/usr/local/bin/social-ssh-command`, owned by root
and executable. Copy the current server `.env` to `/srv/apps/bitos-nostr/.env`
with mode `600`; review its values for compatibility with this app. The script
uses the server's existing Node 24.19.0, Yarn and root PM2 installation.

Create a dedicated SSH key for this workflow. Put its public key in root's
`authorized_keys` with a forced command and disabled forwarding:

```text
command="/usr/local/bin/social-ssh-command",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding ssh-ed25519 <public-key>
```

Verify the SSH host key fingerprint with the server administrator before using
the pinned host key in the workflow. Add the private key to the GitHub
`production` environment as `SOCIAL_DEPLOY_SSH_KEY`. The environment and secret
must exist before a push can deploy. Do not commit the private key or `.env`.

The repository's `develop` branch is ahead of `main`; merge the intended app
version into `main` to deploy it. The first push to `main` that includes the
workflow starts automatic deployment.

## Upload origin fix (2026-10-23)

The live app was rebuilt from the existing production checkout with
`@sveltejs/adapter-node@5.5.4` and activated at
`/srv/apps/bitos-nostr/upload-origin-fix`. The `current` link points there and
PM2 runs its `build/index.js`. The former release link is recorded in
`/srv/apps/bitos-nostr/current-before-origin-fix.txt`; the former PM2 dump is
retained at `/srv/apps/bitos-nostr/pm2-before-origin-fix.json`.

A public multipart image upload returned HTTP 200 after the switch. An
untrusted form origin still returned HTTP 403. Include the adapter/config and
lockfile changes in the next main deployment so the fix remains in future
releases. The local `deploy-social.sh [commit]` wrapper invokes the same
server deployment runner; the selected commit must already be on origin/main.

`https://bitos.space` is an explicit trusted form origin. The upload endpoint
also returns CORS response headers for that origin via `src/hooks.server.ts`.
Other external form origins remain blocked.
