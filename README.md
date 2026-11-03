# English Words — Telegram Mini App

Multilingual Telegram Mini App for learning vocabulary in several target languages. The interface and hints are in Russian. Practice uses themes and films, plus a pet and subscriptions.

## What's inside

- Mini App: React + Vite (`packages/web`)
- API and bot: Hono + grammY (`packages/api`)
- Dictionaries: `data/themes/*.json`
- Docker Compose: API, Postgres, Prometheus, Cloudflare Tunnel

Secrets and live service settings belong in `.env` (start from `.env.example`). `.env` is gitignored and is not committed.

Locally the Mini App opens in a browser as a test user. The dictionary lives in the API process RAM; progress and the pet live in PostgreSQL (reloading the Mini App does not erase the pet).

## Quick start (Docker)

```bash
cp .env.example .env
# set a real BOT_TOKEN — without it the bot does not poll Telegram
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000). The "test user" banner means there is no Telegram `initData` — the API admits `DEV_TELEGRAM_USER_ID=1`.

The "Open the app" button in Telegram needs a public HTTPS URL. A stable hostname is a named Cloudflare Tunnel (an account plus a zone or domain): see [below](#stable-https-a-named-cloudflare-tunnel). Without a domain, a quick `*.trycloudflare.com` URL remains (it changes every time `tunnel` restarts).

Prometheus: [http://localhost:9090](http://localhost:9090). API metrics: [http://localhost:3000/metrics](http://localhost:3000/metrics).

## Modes without extra requests

1. `GET /themes` — the theme list and counters.
2. `POST /sessions` — a batch of words, options, and match rounds.
3. Before a mode you can mark words as already known; those go straight to `POST /progress` and skip the queue.
4. Learn / match / test run only on the device.
5. `POST /progress` runs again at the end of a mode and on `visibilitychange` / `beforeunload`. Newly `known` words give the pet coins (`coinsEarned` plus a `pet` snapshot).

## Tamagotchi (Moti)

The Mini App home screen is the pet. A new pet starts at **60 hunger / 60 mood** and **22 coins** (`PET.startingCoins` = 2×10 for care + 2 for the first hour of upkeep). The bars start above the threshold where Moti looks unwell, so he starts in a normal mood, not a sad one. Care buttons raise them further. More coins arrive only when a word **first** becomes `known` (learn, test, or "already know"): **8 coins** per word (**about 3 words** ≈ one full care round: 2×10). Every hour, **2 coins** are spent and the bars drop a little (hunger / mood). "Feed" and "Play" cost **10 coins** and raise a bar (+24).

If there are no coins, the status is `suffering`. After **72 hours** (`PET_SUFFER_HOURS`; for a demo you can set `0.05`) he goes into a cryo capsule and leaves a note. Learning a word again is the rescue (coins plus a thaw). When **every** word id in the in-memory dictionary is known, the status is `graduated`: Moti leaves for another city, the tamagotchi is finished, and upkeep stops. Word modes remain.

Local cryo demo (Postgres from the host — port **5433**):

```bash
docker compose exec postgres psql -U english -d english -c "UPDATE pets SET coins=0, status='alive', last_tick_at = now() - interval '2 hours' WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 1);"
```

Refresh the pet screen — status `suffering`. Then:

```bash
docker compose exec postgres psql -U english -d english -c "UPDATE pets SET status='suffering', suffering_started_at = now() - interval '73 hours' WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 1);"
```

To win: `npm run simulate-tribute`, then in every theme mark "already know" on all words (including paid ones after a subscription).

## Development without a full image build

Node 22+ is required.

```bash
cp .env.example .env
docker compose up postgres prometheus -d
# if you previously started the full stack, free :3000:
# docker compose stop api
npm install
npm run dev:api   # one long-lived terminal; do not duplicate or kill it between tasks
npm run dev:web
```

API: http://localhost:3000. Mini App through the proxy: http://localhost:5173.

**Stable local setup:** Postgres (and optionally Prometheus) in Docker; the API and Vite locally via `npm run`. Do not run the Compose `api` service and `npm run dev:api` at the same time — both listen on `:3000`. The Compose API image has no source volume: after `import:dict` or JSON edits you need `docker compose up --build api`, or a local `dev:api` (the catalog is loaded into RAM only at startup). Vite on `:5173` does not start the API by itself — if the proxy returns HTTP 500 / `ECONNREFUSED`, nothing is listening on `:3000`.

## API tests

Postgres must be running.

```bash
docker compose up postgres -d
DATABASE_URL=postgres://english:english@localhost:5433/english ALLOW_DEV_AUTH=true npm test
```

The tests cover HMAC `initData`, the theme list, a session, a progress upsert, pet coins, cryo and graduation, the Tribute signature, and webhook idempotency.

## How to simulate Tribute (a digital product)

After `docker compose up`:

```bash
# buy monthly access for test user 1
npm run simulate-tribute

# yearly plan
npm run simulate-tribute yearly

# refund — access closes immediately
npm run simulate-tribute digital_product_refund
```

Or by hand:

```bash
BODY='{"name":"new_digital_product","created_at":"2026-10-08T08:00:00Z","sent_at":"2026-10-08T08:00:01Z","payload":{"product_id":1001,"purchase_id":42,"telegram_user_id":1,"amount":49900,"currency":"rub"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "dev-tribute-key" | awk '{print $2}')
curl -sS -X POST http://localhost:3000/webhook/tribute \
  -H 'Content-Type: application/json' \
  -H "trbt-signature: $SIG" \
  -d "$BODY"
```

Refresh the theme list in the Mini App: paid themes should unlock. Word progress is not deleted on refund.

Events: `new_digital_product` (+30 / +365 days by `product_id`), `digital_product_refund`. In `.env`, set the real `TRIBUTE_PRODUCT_MONTHLY_ID` / `TRIBUTE_PRODUCT_YEARLY_ID` from the Tribute dashboard.

## Bot

In `.env`, set a real `BOT_TOKEN` and a public HTTPS `WEBAPP_URL`. The API process then also polls grammY: `/start` and the WebApp button.

Postgres on the host listens on **5433** (inside Compose it is still 5432) so it does not conflict with a local Postgres on 5432.

Telegram will not open a local `http://localhost:3000` as a Mini App — use the browser to check the UI.

### Stable HTTPS: a named Cloudflare Tunnel

Telegram requires a public HTTPS Web App URL. One `tunnel` service in Compose proxies **API `:3000`** (Mini App + API; a separate `VITE_API_URL` is not needed). If `.env` sets `TUNNEL_TOKEN` and `CLOUDFLARED_CMD=tunnel --no-autoupdate run`, cloudflared starts a **named** (remotely managed) tunnel — the hostname does not change on restart.

**A domain is required for a public hostname.** You can create a named tunnel without a zone: the connector will be Healthy, but you cannot bind a stable HTTPS URL for `WEBAPP_URL`. In the dashboard, Public Hostname / Published application requires a zone in the same account. `*.cfargotunnel.com` is Cloudflare's internal CNAME target; it does not open in a browser as a Mini App URL. There is no separate free hostname from Cloudflare for a named tunnel: without a domain, use the [quick trycloudflare tunnel](#quick-trycloudflare-tunnel-no-account) or add an inexpensive domain to the account (Cloudflare Registrar, or another registrar plus Cloudflare nameservers).

Do not put Cloudflare Access (Zero Trust login) on this hostname: the Telegram WebApp will not get through it.

#### Dashboard clicks

1. Add a site or zone to the Cloudflare account (DNS) if you do not have one yet.
2. [Cloudflare dashboard](https://one.dash.cloudflare.com/) → **Zero Trust** → **Networks** → **Tunnels**. In the new UI this is the main dashboard → **Networking** → **Tunnels**.
3. **Create a tunnel** → type **Cloudflared** → a name (for example `english-words`) → save.
4. Environment **Docker** — copy the install command. `.env` needs **only the token** (the `eyJ…` after `--token`), not the whole `docker run` line.
5. **Public Hostname** (or **Routes** → **Add route** → **Published application**):
   - Subdomain: for example `app`
   - Domain: your zone from the list
   - Path: empty
   - Type / service: **HTTP**
   - URL: `http://api:3000` — the Compose service name and the container port, not `localhost`.
6. Save. Cloudflare creates a proxied CNAME to `<tunnel-id>.cfargotunnel.com`.

#### `.env` and startup

```
TUNNEL_TOKEN=eyJ…          # token only, do not commit
CLOUDFLARED_CMD=tunnel --no-autoupdate run
WEBAPP_URL=https://app.your-domain.com
```

`CLOUDFLARED_CMD` is required: the image is distroless and has no shell, so Compose cannot switch the command by itself when only a token is set. An empty `TUNNEL_TOKEN` keeps the previous quick `--url http://api:3000`.

```bash
docker compose up -d --build
```

If the stack is already running, reload `.env` with `up`, not `restart`:

```bash
docker compose up -d tunnel api
```

The tunnel is **Healthy**, and `https://app.your-domain.com/health` responds. Send the bot `/start` and the "Open the app" button appears. Optionally, in @BotFather → Bot Settings → Menu Button, set the same HTTPS URL. The machine must stay online. Tribute `POST /webhook/tribute` also uses this stable URL.

### Quick trycloudflare tunnel (no account)

You do not need a paid domain or a Cloudflare account. The URL is **unknown until** `cloudflared` **starts**, and it **changes every time** the `tunnel` container restarts (or `npm run tunnel`).

```bash
docker compose up -d --build
docker compose logs -f tunnel
```

Wait for `https://xxxx.trycloudflare.com` (or `docker compose logs tunnel | grep -o 'https://[^ ]*trycloudflare.com'`). Write it into `.env` as `WEBAPP_URL`, then run `docker compose up -d api`.

After a `tunnel` restart the URL changes — copy it again and `up -d api`. Tribute and a permanent bot button need the named tunnel above.

The API image builds the UI during `docker compose build`: after edits to `packages/web` you need `docker compose up -d --build api`.

**Without the Docker API** (local `npm run`):

```bash
brew install cloudflared   # once, on macOS
npm run build              # a fresh UI in packages/web/dist
# the API is already listening on :3000 — npm run dev:api (do not also run the Compose api service)
npm run tunnel             # = cloudflared tunnel --url http://localhost:3000
```

Then the same step: copy the URL into `WEBAPP_URL` and restart the API.

Alternative without `npm run build`: point the tunnel at Vite `:5173` while both `dev:api` and `dev:web` are running (Vite proxies the API to `:3000`). `WEBAPP_URL` is then the `:5173` tunnel URL. A tunnel that points only at Vite, with no API on `:3000`, breaks requests from a phone.

## Variables

See `.env.example`, plus `GEMINI_API_KEY`. `TMDB_API_KEY` is needed only by the `import:media` script when a poster comes from TMDB. `OPENSUBTITLES_API_KEY` is an application key from [opensubtitles.com/en/consumers](https://www.opensubtitles.com/en/consumers), not the site password; the username and password in `.env` are needed only to download a file (the quota).

`FACT_CHANNEL_ID` is the channel for the daily fact. Right now that is `@YOUR_CHANNEL_USERNAME`. Before the first fact, the bot posts a greeting once. An empty value sends nothing.

`VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` enable Mini App analytics. The token is baked into the UI at build time, so after an `.env` change you need `npm run build` or `docker compose up -d --build api`. An empty key sends nothing. The EU project host is `https://eu.i.posthog.com`.

## Texts and recommendations

In the **Add your text** block, the API picks out English words and matches them to the dictionary. For forms that are not in the catalog, Gemini (if `GEMINI_API_KEY` is set) only lemmatizes the token (infinitive or base form, and more than one part of speech when needed) and returns a translation and a category. Ordinary code stores the word: it looks up the lemma in the dictionary first, otherwise it writes a personal word with an example from the text. Without a key, recommendations use only the existing dictionary.

## Films and series

The user only picks a collection in the **Films and series** block. We add the films, series, and subtitles: JSON in `data/media/*.json` (the same shape as themes in `data/themes`). The poster and the words land in the same theme list.

From `.srt` / `.vtt`, or from the OpenSubtitles.com REST API:

```bash
npm run import:media -- --id lost-s01e01 --title "Lost · S01E01 Pilot" --kind episode --srt ./pilot.srt --poster URL --year 2004 --paid
npm run import:media -- --id sintel --title Sintel --kind movie --query Sintel --year 2010 --paid
```

`--ai` asks the model only for the base form, a translation, and a theme; the script adds the word to JSON after checking the lemma against the catalog. `--tmdb 4607` fills in the poster when `TMDB_API_KEY` is set. Restart the API after writing the JSON.

## Helm

A thin chart: `deploy/helm/english-words`. It is a Deployment + Service + Secret, without k3s, CloudNativePG, or cert-manager. The local setup is Docker Compose.

## Dictionary

The files are `data/themes/*.json` and the film collections `data/media/*.json`. The catalog is read into RAM when the API starts: every JSON file in those folders is its own theme. A word `id` is a global English slug (`airport`), the same in every theme that contains the word. Progress is unique on `(user_id, word_id)`: a learned `ticket` in Travel counts as known in the other lists too. After editing JSON, **restart the API** (`npm run dev:api` or `docker compose up --build api`) — Vite alone is not enough.

Themes are grouped into **blocks** (`data/blocks.json`: Basics, Everyday life, World and getting around, …). Every word has a **CEFR level** from `A1` to `C2` (from google-10000 frequency). In the Mini App the theme list is grouped by block; on a theme screen you pick a level before learn, match, or test.

The source is FreeDict English–Russian (WikDict/Wiktionary), license **CC BY-SA 3.0**. The frequency filter is an MIT list of common English words. Details and share-alike: [`data/ATTRIBUTION.md`](data/ATTRIBUTION.md). Proprietary dictionaries (Mueller, Lingvo, Quizlet) are not used.

The `travel` theme is free; the rest are paid. The tamagotchi is won when **every unique** catalog id is known (not the sum of theme lengths: one word in two lists counts once).

Rebuild the themes from FreeDict plus the curated seeds, then set CEFR levels and blocks:

```bash
npm run import:dict
npm run tag:cefr
```

`scripts/import-freedict.ts` downloads TEI into `data/source/` (gitignored), filters out names, slang, and empty entries, and places a word in **every** theme it fits. `general` holds only what fit nowhere else. It also mixes in the curated lists from `data/seeds/` (connectors, irregular verbs with their forms, and frequent verbs). `scripts/tag-cefr-and-blocks.ts` writes `blockId` and `level` into the JSON. Restart the API again after the import. Migration `004_canonical_word_ids.sql` rewrites old ids such as `travel.airport` to `airport`.

**Irregular verbs** (`irregular-verbs`): one card per lemma. `en` is `go / went / gone` (base / Past Simple / Past Participle), `ru` is the verb's meaning, and `id` is a slug of `en` (`go-went-gone`). The format works with Learn, Match, and Test; see `data/seeds/README.md`.
