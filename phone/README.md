# Phone app

A Telegram Mini App and bot that show and run Nimbalyst sessions on your own Windows PC from your phone. The page
opens from the bot's Open button in Telegram. It talks to a small program on your PC through a relay on
Cloudflare's free Workers plan. The page and the PC seal everything they send each other, so the relay passes on
bytes it cannot read. Plain JavaScript, no npm packages.

| Part | Where | What it does |
|---|---|---|
| Page | `phone/page/` | The screens in Telegram ([page README](page/README.md)) |
| Relay | `phone/relay/` | The Cloudflare Worker: one Durable Object (`Hub`) for the sockets and the bot's webhook, the page as static files |
| Shared | `phone/shared/` | The sealing code the page and the PC both use |
| PC program | `skills/phone-bot/pc/` | Runs on your PC, joins the relay, answers the page |

The relay's deploy files:

| File | What it is |
|---|---|
| `relay/wrangler.jsonc` | The Worker's settings: the `HUB` binding to the SQLite-backed class `Hub`, the page as static assets. No Worker name and no account: both come at deploy time |
| `relay/deploy.mjs` | The deploy both ways share: page, `wrangler deploy`, the relay secrets, the bot's webhook and Open button |
| `relay/deploy-test.mjs` | The test relay, deployed from your PC with your secrets file |
| `.github/workflows/phone-deploy.yml` | The real relay, deployed by GitHub Actions from a release tag only |

Both deploys run Wrangler with one pinned version (`WRANGLER_VERSION` in `relay/deploy.mjs`). Both refuse a page
that differs from `skills/phone-bot/pc/page-hashes.json`, since a PC marks such a page unverified and goes
read-only.

## Two relays, one at a time

| | Test relay | Real relay |
|---|---|---|
| Worker name | `phone-relay-test` | `phone-relay` |
| Deployed by | `node phone/relay/deploy-test.mjs` on your PC | The release workflow, on a pushed `v*` tag |
| Tokens from | Your secrets file | The `phone-relay` GitHub environment |

The test relay lives until the first release with the phone app. Then it is deleted and both tokens are replaced
(step 6), so the copies that sat in a file on your PC stop working and only GitHub can deploy.

## Your steps

### 1. A Cloudflare deploy token, narrowest scope

1. Turn on two-factor sign-in for your Cloudflare login.
2. In the Cloudflare dashboard open **Workers and Pages** once, so your account gets its free Workers subdomain.
3. **My Profile > API Tokens > Create Token > Custom token**, with these permissions only:
   - Account > **Workers Scripts** > Edit
   - Account > **Account Settings** > Read
4. Account Resources: include only your one account. Zone Resources: none (the relay uses no domain of yours).
5. Copy the token and your account id (on the account's Workers overview page).

If the test deploy is refused for a missing permission, Wrangler names it; add that one permission and nothing
else.

### 2. Your secrets file

One file on your PC, outside every repository: `~/.phone-app/owner-secrets.json`.

| Key | Holds |
|---|---|
| `cloudflareApiToken` | The deploy token (step 1) |
| `cloudflareAccountId` | Your Cloudflare account id |
| `botToken` | Your bot's token from BotFather |
| `ownerTelegramId` | Your Telegram user id (a number) |

    node phone/relay/deploy-test.mjs --setup

It asks for the token and the account id as hidden input, writes them into the file (keeping its other keys) and
limits the file to your Windows user. Add `botToken` and `ownerTelegramId` to the same file with an editor.

### 3. The test deploy

    node phone/relay/deploy-test.mjs --dry-run
    node phone/relay/deploy-test.mjs

The dry run checks the file and the page and shows each step; it writes nothing and calls nobody. The real run
builds the page into `phone/relay/dist/` (git ignores it), deploys `phone-relay-test`, puts the relay secrets, sets
the bot's webhook, its command menu, description and short description, and your chat's Open button, and prints
the relay's address and "webhook set". It never prints a secret value. A missing key in the file stops it with the
key's name.

If the bot was used before for something else, its old messages stay in your chat: Telegram lets a bot delete a
message only in the first 48 hours after it was sent, so the deploy cannot remove them. Clear them yourself, once:

1. In the chat with the bot, open its menu: on iPhone tap the bot's name at the top, then **More**; on Android
   and Telegram Desktop tap the three dots at the top right.
2. Tap **Clear History** (on iPhone it may read **Clear Messages**) and confirm.

### 4. The GitHub environment (once, before the first release tag)

With your `gh` login, where `<owner>/<repo>` is your public copy of this repository:

    gh api -X PUT repos/<owner>/<repo>/environments/phone-relay \
      -F "deployment_branch_policy[protected_branches]=false" \
      -F "deployment_branch_policy[custom_branch_policies]=true"
    gh api -X POST repos/<owner>/<repo>/environments/phone-relay/deployment-branch-policies \
      -f name='v*' -f type=tag
    gh api repos/<owner>/<repo>/environments/phone-relay/deployment-branch-policies

The last call must show exactly one policy: `"name": "v*"` with `"type": "tag"`. Make the environment before
the first tag: a workflow that names a missing environment makes it with no rule.

### 5. The secrets (in the `phone-relay` environment)

#### CI secrets

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id |
| `PHONE_BOT_TOKEN` | Your bot's token |
| `PHONE_OWNER_TG_ID` | Your Telegram user id |

Set each with its value on standard input or in `gh`'s own hidden prompt, never on the command line:

    gh secret set CLOUDFLARE_API_TOKEN --env phone-relay

Check: `gh secret list --env phone-relay` shows these four names (names and dates only, never values).

#### Relay secrets

The deploy puts these on the Worker itself, from the values above. You never set them by hand.

| Name | Value |
|---|---|
| `BOT_TOKEN` | The bot's token |
| `BOT_ID` | The part of the bot's token before the colon |
| `OWNER_TG_ID` | Your Telegram user id |
| `WEBHOOK_SECRET` | 48 random characters, new at each deploy; Telegram sends it with each webhook call, and the relay refuses a call without it |

### 6. The release deploy

At the first release with the phone app, in this order:

1. The test relay holds nothing you still need (the bot's `/people` shows no held items).
2. Delete the test relay: `npx wrangler@<WRANGLER_VERSION> delete --name phone-relay-test`, with the token and
   account id of step 1 in `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Roll the deploy token (Cloudflare, **My Profile > API Tokens >** the token **> Roll**); paste the new value only
   into `gh secret set CLOUDFLARE_API_TOKEN --env phone-relay`.
4. Reissue the bot token in BotFather (`/revoke`); paste the new value only into
   `gh secret set PHONE_BOT_TOKEN --env phone-relay`.
5. Set `CLOUDFLARE_ACCOUNT_ID` and `PHONE_OWNER_TG_ID`; check the four names.
6. Delete `cloudflareApiToken` and `botToken` from your secrets file.
7. Push the release tag `v<version>`. The workflow checks that the tagged commit is on `main` and that the tag
   equals `version.json`'s version, then deploys `phone-relay` and points the bot at it.
8. Join your PC to the new address and pair again.

After that, each release tag deploys the page of that release.

## Undo

- **A relay:** `npx wrangler@<WRANGLER_VERSION> delete --name phone-relay-test` (or `phone-relay`), with the
  token and account id in the environment as in step 6. Its stored data goes with it.
- **The bot:** after the relay is gone, Telegram's calls to the old webhook fail and stop. To use the bot
  elsewhere, set its webhook again from there, or reissue its token in BotFather.
- **The deploy token:** revoke it in Cloudflare (**My Profile > API Tokens**).
- **The release deploy:** delete the environment, which deletes its secrets:
  `gh api -X DELETE repos/<owner>/<repo>/environments/phone-relay`. A later tag's run then has no secrets and
  stops with an error naming them, before it deploys anything. To stop it for good, delete
  `.github/workflows/phone-deploy.yml`.
- **Your secrets file:** delete `~/.phone-app/owner-secrets.json`.
