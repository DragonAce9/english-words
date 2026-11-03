# English Words — Telegram Mini App

Multilingual Telegram Mini App for learning vocabulary in several target languages. The interface and hints are in Russian. Practice uses themes and films, plus a pet and subscriptions.

## What's inside

- Mini App: React + Vite (`packages/web`)
- API and bot: Hono + grammY (`packages/api`)
- Dictionaries: `data/themes/*.json`
- Docker Compose: API, Postgres, Prometheus, Cloudflare Tunnel

Secrets and live service settings belong in `.env` (start from `.env.example`). `.env` is gitignored and is not committed.

Локально Mini App открывается в браузере с тестовым пользователем. Словарь живёт в RAM процесса, прогресс и питомец — в PostgreSQL (сброс Mini App питомца не стирает).

## Быстрый старт (Docker)

```bash
cp .env.example .env
# поставь настоящий BOT_TOKEN — без него бот не поллит Telegram
docker compose up -d --build
```

Открой [http://localhost:3000](http://localhost:3000). Баннер «тестовый пользователь» значит, что Telegram `initData` нет — API пускает `DEV_TELEGRAM_USER_ID=1`.

Для кнопки «Открыть приложение» в Telegram нужен публичный HTTPS. Стабильный hostname — именованный Cloudflare Tunnel (аккаунт + зона/домен): см. [ниже](#стабильный-https-именованный-cloudflare-tunnel). Без домена остаётся quick `*.trycloudflare.com` (URL меняется при каждом рестарте `tunnel`).

Prometheus: [http://localhost:9090](http://localhost:9090), метрики API: [http://localhost:3000/metrics](http://localhost:3000/metrics).

## Режимы без лишних запросов

1. `GET /themes` — список тем и счётчики.
2. `POST /sessions` — пачка слов, варианты и раунды пар.
3. Перед режимом можно отметить «уже знаю»; эти слова сразу уходят в `POST /progress` и не попадают в очередь.
4. Обучение / пары / тест идут только на устройстве.
5. `POST /progress` — ещё раз в конце режима и при `visibilitychange` / `beforeunload`. Новые `known` слова дают монеты питомцу (`coinsEarned` + снимок `pet`).

## Тамагочи (Моти)

Домашний экран Mini App — питомец. Новый питомец стартует с **60 сытости / 60 настроения** и **22 монетами** (`PET.startingCoins` = 2×10 уход + 2 на первый час апкипа). Шкалы выше порога, с которого Моти выглядит плохо, поэтому со старта он обычный, не грустный. Кнопки ухода поднимают их дальше. Монеты дальше приходят только когда слово **впервые** становится `known` (обучение, тест, «уже знаю»): **8 монет** за слово (**≈3 слова** ≈ один полный раунд ухода: 2×10). Раз в час списывается **2 монеты** и чуть падают шкалы (сытость / настроение). Кнопки «Кормить» и «Развлечь» стоят **10 монет** и поднимают шкалу (+24).

Если монет нет, статус `suffering`. Через **72 часа** (`PET_SUFFER_HOURS`, для демо можно поставить `0.05`) он уходит в криокапсулу и оставляет записку. Спасение — снова выучить слово (монеты + оттепель). Когда известны **все** id слов из словаря в RAM, статус `graduated`: Моти уезжает в другой город, тамагочи пройден, апкип больше не идёт. Режимы слов остаются.

Локальное демо крио (Postgres с хоста — порт **5433**):

```bash
docker compose exec postgres psql -U english -d english -c "UPDATE pets SET coins=0, status='alive', last_tick_at = now() - interval '2 hours' WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 1);"
```

Обнови экран питомца — `suffering`. Затем:

```bash
docker compose exec postgres psql -U english -d english -c "UPDATE pets SET status='suffering', suffering_started_at = now() - interval '73 hours' WHERE user_id = (SELECT id FROM users WHERE telegram_user_id = 1);"
```

Победа: `npm run simulate-tribute`, в каждой теме отметь «уже знаю» на все слова (включая платные после подписки).

## Разработка без полной сборки образа

Нужен Node 22+.

```bash
cp .env.example .env
docker compose up postgres prometheus -d
# если раньше поднимали полный стек — освободи :3000:
# docker compose stop api
npm install
npm run dev:api   # один долгоживущий терминал; не дублируй и не убивай между задачами
npm run dev:web
```

API: http://localhost:3000, Mini App с прокси: http://localhost:5173.

**Стабильный локальный контур:** Postgres (+ опционально Prometheus) в Docker, API и Vite — локально через `npm run`. Не держи одновременно `docker compose` сервис `api` и `npm run dev:api` — оба слушают `:3000`. Compose-образ API без volume на исходники: после `import:dict` / правок JSON нужен `docker compose up --build api` либо локальный `dev:api` (каталог в RAM только при старте). Vite на `:5173` сам по себе API не поднимает — если прокси даёт HTTP 500 / `ECONNREFUSED`, значит никто не слушает `:3000`.

## Тесты API

Postgres должен быть запущен.

```bash
docker compose up postgres -d
DATABASE_URL=postgres://english:english@localhost:5433/english ALLOW_DEV_AUTH=true npm test
```

Проверяются HMAC `initData`, список тем, сессия, upsert прогресса, монеты питомца, крио и выпуск, подпись Tribute и идемпотентность вебхука.

## Как симулировать Tribute (цифровой товар)

После `docker compose up`:

```bash
# купить месячный доступ тестовому пользователю 1
npm run simulate-tribute

# годовой тариф
npm run simulate-tribute yearly

# возврат — доступ сразу закрывается
npm run simulate-tribute digital_product_refund
```

Или вручную:

```bash
BODY='{"name":"new_digital_product","created_at":"2026-10-08T08:00:00Z","sent_at":"2026-10-08T08:00:01Z","payload":{"product_id":1001,"purchase_id":42,"telegram_user_id":1,"amount":49900,"currency":"rub"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "dev-tribute-key" | awk '{print $2}')
curl -sS -X POST http://localhost:3000/webhook/tribute \
  -H 'Content-Type: application/json' \
  -H "trbt-signature: $SIG" \
  -d "$BODY"
```

Обнови список тем в Mini App: платные темы должны открыться. Прогресс слов при refund не удаляется.

События: `new_digital_product` (+30 / +365 дней по `product_id`), `digital_product_refund`. В `.env` задай реальные `TRIBUTE_PRODUCT_MONTHLY_ID` / `TRIBUTE_PRODUCT_YEARLY_ID` из дашборда Tribute.

## Бот

В `.env` поставь настоящий `BOT_TOKEN` и публичный HTTPS `WEBAPP_URL`. Тогда процесс API ещё и поллит grammY: `/start` и кнопка WebApp.

Postgres с хоста слушает **5433** (внутри Compose по-прежнему 5432), чтобы не спорить с локальным Postgres на 5432.

Локальный `http://localhost:3000` Telegram как Mini App не откроет — для проверки UI используй браузер.

### Стабильный HTTPS: именованный Cloudflare Tunnel

Telegram требует публичный HTTPS Web App URL. Один сервис `tunnel` в Compose проксирует **API `:3000`** (Mini App + API; отдельный `VITE_API_URL` не нужен). Если в `.env` задан `TUNNEL_TOKEN` и `CLOUDFLARED_CMD=tunnel --no-autoupdate run`, cloudflared поднимает **именованный** (remotely managed) туннель — hostname не меняется при рестарте.

**Домен обязателен для публичного hostname.** Именованный туннель можно создать без зоны: коннектор будет Healthy, но привязать стабильный HTTPS для `WEBAPP_URL` нельзя. В дашборде Public Hostname / Published application требует зону в этом же аккаунте. `*.cfargotunnel.com` — внутренний CNAME-таргет Cloudflare, в браузере как Mini App URL не открывается. Отдельного «бесплатного hostname от Cloudflare» для named tunnel нет: без домена используй [quick trycloudflare](#quick-туннель-trycloudflare-без-аккаунта) или добавь дешёвый домен в аккаунт (Cloudflare Registrar или регистратор + nameservers Cloudflare).

Не вешай на этот hostname Cloudflare Access (логин Zero Trust): Telegram WebApp его не пройдёт.

#### Клики в дашборде

1. Добавь сайт/зону в аккаунт Cloudflare (DNS), если её ещё нет.
2. [Cloudflare dashboard](https://one.dash.cloudflare.com/) → **Zero Trust** → **Networks** → **Tunnels**. В новом UI то же самое: основной дашборд → **Networking** → **Tunnels**.
3. **Create a tunnel** → тип **Cloudflared** → имя (например `english-words`) → сохранить.
4. Environment **Docker** — скопируй install-команду. В `.env` нужен **только токен** (`eyJ…` после `--token`), не вся строка `docker run`.
5. **Public Hostname** (или **Routes** → **Add route** → **Published application**):
   - Subdomain: например `app`
   - Domain: своя зона из списка
   - Path: пусто
   - Type / service: **HTTP**
   - URL: `http://api:3000` — имя сервиса Compose и порт контейнера, не `localhost`.
6. Сохрани. Cloudflare сам создаст проксированный CNAME на `<tunnel-id>.cfargotunnel.com`.

#### `.env` и запуск

```
TUNNEL_TOKEN=eyJ…          # только токен, не коммить
CLOUDFLARED_CMD=tunnel --no-autoupdate run
WEBAPP_URL=https://app.your-domain.com
```

`CLOUDFLARED_CMD` нужен: образ distroless, без shell compose не умеет сам переключить команду, если задан только токен. Пустой `TUNNEL_TOKEN` → прежний quick `--url http://api:3000`.

```bash
docker compose up -d --build
```

Если стек уже крутился — перечитай `.env` именно через `up`, не `restart`:

```bash
docker compose up -d tunnel api
```

Туннель **Healthy**, `https://app.your-domain.com/health` отвечает. Боту `/start` — кнопка «Открыть приложение». По желанию @BotFather → Bot Settings → Menu Button — тот же HTTPS. Машина должна быть онлайн. Tribute `POST /webhook/tribute` тоже идёт на этот стабильный URL.

### Quick-туннель trycloudflare (без аккаунта)

Платный домен и аккаунт Cloudflare не нужны. URL **неизвестен до старта** `cloudflared` и **меняется при каждом рестарте** контейнера `tunnel` (или `npm run tunnel`).

```bash
docker compose up -d --build
docker compose logs -f tunnel
```

Дождись `https://xxxx.trycloudflare.com` (или `docker compose logs tunnel | grep -o 'https://[^ ]*trycloudflare.com'`). Запиши в `.env` как `WEBAPP_URL` и `docker compose up -d api`.

После рестарта `tunnel` URL сменится — снова скопируй и `up -d api`. Для Tribute и постоянной кнопки бота нужен именованный туннель выше.

UI в образе API собирается при `docker compose build`: после правок `packages/web` нужен `docker compose up -d --build api`.

**Без Docker API** (локальный `npm run`):

```bash
brew install cloudflared   # один раз на macOS
npm run build              # свежий UI в packages/web/dist
# API уже слушает :3000 — npm run dev:api (не держи одновременно docker compose api)
npm run tunnel             # = cloudflared tunnel --url http://localhost:3000
```

Дальше тот же шаг: скопируй URL в `WEBAPP_URL` и перезапусти API.

Альтернатива без `npm run build`: туннель на Vite `:5173`, пока крутятся и `dev:api`, и `dev:web` (Vite проксирует API на `:3000`). `WEBAPP_URL` тогда = URL туннеля `:5173`. Один туннель на Vite без API на `:3000` сломает запросы с телефона.

## Переменные

См. `.env.example`: плюс `GEMINI_API_KEY`. `TMDB_API_KEY` нужен только скрипту `import:media`, если постер берётся с TMDB. `OPENSUBTITLES_API_KEY` — ключ приложения на [opensubtitles.com/en/consumers](https://www.opensubtitles.com/en/consumers), не пароль сайта; логин/пароль в `.env` нужны только чтобы скачать файл (квота).

`FACT_CHANNEL_ID` — канал ежедневного факта. Сейчас это `@YOUR_CHANNEL_USERNAME`. Перед первым фактом бот один раз пишет приветствие. Пустое значение ничего не отправляет.

`VITE_POSTHOG_KEY` и `VITE_POSTHOG_HOST` включают аналитику Mini App. Токен вшивается в UI при сборке, поэтому после правки `.env` нужен `npm run build` или `docker compose up -d --build api`. Пустой ключ ничего не отправляет. Хост проекта — EU: `https://eu.i.posthog.com`.

## Тексты и рекомендации

Блок **Добавь свой текст**: API выделяет английские слова и сопоставляет их со словарём. Для форм, которых в каталоге нет, Gemini (если задан `GEMINI_API_KEY`) только лемматизирует токен (инфинитив / начальная форма, при необходимости несколько частей речи), даёт перевод и категорию. В базу слово кладёт обычный код: сначала ищет лемму в словаре, иначе пишет личное слово с примером из текста. Без ключа рекомендации строятся только по уже существующему словарю.

## Фильмы и серии

Пользователь только выбирает подборку в блоке **Кино и сериалы**. Фильмы, сериалы и субтитры добавляем мы: JSON в `data/media/*.json` (как темы в `data/themes`). Постер и слова попадают в тот же список тем.

Из `.srt` / `.vtt` или с OpenSubtitles.com REST API:

```bash
npm run import:media -- --id lost-s01e01 --title "Lost · S01E01 Pilot" --kind episode --srt ./pilot.srt --poster URL --year 2004 --paid
npm run import:media -- --id sintel --title Sintel --kind movie --query Sintel --year 2010 --paid
```

`--ai` просит модель только начальную форму, перевод и тему; в JSON слово добавляет скрипт, сначала сверяя лемму с каталогом. `--tmdb 4607` подставляет постер, если задан `TMDB_API_KEY`. После записи JSON перезапусти API.

## Helm

Тонкий чарт: `deploy/helm/english-words`. Это Deployment + Service + Secret, без k3s/CloudNativePG/cert-manager. Локальный контур — Docker Compose.

## Словарь

Файлы `data/themes/*.json` и подборки кино `data/media/*.json`. Каталог читается в RAM при старте API: все JSON в этих папках — отдельные темы. `id` слова — глобальный slug английского (`airport`), один и тот же в каждой теме, где слово есть. Прогресс уникален по `(user_id, word_id)`: выученный `ticket` в «Путешествиях» считается известным и в других списках. После правки JSON **перезапусти API** (`npm run dev:api` или `docker compose up --build api`) — одного Vite недостаточно.

Темы сгруппированы в **блоки** (`data/blocks.json`: Основы, Повседневная жизнь, Мир и перемещения, …). У каждого слова есть **уровень CEFR** `A1`–`C2` (по частотности google-10000). В Mini App список тем идёт блоками; на экране темы выбираешь уровень перед обучением/парами/тестом.

Источник — FreeDict English–Russian (WikDict/Wiktionary), лицензия **CC BY-SA 3.0**. Частотный фильтр — MIT-список распространённых английских слов. Подробности и share-alike: [`data/ATTRIBUTION.md`](data/ATTRIBUTION.md). Проприетарные словари (Mueller, Lingvo, Quizlet) не используются.

Тема `travel` бесплатная, остальные платные. Победа тамагочи — известны **все уникальные** id каталога (не сумма длин тем: одно слово в двух списках считается один раз).

Пересобрать темы из FreeDict + curated seeds, затем проставить CEFR и блоки:

```bash
npm run import:dict
npm run tag:cefr
```

Скрипт `scripts/import-freedict.ts` качает TEI в `data/source/` (gitignored), фильтрует имена/сленг/пустые статьи и кладёт слово во **все** подходящие темы. `general` — только то, что никуда не попало. Дополнительно подмешивает curated-списки из `data/seeds/` (связки, неправильные глаголы с формами, частотные глаголы). `scripts/tag-cefr-and-blocks.ts` пишет `blockId` и `level` в JSON. После импорта снова перезапусти API. Миграция `004_canonical_word_ids.sql` переписывает старые `travel.airport` → `airport`.

**Неправильные глаголы** (`irregular-verbs`): одна карточка на лемму, `en` = `go / went / gone` (base / Past Simple / Past Participle), `ru` = значение глагола, `id` = slug от `en` (`go-went-gone`). Формат совместим с Learn / Match / Test; см. `data/seeds/README.md`.
