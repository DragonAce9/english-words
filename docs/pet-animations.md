# ТЗ: анимации питомца Моти

Практический чеклист для аниматора (или для самостоятельной отрисовки).  
Цель: внешние ассеты в `packages/web/public/moti/` (Telegram Mini App, Vite + React).

Связанный код:

- `packages/web/src/views/Moti.tsx` — сцена, happy / acting, **life-cycle sequencer**  
- `packages/web/src/views/PetHome.tsx` — кнопки ухода (кормить + развлечь), длительность one-shot  
- `packages/web/src/styles.css` — CSS micro-motion + disco overlays  
- `packages/web/src/types.ts` — `PetStatus`, `PetAction` (`feed` | `play`)

---

## 1. Персонаж

### Кто такой Моти

- Маленький тамагочи-спутник в приложении для изучения английских слов.
- Имя: **Моти / Мотя (Moti)**.
- **Визуальная идентичность:** мягкий blob-силуэт, светло-циановый / бирюзовый акварельный корпус, розовый румянец, крупные тёмно-карие глаза (или закрытые «счастливые» дуги), короткие ручки-культяпки. Стиль — цифровая акварель (мягкие края, bleed, без жёсткого чёрного контура).
- Ассеты: статичные PNG/WebP + CSS sway/bounce/slump/chew/dance + life clips. Фон сцены — `stage-bg.webp`.
- Пропорции и «милота» должны читаться на экране телефона ~128–160 px.

### Визуальный стиль (Mini App)

| Параметр | Рекомендация |
| --- | --- |
| Платформа | Telegram Mini App, узкий layout ≤430 px |
| Сцена | `.moti-stage`: ~210 px высота, скругление 22 px, фон `stage-bg.webp` |
| Размер персонажа на экране | ~128×128 CSS-px (арт 256×256) |
| Фон персонажа | **Прозрачный** |
| Палитра | Тёплый мятно-бирюзовый акцент; тёмная тема UI (`#10131a` / `#1b2130`) |
| Тень | CSS `.moti-shadow` |
| Reduced motion | Idle можно замедлить/заморозить; one-shot короткие |

### Карта клипов

| Клип | Статус |
| --- | --- |
| `idle-alive` | ✅ |
| `idle-happy` | ✅ |
| `idle-suffering` | ✅ |
| `idle-cryo` | ✅ (капсула/лёд, **не** чемодан) |
| `idle-graduated` | ✅ |
| `act-feed` | ✅ static + CSS chew loop |
| `act-play` | ✅ dance still + disco ball / beams |
| `life-wave` / `life-hop` / `life-sit` / `life-look` | ✅ alive life cycle |
| `life-walk` | ✅ CSS-only (арт `idle-*`, прогулка влево-вправо с разворотом) |
| `react-coins` | ✅ CSS-only (арт `idle-happy` + монетки) |
| `react-rescued` | ✅ CSS-only (арт `life-wave` + оттаивание) |
| `low-hunger` / `low-mood` | ✅ CSS-only подсказки на idle |
| `disco-ball` | ✅ play overlay |
| `stage-bg` | ✅ cozy watercolor room |

Уход **без** быта/учёбы — клипы `act-home` / `act-study` **не нужны**.

CSS-only клипы не имеют своих файлов в `moti/` — они переиспользуют готовые стилы и живут в `styles.css` + `Moti.tsx`. Если позже появится отдельный арт (поза «идёт», «ликует с монетой», «отряхивает лёд»), достаточно добавить файл и ветку в `motiArtSrc`.

---

## 2. Состояния / лупы (idle по `pet.status`)

Happy:

```ts
pet.status === "alive" && pet.hunger >= 70 && pet.mood >= 70
```

Кнопки ухода **заблокированы** при `cryo` и `graduated`.

| Ключ ассета | Условие | Тип | Настроение | Ориентир цикла |
| --- | --- | --- | --- | --- |
| life cycle | `alive` и не acting | sequencer | walk / wave / hop / sit / stand / look / blink | ~1.8–3.6 s на клип |
| `idle-suffering` | `suffering` | loop | Поник (без life dance) | ~4–5 s |
| `idle-cryo` | `cryo` | loop (медленный) | В капсуле / льду | ~2.5–4 s |
| `idle-graduated` | `graduated` | loop | Машет, чемодан | ~5 s |

### Everyday life cycle (`alive`, не acting)

Sequencer в `Moti.tsx` ротирует клипы:

| Клип | Арт | CSS | Длительность |
| --- | --- | --- | --- |
| `walk` | idle-alive / idle-happy | `life-walk`: 34 px влево, разворот через `scaleX(-1)`, обратно | ~3.6 s |
| `wave` | `life-wave` | bob + wave | ~2.8 s |
| `hop` | `life-hop` | hop path | ~3.2 s |
| `sit` | `life-sit` | settle down | ~2.6 s |
| `stand` | idle-* | stand up | ~1.8 s |
| `look` | `life-look` | cute tilt | ~3.0 s |
| `blink` | idle-* | breathe + lids | ~3.4 s |

Happy (высокие шкалы) предпочитает более живые клипы (`hop` / `walk` / `wave`). Suffering остаётся в `moti-slump`.

Плейлисты в `Moti.tsx`:

- normal: `blink → look → walk → wave → sit → stand → hop → blink`
- happy: `hop → walk → wave → look → hop → blink → walk → wave`
- low (`hunger` или `mood` < 30): без life cycle, арт `idle-suffering` (грустное лицо)

### Подсказки о низких шкалах (`alive`, не happy, не acting)

Порог `MOTI_LOW_STAT = 30`. Поверх текущего life-клипа анимируется сам `<img class="moti-art">`, поэтому с клипами не конфликтует.

| Класс | Условие | Эффект | Цикл |
| --- | --- | --- | --- |
| `moti-low-hunger` | `hunger < 30` | арт `idle-suffering`, сцена теплее, урчание | 4.2 s |
| `moti-low-mood` | `mood < 30` (и сытость в норме) | тот же грустный арт, сцена серее + облачко «…» | 5 s |

Сытость важнее настроения: если низко и то и другое — показываем урчание.

---

## 2a. Реакции без кнопки (one-shot)

Срабатывают из `PetHome` по пропсам `coinsFlash` / `rescued`. Приоритет ниже action, выше life cycle.

| `MotiReaction` | Триггер | Арт | Что происходит | Длительность |
| --- | --- | --- | --- | --- |
| `coins` | `coinsFlash > 0` (монеты за новые слова) | `idle-happy` | два прыжка `moti-jump`, 6 монеток разлетаются вверх, тёплый тинт сцены | 1.9 s |
| `rescued` | `cryo → alive` | `life-wave` | дрожь в холодном тинте → встряска → машет; капли льда стекают, голубое свечение гаснет | 2.8 s |

После реакции life cycle перезапускается с первого клипа (как после ухода).

---

## 3. One-shot действия (кнопки ухода)

| `PetAction` | Кнопка | Хинт | Идея |
| --- | --- | --- | --- |
| `feed` | Кормить | сытость | Еда → жевание (loop) |
| `play` | Развлечь | настроение | Диско-шар + лучи + танец |

**Длительность:** `MOTI_ACTION_MS = 3400` (~3.4 s = бывшие ~1.4 s + 2 s). CSS и таймер PetHome синхронизированы; motion зацикливается на всё окно.

| Ключ ассета | Loop? | Длительность | Содержание |
| --- | --- | --- | --- |
| `act-feed` | loop ~3.4 s | 3.4 s | Еда → жуёт |
| `act-play` | loop ~3.4 s | 3.4 s | Disco ball + soft beams/sparks + dance bob/sway |

---

## 4. Технический формат экспорта

**Sprite sheet (WebP/PNG) + JSON** — целевой формат; сейчас допустимы **статичные** кадры + CSS.

| Параметр | Значение |
| --- | --- |
| Canvas | **256×256 px** |
| Safe area | центральные **220×220** |
| Фон персонажа | Прозрачный |
| Anchor | `"anchor": { "x": 0.5, "y": 1.0 }` |
| Формат | **WebP** (quality ≥ 90), PNG fallback |

### Именование

```
moti/
  manifest.json
  stage-bg.webp
  idle-*.webp + .json
  act-feed.webp + .json
  act-play.webp + .json
  life-wave.webp / life-hop.webp / life-sit.webp / life-look.webp
  disco-ball.webp
```

### Таблица: статус / действие → ассет

| Условие UI | Ключ клипа |
| --- | --- |
| `acting === "feed"` | `act-feed` |
| `acting === "play"` | `act-play` (+ disco overlay) |
| `reaction === "coins"` | `idle-happy` (+ coin overlay) |
| `reaction === "rescued"` | `life-wave` (+ thaw overlay) |
| нет acting, `alive` | life sequencer → life-* / idle-* (+ low-* подсказки) |
| нет acting, `suffering` | `idle-suffering` |
| нет acting, `cryo` | `idle-cryo` |
| нет acting, `graduated` | `idle-graduated` |

Приоритет: **acting > reaction > life cycle > status idle**.

---

## 5. Экономика ухода (сводка)

- Действия: только **кормить** + **развлечь** (по 10 монет).
- Стартовые монеты: **22** = 2×10 + 2 (1h upkeep).
- Шкалы в UI: **сытость** + **настроение** (быт/учёба в БД могут оставаться, но не показываются и не тратятся).

---

## 6. Вне скоупа

- Переходы status→status (кроме реакции `rescued`), звук, haptic, скины, Spine/Rive/Lottie как primary.
- Отдельный арт для CSS-only клипов (`walk`, `coins`, `rescued`) — по желанию, см. раздел 1.
