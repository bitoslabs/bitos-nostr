# BitOS Nostr deployment

Pushes to `main` run `.github/workflows/deploy.yml`. GitHub builds the pushed
commit, then asks the server to fetch and deploy that exact SHA. Nginx serves
`social.bitos.space` through PM2 `social` on `127.0.0.1:5173`.

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
