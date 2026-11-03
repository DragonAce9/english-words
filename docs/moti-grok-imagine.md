# Бриф: Моти для Grok Imagine

Пакет картинок и коротких лупов. Эталон — уже нарисованные кадры в `packages/web/public/moti/` (PNG 256×256, прозрачный фон, персонаж стоит на нижней кромке). Новые кадры должны быть тем же существом. Код не менять. Цены не придумывать. Логотип Tribute не рисовать.

## Референсы

Текущий вид Моти утверждён: он нравится, его нужно совпасть. Новый дизайн не придумывать.

Файлы в `packages/web/public/moti/` — визуальный референс. В Grok Imagine к каждому заданию отдать сами PNG. Одного текста этого брифа недостаточно.

| Сдача | Какой файл приложить |
| --- | --- |
| Аватар `moti-avatar.png` | `idle-alive.png` |
| Иконка месяца `moti-tribute-month.png` | `idle-alive.png`. Кадрирование как у аватара |
| Иконка года `moti-tribute-year.png` | `idle-alive.png`. Кадрирование как у аватара |
| Луп idle | `idle-alive.png` |
| Луп coins | `idle-alive.png` (поза покоя) и `idle-happy.png` |
| Луп sad | `idle-alive.png` (поза покоя) и `idle-suffering.png` |
| Луп feed | `idle-alive.png` (поза покоя) и `act-feed.png` |
| Луп play | `idle-alive.png` (поза покоя), `act-play.png` и `disco-ball.png` |
| Луп wave | `idle-alive.png` (поза покоя) и `life-wave.png` |

Иконки Tribute — тот же сидящий Моти, что аватар: лицо крупное и внутри центрального круга. Полумесяц, солнечный диск и подпись добавляются к этому кадру. Персонажа не менять.

## 1. Кто такой Моти

Моти — одно округлое существо без ушей, носа, волос, одежды, хвоста и пальцев: тело и голова слиты в яйцо, шире к низу, как мягкая клёцка. Корпус акварельный, бледный мятно-бирюзовый: середина живота около `#C7E2E0`, тени `#70C0C0`–`#40A0B0`, блики почти белые с холодным оттенком. Край мокрый, с бумажным зерном и полупрозрачной бахромой, без чёрной обводки. Глаза большие и круглые, зрачки тёмно-коричневые около `#271F28`, в каждом по белому блику. Румянец персиковый: на спокойном сидении едва пыльный (`#DAC8C2`), на радости и взгляде в камеру ярче (`#D67B7A`–`#F7B2A6`). Руки — короткие варежки. В сидячих позах низ тела слит с основанием; ступни появляются только в прыжке, шаге и танце. Рот — тонкая улыбка; в радости он широко открыт простой коралловой дугой, без ряда зубов.

Позы, которые уже есть (все статичные, один кадр):

| Файл | Что на кадре |
| --- | --- |
| `idle-alive.png` | Сидит лицом, глаза открыты, тихая улыбка, руки на коленях. База. |
| `idle-happy.png` | Прыжок: обе руки вверх, одна нога отставлена, глаза закрыты дугами, рот широко открыт. |
| `idle-suffering.png` | Съёжился, брови домиком, взгляд вниз, рот грустный. |
| `act-feed.png` | Сидит и ест онигири обеими руками: белый рис, тёмная полоска нори около `#131F1A`, глаза закрыты, улыбка. |
| `act-play.png` | Танец: одна рука вверх, одна нога поднята, глаза открыты, рот открыт. |
| `life-wave.png` | Сидит и машет одной рукой, вторая на колене, глаза открыты. |
| `life-hop.png` | Шаг-прыжок вбок, обе маленькие ступни видны, улыбка. |
| `life-sit.png` | Спокойное сидение, почти как `idle-alive`. |
| `life-look.png` | Сидит, голова чуть наклонена, взгляд вверх и в сторону. |
| `idle-cryo.png` | Тот же Моти внутри мягкой ледяной глыбы, глаза закрыты, руки сложены. В этот пакет лупы не входят. |
| `idle-graduated.png` | Машет и держит тёплый чемодан (`#E8AD65`), позади комната с рваным краем бумаги. В этот пакет лупы не входят. |
| `disco-ball.png` | Акварельный зеркальный шар, серебро и сирень, без цепочки. Только над Моти в танце. |
| `stage-bg.png` | Отдельная комната 640×420: окно, розовые шторы, камин, полки, кресло. На персонажа её не рисовать. |

## 2. Style lock

Держать в каждом кадре и в каждом промпте:

- Один и тот же силуэт: яйцо шире книзу, без ушей, рогов, волос, носа, одежды, хвоста, пальцев, зубов.
- Цвет корпуса `#C7E2E0`, тень `#70C0C0`, блик почти белый. Румянец персиковый. Зрачки `#271F28`.
- Акварель детской книги: мокрый край, зерно бумаги, без чёрного контура и без толстой обводки.
- Руки-варежки. Ступни только если поза стоячая, прыжок или танец.
- Один персонаж. Никакого текста на лупах и на аватаре. Никакого водяного знака.

Не делать: 3D, Pixar, аниме с контуром, кота, собаку, слизня другого цвета, фиолетовое или розовое тело, одежду, фотореализм, жёсткую тень, комнату на прозрачных кадрах, второго персонажа, буквы на теле.

Лупы персонажа: фон прозрачный. Если инструмент не умеет альфу — плоский хромакей `#FF00FF` и ни грамма этого цвета на Моти. Комнату `stage-bg` в луп не вставлять.

## 3. Аватар

Один квадрат для Telegram и профиля.

| | |
| --- | --- |
| Файл | `moti-avatar.png` |
| Референс | Приложить `idle-alive.png`. Совпасть с этим кадром: тот же персонаж, палитра, акварельный край, пропорции. |
| Размер | 1024×1024 PNG |
| Поза | Сидит лицом, как `idle-alive`: глаза открыты и смотрят в камеру, тихая улыбка, руки на коленях. Не прыжок и не грусть. |
| Кадр | Голова и тело крупные. Макушка примерно на 8% от верха, низ тела примерно на 8% от низа. Лицо и румянец внутри центрального круга: Telegram обрежет квадрат в круг. |
| Фон | Мягкое бумажное пятно, крем `#F7F3EA` к бледной мяте `#E5F3F0`. Не чёрный, не прозрачный, не комната, не ободок-логотип. |
| Без | Текста, монет, онигири, диско-шара, чемодана, льда. |

## 4. Лупы

Шесть лупов. Каждый 12 кадров в секунду, квадрат 512×512, персонаж по центру и на нижней опоре, как в текущих 256×256 (низ тела около 7–8% от края). В приложении ролик играет как 256×256; генерировать можно 512×512. Фон прозрачный. Длина короткая, около 1,5–2,5 с. Движется только то, что названо. Силуэт и палитра не плывут.

### Сменные ролики

Каждая анимация Моти взаимозаменяема. Новые ролики можно добавлять позже и подставлять в воспроизведение, не переснимая остальные.

- У всех роликов одна поза покоя: сидящий Моти лицом, `packages/web/public/moti/idle-alive.png`. Руки на коленях, ступни спрятаны, глаза открыты, тихая улыбка.
- Каждый ролик устроен так: поза покоя → одно действие → та же поза покоя. Первый кадр и последний кадр совпадают с `idle-alive` достаточно близко, чтобы один ролик можно было сменить другим без скачка.
- Плеер может держать позу покоя, проиграть любой ролик и снова остаться в позе покоя.
- Ролик не начинается уже в прыжке, в танце, за едой или в съёженной грусти. Действие только в середине, затем возврат в ту же посадку.

### 4.1. `idle` — спокойное сидение

Живой Моти без действий. Опора и поза покоя: `idle-alive`. Референс приложить: `idle-alive.png`.

- 2,0 с, 24 кадра, луп.
- Кадр 1 и кадр 24 совпадают с `idle-alive.png`.
- В середине дыхание: корпус чуть сжимается и возвращается. Одно моргание, к последнему кадру глаза снова открыты.
- Руки на коленях. Ноги не отрастают.
- Фон прозрачный.

### 4.2. `coins` — радость, когда приходят монеты

Реакция на монеты длится около 1,9 с. Поза покоя — `idle-alive`, прыжок в середине — как `idle-happy`. Референс приложить: `idle-alive.png` и `idle-happy.png`.

- 2,0 с, 24 кадра, луп.
- Кадр 1 и кадр 24: сидение как `idle-alive`, не прыжок.
- В середине один короткий прыжок радости: руки вверх, одна нога отставлена, глаза-дуги, открытый рот, затем приземление в ту же посадку. Не начинать уже в воздухе.
- Две-три маленькие плоские золотые монетки всплывают во время прыжка и гаснут так, чтобы к последнему кадру их не осталось. Без цифр и без «+».
- Фон прозрачный.

### 4.3. `sad` — голод и плохое настроение

Один и тот же ролик, когда сытость или настроение низкие, и когда Моти страдает. Поза покоя — `idle-alive`, съёженность в середине — как `idle-suffering`. Референс приложить: `idle-alive.png` и `idle-suffering.png`.

- 2,0 с, 24 кадра, луп.
- Кадр 1 и кадр 24: сидение как `idle-alive`, не съёженная поза.
- В середине съёживается: брови домиком, взгляд вниз, грустный рот, чуть более тяжёлая посадка, затем расправляется обратно в позу покоя. Не начинать уже съёженным.
- Без слёз, без онигири, без льда.
- Фон прозрачный.

### 4.4. `feed` — кормить

Кнопка «Кормить». Поза покоя — `idle-alive`, еда в середине — как `act-feed`. Референс приложить: `idle-alive.png` и `act-feed.png`.

- 2,0 с, 24 кадра, луп.
- Кадр 1 и кадр 24: руки на коленях, без онигири, как `idle-alive`.
- В середине обе варежки подносят онигири ко рту. Два жевка: рот чуть смыкается и снова открывается в улыбку, глаза закрыты дугами. Затем онигири уходит из кадра, руки возвращаются на колени. Не начинать уже с едой у рта.
- Рис белый, нори тёмно-зелёная. Без тарелки, без палочек, без текста.
- Фон прозрачный.

### 4.5. `play` — развлечь

Кнопка «Развлечь». Поза покоя — `idle-alive`, танец в середине — как `act-play`, шар — `disco-ball`. Референс приложить: `idle-alive.png`, `act-play.png` и `disco-ball.png`.

- 2,0 с, 24 кадра, луп.
- Кадр 1 и кадр 24: сидение как `idle-alive`, ноги спрятаны, руки на коленях, без шара.
- В середине танец на месте: одна рука вверх, одна нога поднята, корпус мягко качается влево-вправо, глаза открыты, затем возврат в ту же посадку. Не начинать уже в танце.
- На время танца над головой тот же акварельный зеркальный шар, медленно поворачивается и к последнему кадру исчезает. Без лазеров, без толпы, без текста.
- Фон прозрачный.

### 4.6. `wave` — жест рукой

Жест, которым Моти машет, в том числе когда его возвращают из крио. Поза покоя — `idle-alive`, взмах в середине — как `life-wave`. Референс приложить: `idle-alive.png` и `life-wave.png`.

- 1,5 с, 18 кадров, луп.
- Кадр 1 и кадр 18: обе руки на коленях, как `idle-alive`. Не начинать уже с поднятой рукой.
- В середине одна рука поднимается в волне и опускается обратно на колено. Вторая рука остаётся на колене. Глаза открыты, тихая улыбка.
- Без чемодана и без льда.
- Фон прозрачный.

Не рисовать отдельным роликом крио, выпускной, прогулку по комнате и длинный сюжет. Этого пакета достаточно.

## 5. Иконки подписки Tribute

Две квадратные обложки. Один и тот же Моти, лицо крупное, читается в кружке около 64 px. Подписи на картинке только короткие, как на кнопках баннера: **«Месяц»** и **«Год»**.

Референс обеих иконок: приложить `idle-alive.png`. Кадрирование как у аватара: сидит лицом, лицо крупное, внутри центрального круга.

На пейволе кнопки длиннее: «Купить на месяц» и «Купить на год». Эти фразы на иконку не писать. Цен не писать. Слова Tribute, логотипа Tribute и адреса оплаты не ставить.

Месяц — продукт **YOUR_MONTHLY_PRODUCT**. Год — продукт **YOUR_YEARLY_PRODUCT**. Это только имена файлов и подписи, не цены.

| | Месяц | Год |
| --- | --- | --- |
| Файл | `moti-tribute-month.png` | `moti-tribute-year.png` |
| Референс | `idle-alive.png`, кадрирование как у аватара | `idle-alive.png`, кадрирование как у аватара |
| Размер | 1024×1024 PNG | 1024×1024 PNG |
| Моти | Сидит лицом, глаза открыты, тихая улыбка, как аватар | Тот же Моти, та же размерность |
| Знак | Один маленький бледный полумесяц над головой | Один маленький тёплый солнечный диск над головой, без лучей-логотипа |
| Подпись | «Месяц», крупно, внизу | «Год», крупно, внизу |
| Буквы | Кириллица, тёмный тил `#2A4A4A`, простая округлая гротескная | То же |
| Фон | Бумага `#F7F3EA` с лёгким мятным пятном | Та же бумага, пятно чуть теплее, Моти того же цвета |
| Без | Цен, валют, «30», «365», календаря с сеткой, слова Tribute | Того же |

## 6. Промпты

Копировать целиком. Английский текст — для модели. Style lock повторён в каждом. Первая строка называет PNG: этот файл приложить к генерации вместе с текстом.

### Аватар — `moti-avatar.png`

```text
Reference image: idle-alive.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design.
Square 1024x1024 profile picture of Moti, a children's-book watercolor character. Same character: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers, no teeth. Pale mint-aqua body, core #C7E2E0, teal shadows #70C0C0, cool white highlights. Soft wet watercolor edges, paper grain, no black ink outline. Large round eyes, dark brown pupils #271F28, one white catchlight each, peach blush. Short mitten arms. Sitting front-facing, both hands resting on the lap, feet hidden in the round base, eyes looking straight into the camera, small gentle smile. Character large and centered, top of the head about 8% from the top, base about 8% from the bottom, face inside the central circle. Background is a soft paper wash from cream #F7F3EA to pale mint #E5F3F0, not a room, not black, not transparent. No text, no coins, no food, no disco ball, no suitcase, no ice, no watermark, no second character. Not 3D, not anime, not Pixar, not a cat.
```

### Луп idle — `moti-loop-idle`

```text
Reference image: idle-alive.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design.
Seamless 2 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Moti sitting still and breathing, one interchangeable clip: rest pose, then the breath, then the same rest pose. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers, no teeth. Pale mint-aqua watercolor body, core #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Large round eyes, dark brown pupils #271F28, white catchlights, faint peach blush. Short mitten hands rest on the lap. Feet stay hidden. One slow breathe in the middle, body slightly squashes and returns, one blink in the middle, eyes open again at the end, settled back into the rest pose. Centered, bottom-anchored, padding like a 256 sprite. No room, no text, no props. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character.
```

### Луп coins — `moti-loop-coins`

```text
Reference image: idle-happy.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Also attach idle-alive.png.
Seamless 2 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Moti joy when coins arrive, one interchangeable clip: rest pose, then one hop, then the same rest pose. Do not start already mid-jump. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers, no teeth row. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Rest pose: sitting front view, open eyes, small smile, both mitten hands on the lap, feet hidden. In the middle only, one small joy hop with closed happy crescent eyes, wide simple coral smile, stronger peach blush #D67B7A, both mitten arms up, one small foot kicked out, then land back in the exact rest pose. Two or three tiny flat gold coin discs float up during the hop and are gone before the last frame. No numbers, no plus sign, no text. Centered, bottom-anchored. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character.
```

### Луп sad — `moti-loop-sad`

```text
Reference image: idle-suffering.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Also attach idle-alive.png.
Seamless 2 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Sad hungry Moti, one interchangeable clip: rest pose, then a slump, then the same rest pose. Do not start already slumped. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Rest pose: sitting front view, open eyes, small smile, mitten hands on the lap, feet hidden. In the middle only, slump with sad angled brows, glossy eyes looking down, small frown, peach blush, a slow heavier breath, then sit back up into the exact rest pose. No tears, no food, no ice, no text. Centered, bottom-anchored. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character.
```

### Луп feed — `moti-loop-feed`

```text
Reference image: act-feed.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Also attach idle-alive.png.
Seamless 2 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Moti eating, one interchangeable clip: rest pose, then the bite, then the same rest pose. Do not start already eating. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers, no teeth row. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Rest pose: sitting front view, open eyes, small smile, both mitten hands on the lap, no food, feet hidden. In the middle only, both mitten hands bring one onigiri to the mouth, closed happy eyes, peach blush, rice white, nori a dark green-black strip #131F1A. Two small chews, mouth closes a little and opens back into a smile, then the onigiri leaves and the hands return to the lap in the exact rest pose. No plate, no chopsticks, no text. Centered, bottom-anchored. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character.
```

### Луп play — `moti-loop-play`

```text
Reference image: act-play.png, disco-ball.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Also attach idle-alive.png.
Seamless 2 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Moti dancing, one interchangeable clip: rest pose, then the dance, then the same rest pose. Do not start already mid-dance. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers, no teeth row. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Rest pose: sitting front view, open eyes, small smile, both mitten hands on the lap, feet hidden, no disco ball. In the middle only, one mitten arm raised, one small foot lifted, open smile, peach blush, a gentle side-to-side dance, then sit back into the exact rest pose. During the dance only, one watercolor mirrored disco ball above the head, silver and lilac squares, slowly turning, gone before the last frame, no chain, no lasers, no crowd, no text. Centered, bottom-anchored. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character or the ball.
```

### Луп wave — `moti-loop-wave`

```text
Reference image: life-wave.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Also attach idle-alive.png.
Seamless 1.5 second loop, 12 fps, 512x512, transparent background. The app plays this at 256x256. First frame and last frame are identical to the reference idle-alive.png. Moti waving while seated, one interchangeable clip: rest pose, then one wave, then the same rest pose. Do not start with the hand already raised. Same character every frame: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Rest pose: sitting front view, open eyes looking forward, small smile, faint peach blush, both mitten hands on the lap, feet hidden. In the middle only, one mitten arm rises in a wave and lowers back onto the knee; the other hand stays on the knee. No suitcase, no ice, no text. Centered, bottom-anchored. Not 3D, not anime, not Pixar. If transparency is impossible, flat chroma key #FF00FF and no magenta on the character.
```

### Иконка «Месяц» — `moti-tribute-month.png`

```text
Reference image: idle-alive.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Framing matches the avatar: large front-facing sit, face inside the central circle.
Square 1024x1024 subscription cover icon. Same Moti: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Large round eyes, dark brown pupils #271F28, white catchlights, peach blush, sitting front-facing, small smile, hands in lap. Face large enough to read at 64 pixels. One small pale crescent moon above the head, simple, not a logo. Large Cyrillic label at the bottom reading exactly Месяц in dark teal #2A4A4A, rounded sans. Background soft paper #F7F3EA with a light mint wash. No price, no numbers, no currency, no word Tribute, no wordmark, no watermark. Not 3D, not anime, not Pixar.
```

### Иконка «Год» — `moti-tribute-year.png`

```text
Reference image: idle-alive.png. Match this exact character, palette, watercolor edge, and proportions. Do not invent a new design. Framing matches the avatar: large front-facing sit, face inside the central circle.
Square 1024x1024 subscription cover icon. Same Moti as the month icon: one egg-shaped blob, wider at the base, no ears, no hair, no nose, no clothes, no tail, no fingers. Pale mint-aqua watercolor body #C7E2E0, teal shadows #70C0C0, cool white highlights, soft wet edges, paper grain, no black outline. Large round eyes, dark brown pupils #271F28, white catchlights, peach blush, sitting front-facing, small smile, hands in lap, same scale as the month icon. Face large enough to read at 64 pixels. One small warm sun disc above the head, simple, no logo rays. Large Cyrillic label at the bottom reading exactly Год in dark teal #2A4A4A, rounded sans. Background soft paper #F7F3EA with a slightly warmer wash. Moti's body color stays mint, not gold. No price, no numbers, no 365, no currency, no word Tribute, no wordmark, no watermark. Not 3D, not anime, not Pixar.
```

## 7. Что сдать

Папка файлов, без правок в репозитории.

| Файл | Формат |
| --- | --- |
| `moti-avatar.png` | PNG 1024×1024 |
| `moti-tribute-month.png` | PNG 1024×1024, на картинке только «Месяц» |
| `moti-tribute-year.png` | PNG 1024×1024, на картинке только «Год» |
| `moti-loop-idle/01.png` … `24.png` | PNG 512×512, альфа. Кадр 01 и кадр 24 совпадают с `idle-alive.png`. В приложении играется 256×256 |
| `moti-loop-coins/01.png` … `24.png` | то же: кадр 01 и кадр 24 = поза покоя `idle-alive`, прыжок только в середине |
| `moti-loop-sad/01.png` … `24.png` | то же: кадр 01 и кадр 24 = поза покоя `idle-alive`, съёженность только в середине |
| `moti-loop-feed/01.png` … `24.png` | то же: кадр 01 и кадр 24 = поза покоя `idle-alive`, онигири только в середине |
| `moti-loop-play/01.png` … `24.png` | то же: кадр 01 и кадр 24 = поза покоя `idle-alive`, танец и шар только в середине |
| `moti-loop-wave/01.png` … `18.png` | PNG 512×512, альфа. Кадр 01 и кадр 18 совпадают с `idle-alive.png`, взмах только в середине |

Если модель отдаёт только ролик, приложить mp4 и PNG первого кадра. Предпочтение — последовательность PNG. Хромакей `#FF00FF` допустим только вместо альфы и не должен остаться на персонаже. Комнату, цены и слово Tribute не сдавать.
