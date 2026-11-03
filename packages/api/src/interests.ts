import { dictionary } from "./dictionary.js";
import type { DictTheme } from "./types.js";

/** Interest taxonomy from interests_catalog_15_categories.json. Titles stay in Russian. */
export interface InterestTag {
  slug: string;
  nameRu: string;
}

export interface InterestCategory {
  id: string;
  nameRu: string;
  nameEn: string;
  tags: InterestTag[];
}

export const INTERESTS: InterestCategory[] = [
  {
    id: "arts",
    nameRu: "Творчество и искусство",
    nameEn: "Arts & Creativity",
    tags: [
      { slug: "art", nameRu: "Изобразительное искусство / Рисование" },
      { slug: "photography", nameRu: "Фотография" },
      { slug: "handicraft", nameRu: "Рукоделие / Хендмейд" },
      { slug: "music", nameRu: "Музыка" },
      { slug: "writing", nameRu: "Писательство / Блогинг" },
      { slug: "design", nameRu: "Дизайн" },
      { slug: "theater", nameRu: "Театр и актерское мастерство" },
      { slug: "hand_made", nameRu: "Поделки и ремесла" },
    ],
  },
  {
    id: "sports",
    nameRu: "Спорт и активный отдых",
    nameEn: "Sports & Outdoors",
    tags: [
      { slug: "fitness", nameRu: "Фитнес и тренажерный зал" },
      { slug: "running", nameRu: "Бег" },
      { slug: "yoga", nameRu: "Йога и пилатес" },
      { slug: "football", nameRu: "Футбол" },
      { slug: "basketball", nameRu: "Баскетбол" },
      { slug: "swimming", nameRu: "Плавание" },
      { slug: "martial_arts", nameRu: "Единоборства" },
      { slug: "cycling", nameRu: "Велоспорт" },
      { slug: "extreme_sports", nameRu: "Экстремальные виды спорта" },
      { slug: "hiking", nameRu: "Туризм и походы" },
      { slug: "climbing", nameRu: "Скалолазание" },
    ],
  },
  {
    id: "intellectual",
    nameRu: "Интеллектуальные увлечения и саморазвитие",
    nameEn: "Intellectual & Self-Development",
    tags: [
      { slug: "reading", nameRu: "Чтение и литература" },
      { slug: "languages", nameRu: "Изучение языков" },
      { slug: "psychology", nameRu: "Психология" },
      { slug: "science", nameRu: "Наука и научно-популярный контент" },
      { slug: "history", nameRu: "История" },
      { slug: "philosophy", nameRu: "Философия" },
      { slug: "chess", nameRu: "Шахматы и логические игры" },
      { slug: "finance", nameRu: "Инвестиции и личные финансы" },
    ],
  },
  {
    id: "tech",
    nameRu: "Технологии и гаджеты",
    nameEn: "Technology & Gaming",
    tags: [
      { slug: "programming", nameRu: "Программирование и IT" },
      { slug: "gaming", nameRu: "Видеоигры" },
      { slug: "gadgets", nameRu: "Гаджеты и железо" },
      { slug: "ai_and_tech", nameRu: "Искусственный интеллект и технологии" },
      { slug: "robotics", nameRu: "Робототехника" },
      { slug: "crypto", nameRu: "Криптовалюта и Web3" },
    ],
  },
  {
    id: "entertainment",
    nameRu: "Досуг, развлечения и медиа",
    nameEn: "Entertainment & Media",
    tags: [
      { slug: "movies", nameRu: "Кино и сериалы" },
      { slug: "anime", nameRu: "Аниме и манга" },
      { slug: "board_games", nameRu: "Настольные игры" },
      { slug: "podcasts", nameRu: "Подкасты и аудиокниги" },
      { slug: "concerts", nameRu: "Концерты и фестивали" },
      { slug: "stand_up", nameRu: "Стендап и юмор" },
    ],
  },
  {
    id: "travel",
    nameRu: "Путешествия и культура",
    nameEn: "Travel & Culture",
    tags: [
      { slug: "traveling", nameRu: "Путешествия" },
      { slug: "culture", nameRu: "Мировые культуры" },
      { slug: "architecture", nameRu: "Архитектура" },
      { slug: "museums", nameRu: "Музеи и выставки" },
      { slug: "volunteering", nameRu: "Волонтерство и благотворительность" },
    ],
  },
  {
    id: "lifestyle",
    nameRu: "Дом, еда и лайфстайл",
    nameEn: "Lifestyle & Food",
    tags: [
      { slug: "cooking", nameRu: "Кулинария и выпечка" },
      { slug: "gardening", nameRu: "Садоводство и комнатные растения" },
      { slug: "pets", nameRu: "Домашние животные (зоохобби)" },
      { slug: "fashion", nameRu: "Мода и стиль" },
      { slug: "interior_design", nameRu: "Дизайн интерьера" },
      { slug: "coffee_and_tea", nameRu: "Кофейная или чайная культура (гастрономия)" },
    ],
  },
  {
    id: "collecting",
    nameRu: "Коллекционирование и собирательство",
    nameEn: "Collecting & Hobbies",
    tags: [
      { slug: "numismatics", nameRu: "Нумизматика и монеты" },
      { slug: "philately", nameRu: "Филателия и марки" },
      { slug: "vinyl_records", nameRu: "Коллекционирование винила" },
      { slug: "antiques", nameRu: "Антиквариат и винтаж" },
      { slug: "board_game_collecting", nameRu: "Коллекционирование настольных игр" },
      { slug: "action_figures", nameRu: "Коллекционирование фигурок и мерча" },
      { slug: "mineralogy", nameRu: "Коллекционирование минералов и камней" },
    ],
  },
  {
    id: "automotive",
    nameRu: "Автомобили и техника",
    nameEn: "Automotive & Mechanics",
    tags: [
      { slug: "cars", nameRu: "Автомобили и тюнинг" },
      { slug: "motorcycles", nameRu: "Мотоциклы и байки" },
      { slug: "sim_racing", nameRu: "Симрейсинг и автосимуляторы" },
      { slug: "rc_models", nameRu: "Радиоуправляемые модели" },
      { slug: "mechanics", nameRu: "Ремонт и механика своими руками" },
      { slug: "aviation", nameRu: "Авиация и споттинг" },
    ],
  },
  {
    id: "tabletop",
    nameRu: "Настольные и ролевые игры",
    nameEn: "Tabletop & RPG",
    tags: [
      { slug: "dnd", nameRu: "Настольные ролевые игры (D&D)" },
      { slug: "tcg", nameRu: "Коллекционные карточные игры (MTG, Pokemon)" },
      { slug: "wargaming", nameRu: "Варгеймы и покраска миниатюр" },
      { slug: "puzzles", nameRu: "Пазлы и головоломки" },
      { slug: "trivia", nameRu: "Квизы и интеллектуальные игры" },
    ],
  },
  {
    id: "outdoor_survival",
    nameRu: "Активный туризм и выживание",
    nameEn: "Outdoor & Survival",
    tags: [
      { slug: "camping", nameRu: "Кемпинг и бушкрафт" },
      { slug: "fishing", nameRu: "Рыбалка" },
      { slug: "hunting", nameRu: "Охота" },
      { slug: "geocaching", nameRu: "Геокешинг" },
      { slug: "metal_detecting", nameRu: "Приборный поиск" },
      { slug: "survivalism", nameRu: "Выживание и автономия" },
    ],
  },
  {
    id: "spirituality",
    nameRu: "Духовные практики и эзотерика",
    nameEn: "Spirituality & Mindfulness",
    tags: [
      { slug: "meditation", nameRu: "Медитация и осознанность" },
      { slug: "astrology", nameRu: "Астрология и натальные карты" },
      { slug: "tarot", nameRu: "Таро и мантические практики" },
      { slug: "esotericism", nameRu: "Эзотерика и философия New Age" },
      { slug: "lucid_dreams", nameRu: "Осознанные сновидения" },
    ],
  },
  {
    id: "business",
    nameRu: "Бизнес, предпринимательство и стартапы",
    nameEn: "Business & Startups",
    tags: [
      { slug: "entrepreneurship", nameRu: "Предпринимательство и свой бизнес" },
      { slug: "startups", nameRu: "Стартапы и венчурные инвестиции" },
      { slug: "project_management", nameRu: "Управление проектами и Agile" },
      { slug: "marketing", nameRu: "Маркетинг и SMM" },
      { slug: "sales", nameRu: "Продажи и переговоры" },
      { slug: "ecommerce", nameRu: "Электронная коммерция и маркетплейсы" },
      { slug: "business_analytics", nameRu: "Бизнес-аналитика и BI" },
    ],
  },
  {
    id: "career",
    nameRu: "Карьера, найм и профессиональный рост",
    nameEn: "Career & Professional Growth",
    tags: [
      { slug: "career_growth", nameRu: "Карьерный рост и менторство" },
      { slug: "hr_and_recruiting", nameRu: "HR, рекрутинг и хедхантинг" },
      { slug: "remote_work", nameRu: "Удаленная работа и фриланс" },
      { slug: "public_speaking", nameRu: "Ораторское искусство и риторика" },
      { slug: "personal_branding", nameRu: "Личный бренд и нетворкинг" },
      { slug: "productivity", nameRu: "Тайм-менеджмент и личная продуктивность" },
    ],
  },
  {
    id: "social",
    nameRu: "Социальное взаимодействие, волонтерство и комьюнити",
    nameEn: "Social & Community",
    tags: [
      { slug: "networking", nameRu: "Деловые и профессиональные знакомства" },
      { slug: "charity", nameRu: "Благотворительность и фонды" },
      { slug: "community_building", nameRu: "Создание и развитие комьюнити" },
      { slug: "social_activism", nameRu: "Общественная деятельность и активизм" },
      { slug: "mentorship", nameRu: "Наставничество и преподавание" },
      { slug: "event_management", nameRu: "Организация мероприятий и событий" },
    ],
  },
];

export const INTEREST_OTHER_ID = "interest-other";
export const INTEREST_OTHER_TITLE = "Прочее";
export const CATEGORY_WORD_LIMIT = 1000;

const TAGS = new Map<string, { en: string[]; ru: string[] }>();

function tag(categoryId: string, slug: string, en: string[], ru: string[]): void {
  TAGS.set(`${categoryId}/${slug}`, { en, ru });
}

tag("arts", "art", ["art", "paint", "draw", "sketch", "canvas", "brush", "gallery", "sculpture", "portrait", "mural", "palette", "easel", "illustration", "watercolor", "oil", "acrylic"], ["рисун", "живопис", "картин", "холст", "кисть", "галере", "скульптур", "портрет", "палитр", "акварел", "иллюстрац"]);
tag("arts", "photography", ["photo", "photograph", "camera", "lens", "snapshot", "exposure", "aperture", "shutter", "portraiture"], ["фото", "камер", "объектив", "снимок", "экспозиц", "диафрагм"]);
tag("arts", "handicraft", ["knit", "sew", "sewing", "embroidery", "crochet", "yarn", "needle", "stitch", "handmade", "craft"], ["вязан", "шить", "швейн", "вышив", "крючк", "пряж", "рукодел", "стежок"]);
tag("arts", "music", ["music", "song", "sing", "guitar", "piano", "drum", "melody", "rhythm", "lyric", "orchestra", "violin", "bass", "chord", "album", "band", "concert", "symphony", "opera", "jazz", "melody", "tune", "choir", "composer"], ["музык", "песн", "петь", "гитар", "пианино", "барабан", "мелодия", "ритм", "оркестр", "скрипка", "аккорд", "альбом", "хор", "композитор", "симфон"]);
tag("arts", "writing", ["write", "writer", "poem", "poetry", "novel", "blog", "author", "manuscript", "essay", "prose", "storyteller", "pen"], ["писат", "писател", "стих", "поэм", "роман", "блог", "автор", "рукопис", "эссе", "проза", "перо"]);
tag("arts", "design", ["design", "designer", "layout", "typography", "logo", "graphic", "font", "poster"], ["дизайн", "макет", "типограф", "логотип", "шрифт", "графическ"]);
tag("arts", "theater", ["theater", "theatre", "actor", "actress", "stage", "drama", "rehearsal", "script", "playwright", "curtain", "audience", "role", "scene", "audition", "costume"], ["театр", "актер", "актрис", "сцен", "драм", "репетиц", "сценарий", "пьес", "занавес", "роль", "костюм", "аудиенц"]);
tag("arts", "hand_made", ["pottery", "ceramic", "woodwork", "carve", "craft", "handmade", "workshop", "artisan", "clay"], ["гончарн", "керамик", "резьб", "ремесл", "поделк", "мастерск", "глина", "глинян"]);

tag("sports", "fitness", ["fitness", "gym", "workout", "muscle", "dumbbell", "barbell", "squat", "trainer", "exercise", "athlete", "coach", "training", "sport", "medal", "championship", "league", "tournament", "score", "team", "stadium"], ["фитнес", "тренажер", "трениров", "мышц", "гантел", "штанга", "тренер", "спорт", "медал", "чемпионат", "турнир", "стадион", "команд"]);
tag("sports", "running", ["run", "runner", "jog", "sprint", "marathon", "track"], ["бег", "бегун", "пробежк", "спринт", "марафон"]);
tag("sports", "yoga", ["yoga", "pilates", "stretch", "pose", "asana"], ["йога", "пилатес", "растяжк", "асана"]);
tag("sports", "football", ["football", "soccer", "goal", "goalkeeper", "striker", "offside", "penalty"], ["футбол", "вратар", "офсайд", "пенальти", "гол"]);
tag("sports", "basketball", ["basketball", "hoop", "dribble", "slam"], ["баскетбол", "кольцо", "дриблинг"]);
tag("sports", "swimming", ["swim", "swimmer", "pool", "dive", "stroke", "lane"], ["плаван", "бассейн", "ныря", "водн"]);
tag("sports", "martial_arts", ["martial", "boxing", "boxer", "karate", "judo", "wrestling", "fighter", "punch", "kick", "dojo", "belt"], ["единобор", "бокс", "каратэ", "дзюдо", "борьб", "боец", "удар", "додзё"]);
tag("sports", "cycling", ["cycling", "cyclist", "bicycle", "bike", "pedal"], ["велосипед", "велогон", "педаль"]);
tag("sports", "extreme_sports", ["skateboard", "snowboard", "surf", "parachute", "bungee", "extreme"], ["скейт", "сноуборд", "серф", "парашют", "экстрим"]);
tag("sports", "hiking", ["hike", "hiking", "trail", "backpack", "trek"], ["поход", "тропа", "рюкзак", "треккинг"]);
tag("sports", "climbing", ["climb", "climbing", "boulder", "crag", "harness", "rope"], ["скалолаз", "восхожден", "страховк"]);

tag("intellectual", "reading", ["read", "book", "novel", "library", "literature", "chapter", "page", "author", "fiction", "bookshelf"], ["книг", "читат", "библиотек", "литератур", "глава", "страниц", "автор", "роман"]);
tag("intellectual", "languages", ["language", "grammar", "vocabulary", "translate", "translation", "dialect", "pronunciation", "linguist", "word", "phrase", "sentence", "meaning", "synonym", "idiom", "slang", "accent", "alphabet", "spelling", "dictionary", "lemma", "verb", "noun", "adjective", "adverb", "tense", "plural"], ["язык", "граммат", "словар", "перевод", "диалект", "произношен", "слово", "фраз", "предложен", "значен", "синоним", "идиом", "сленг", "акцент", "алфавит", "орфограф", "глагол", "существительн", "прилагательн", "нареч"]);
tag("intellectual", "psychology", ["psychology", "mind", "emotion", "feeling", "anxiety", "therapy", "therapist", "memory", "dream", "behavior", "behaviour", "personality", "trauma", "conscious", "subconscious", "mood", "mental", "soul", "fear", "anger", "grief", "hope", "love", "hate", "jealous", "guilt", "shame", "pride", "lonely", "sad", "happy", "nervous"], ["психолог", "ум", "эмоц", "чувств", "тревог", "терап", "памят", "поведен", "личност", "травм", "сознан", "настроен", "страх", "гнев", "горе", "надежд", "любов", "ненавист", "вин", "стыд", "гордост", "одинок", "груст", "счаст", "нерв"]);
tag("intellectual", "science", ["science", "scientist", "experiment", "theory", "atom", "molecule", "physics", "chemistry", "biology", "laboratory", "lab", "research", "hypothesis", "data", "formula", "energy", "gravity", "planet", "star", "space", "universe", "cell", "gene", "virus", "bacteria", "evolution", "math", "mathematics", "equation", "number", "percent", "ratio", "angle", "circle", "triangle"], ["наук", "учены", "эксперимент", "теори", "атом", "молекул", "физик", "хими", "биолог", "лаборатор", "исследован", "гипотез", "формул", "энерг", "гравитац", "планет", "звезд", "космос", "вселенн", "клетк", "ген", "вирус", "бактер", "эволюц", "математ", "уравнен", "процент", "угол"]);
tag("intellectual", "history", ["history", "historical", "ancient", "century", "empire", "king", "queen", "war", "battle", "medieval", "dynasty", "revolution", "archive", "museum", "artifact", "legend", "myth", "castle", "knight", "sword", "armor", "armour", "throne", "kingdom", "prince", "princess"], ["истори", "древн", "век", "импери", "корол", "войн", "битв", "средневек", "династ", "революц", "архив", "легенд", "миф", "замок", "рыцар", "меч", "доспех", "трон", "королев", "принц", "принцесс"]);
tag("intellectual", "philosophy", ["philosophy", "philosopher", "ethic", "logic", "truth", "existence", "meaning", "moral", "virtue", "wisdom", "idea", "concept", "principle", "reason", "argument", "belief", "doubt", "reality", "abstract", "essence", "paradox"], ["философ", "этик", "логик", "истин", "существ", "смысл", "морал", "добродетел", "мудрост", "идея", "понят", "принцип", "разум", "аргумент", "вер", "сомнен", "реальност", "сущност", "парадокс"]);
tag("intellectual", "chess", ["chess", "checkmate", "pawn", "bishop", "knight", "rook", "queen", "strategy", "puzzle", "riddle", "logic"], ["шахмат", "мат", "пешк", "слон", "ладья", "стратег", "головолом", "загадк"]);
tag("intellectual", "finance", ["invest", "investment", "stock", "bond", "dividend", "portfolio", "budget", "savings", "interest", "loan", "debt", "tax", "salary", "wage", "money", "coin", "bank", "profit", "loss", "price", "cost", "expensive", "cheap", "rich", "poor", "wealth", "fortune", "payment", "invoice", "account"], ["инвест", "акци", "облигац", "дивиденд", "портфел", "бюджет", "сбережен", "процент", "кредит", "долг", "налог", "зарплат", "деньг", "монет", "банк", "прибыл", "убыт", "цен", "стоимость", "богат", "бедн", "состоян", "платеж", "счет"]);

tag("tech", "programming", ["code", "coding", "program", "software", "developer", "algorithm", "database", "server", "bug", "debug", "api", "script", "function", "variable", "computer", "laptop", "keyboard", "internet", "website", "browser", "email", "password", "hack", "hacker", "digital", "online", "cyber", "network", "wifi", "data"], ["код", "программ", "софт", "разработ", "алгоритм", "сервер", "баг", "компьютер", "ноутбук", "клавиатур", "интернет", "сайт", "браузер", "парол", "хакер", "цифров", "сеть", "данн"]);
tag("tech", "gaming", ["game", "gaming", "gamer", "videogame", "console", "joystick", "quest", "level", "boss", "player", "avatar", "pixel", "arcade", "nintendo", "playstation", "xbox"], ["видеоигр", "геймер", "консол", "джойстик", "квест", "уровень", "босс", "игрок", "аватар", "пиксель", "аркад"]);
tag("tech", "gadgets", ["gadget", "device", "phone", "smartphone", "tablet", "headphone", "speaker", "battery", "charger", "screen", "display", "processor", "chip", "hardware", "cable", "usb", "bluetooth"], ["гаджет", "устройств", "телефон", "смартфон", "планшет", "наушник", "колонк", "батаре", "зарядк", "экран", "процессор", "чип", "кабель"]);
tag("tech", "ai_and_tech", ["ai", "robot", "artificial", "intelligence", "neural", "machine", "automation", "technology", "tech", "innovation", "silicon", "laser", "satellite", "radar"], ["искусственн", "интеллект", "нейрон", "автоматизац", "технолог", "инновац", "лазер", "спутник", "радар"]);
tag("tech", "robotics", ["robot", "robotic", "drone", "android", "cyborg", "sensor", "motor"], ["робот", "дрон", "андроид", "киборг", "сенсор", "мотор"]);
tag("tech", "crypto", ["crypto", "bitcoin", "blockchain", "token", "nft", "wallet", "ethereum", "coin"], ["крипт", "биткоин", "блокчейн", "токен", "кошелек"]);

tag("entertainment", "movies", ["movie", "film", "cinema", "actor", "actress", "director", "scene", "episode", "series", "season", "screen", "hollywood", "oscar", "trailer", "plot", "character", "villain", "hero", "monster", "zombie", "vampire", "alien", "spaceship", "superhero", "comic", "cartoon", "animation"], ["кино", "фильм", "сериал", "эпизод", "сезон", "режиссер", "сюжет", "персонаж", "злодей", "герой", "монстр", "зомби", "вампир", "инопланетян", "супергеро", "мультик", "анимац"]);
tag("entertainment", "anime", ["anime", "manga", "otaku", "cosplay"], ["аниме", "манга", "косплей"]);
tag("entertainment", "board_games", ["board", "dice", "pawn", "monopoly"], ["настольн", "кубик", "кости"]);
tag("entertainment", "podcasts", ["podcast", "audiobook", "radio", "broadcast", "microphone"], ["подкаст", "аудиокниг", "радио", "микрофон", "эфир"]);
tag("entertainment", "concerts", ["concert", "festival", "ticket", "crowd", "stage", "tour"], ["концерт", "фестивал", "билет", "толпа", "тур"]);
tag("entertainment", "stand_up", ["joke", "comedy", "comedian", "humor", "humour", "funny", "laugh", "laughing", "sarcasm", "irony", "punchline"], ["шутк", "юмор", "комеди", "смех", "смешн", "сарказм", "ирон"]);

tag("travel", "traveling", ["travel", "trip", "tour", "tourist", "journey", "flight", "airport", "passport", "visa", "hotel", "luggage", "suitcase", "map", "abroad", "vacation", "holiday", "island", "beach", "mountain", "city", "country", "border", "train", "station", "ticket"], ["путешеств", "поездк", "тур", "турист", "рейс", "аэропорт", "паспорт", "виза", "отель", "багаж", "чемодан", "карта", "отпуск", "остров", "пляж", "гор", "город", "стран", "границ", "вокзал", "билет"]);
tag("travel", "culture", ["culture", "cultural", "tradition", "custom", "festival", "folk", "nation", "language", "religion", "temple", "ritual"], ["культур", "традиц", "обычай", "народ", "наци", "религи", "храм", "ритуал"]);
tag("travel", "architecture", ["architecture", "architect", "building", "cathedral", "tower", "bridge", "dome", "column", "facade", "palace", "monument"], ["архитектур", "здани", "собор", "башн", "мост", "купол", "колонн", "фасад", "дворец", "памятник"]);
tag("travel", "museums", ["museum", "exhibit", "exhibition", "gallery", "artifact", "collection"], ["музей", "выставк", "экспонат", "экспозиц"]);
tag("travel", "volunteering", ["volunteer", "charity", "donate", "donation", "aid", "help"], ["волонтер", "благотвор", "пожертвован", "помощь"]);

tag("lifestyle", "cooking", ["cook", "cooking", "recipe", "bake", "baking", "kitchen", "oven", "ingredient", "meal", "dish", "food", "eat", "dinner", "lunch", "breakfast", "restaurant", "chef", "flavor", "flavour", "taste", "spicy", "sweet", "sour", "salt", "sugar", "bread", "meat", "vegetable", "fruit", "soup", "sauce", "wine", "beer"], ["готов", "рецепт", "выпечк", "кухн", "духовк", "ингредиент", "блюд", "еда", "ужин", "обед", "завтрак", "ресторан", "повар", "вкус", "сладк", "сол", "сахар", "хлеб", "мясо", "овощ", "фрукт", "суп", "соус", "вино", "пиво"]);
tag("lifestyle", "gardening", ["garden", "plant", "flower", "soil", "seed", "leaf", "tree", "grow", "harvest", "pot"], ["сад", "растен", "цвет", "почв", "семен", "лист", "дерев", "урожай", "горшок"]);
tag("lifestyle", "pets", ["pet", "dog", "cat", "puppy", "kitten", "animal", "horse", "bird", "fish", "paw", "fur", "leash", "kennel", "vet"], ["питомец", "собак", "кошк", "щенок", "котенок", "животн", "лошад", "птиц", "лапа", "шерст", "поводок", "ветеринар"]);
tag("lifestyle", "fashion", ["fashion", "style", "clothes", "dress", "shirt", "suit", "shoe", "hat", "jacket", "fabric", "silk", "cotton", "wear", "outfit", "model", "runway"], ["мода", "стиль", "одежд", "платье", "рубашк", "костюм", "обув", "шляп", "куртк", "ткань", "шелк", "хлопок", "наряд", "модель"]);
tag("lifestyle", "interior_design", ["interior", "furniture", "sofa", "chair", "table", "lamp", "curtain", "room", "apartment", "house", "home", "door", "window", "wall", "floor", "roof", "bedroom", "kitchen", "decor"], ["интерьер", "мебел", "диван", "стул", "стол", "лампа", "штор", "комнат", "квартир", "дом", "двер", "окн", "стен", "пол", "крыш", "спальн", "декор"]);
tag("lifestyle", "coffee_and_tea", ["coffee", "tea", "cafe", "espresso", "latte", "brew", "cup", "mug"], ["кофе", "чай", "кафе", "эспрессо", "чашк", "кружк"]);

tag("collecting", "numismatics", ["coin", "numismatic", "currency"], ["монет", "нумизмат"]);
tag("collecting", "philately", ["stamp", "philately", "postage"], ["марк", "филател", "почтов"]);
tag("collecting", "vinyl_records", ["vinyl", "record", "turntable", "lp"], ["винил", "пластинк", "проигрывател"]);
tag("collecting", "antiques", ["antique", "vintage", "relic", "heirloom", "old"], ["антиквар", "винтаж", "реликви", "старин"]);
tag("collecting", "board_game_collecting", ["collection", "collect", "collector"], ["коллекц", "собирател"]);
tag("collecting", "action_figures", ["figurine", "figure", "merch", "merchandise", "toy", "doll"], ["фигурк", "мерч", "игрушк", "кукл"]);
tag("collecting", "mineralogy", ["mineral", "gem", "crystal", "stone", "diamond", "gold", "silver", "jewel", "rock"], ["минерал", "самоцвет", "кристалл", "камень", "алмаз", "золот", "серебр", "драгоцен", "скал"]);

tag("automotive", "cars", ["car", "automobile", "vehicle", "engine", "wheel", "tire", "tyre", "brake", "steering", "garage", "driver", "driving", "highway", "traffic", "truck", "bus", "taxi", "fuel", "petrol", "gasoline", "hood", "trunk"], ["автомобил", "машин", "двигател", "колес", "шин", "тормоз", "руль", "гараж", "водител", "трасс", "пробк", "грузовик", "автобус", "такси", "топлив", "бензин", "капот", "багажник"]);
tag("automotive", "motorcycles", ["motorcycle", "motorbike", "biker", "helmet"], ["мотоцикл", "байк", "шлем"]);
tag("automotive", "sim_racing", ["racing", "race", "lap", "speed", "formula"], ["гонк", "скорост", "формула"]);
tag("automotive", "rc_models", ["model", "remote", "rc"], ["радиоуправл", "модель"]);
tag("automotive", "mechanics", ["mechanic", "repair", "wrench", "screw", "bolt", "tool", "fix", "machine", "gear", "metal", "steel", "iron", "weld"], ["механик", "ремонт", "гаечн", "винт", "болт", "инструмент", "чинить", "машин", "шестерн", "металл", "сталь", "желез", "сварк"]);
tag("automotive", "aviation", ["plane", "airplane", "aircraft", "pilot", "airport", "flight", "helicopter", "jet", "aviation", "cockpit", "runway"], ["самолет", "пилот", "авиац", "вертолет", "реактивн", "кабин", "взлетн"]);

tag("tabletop", "dnd", ["dungeon", "dragon", "wizard", "spell", "magic", "sword", "quest", "dice", "rpg", "fantasy", "elf", "orc", "goblin", "potion", "scroll", "knight", "castle", "kingdom", "monster", "hero"], ["подземель", "дракон", "волшебник", "заклинан", "магия", "меч", "квест", "фэнтези", "эльф", "орк", "гоблин", "зелье", "свиток", "рыцар"]);
tag("tabletop", "tcg", ["card", "deck", "pokemon", "magic"], ["карт", "колод", "покемон"]);
tag("tabletop", "wargaming", ["miniature", "wargame", "army", "battle", "soldier", "war", "weapon", "gun", "rifle", "pistol", "bullet", "armor", "armour"], ["миниатюр", "варгейм", "арми", "битв", "солдат", "оружи", "пистолет", "винтовк", "пуля", "брон"]);
tag("tabletop", "puzzles", ["puzzle", "riddle", "maze", "jigsaw", "clue"], ["пазл", "головолом", "лабиринт", "улик"]);
tag("tabletop", "trivia", ["quiz", "trivia", "question", "answer", "guess"], ["викторин", "квиз", "вопрос", "ответ", "угад"]);

tag("outdoor_survival", "camping", ["camp", "camping", "tent", "bonfire", "campfire", "sleeping", "lantern", "flashlight", "torch", "rope", "knot", "compass", "map", "forest", "woods", "wild", "wilderness", "outdoor"], ["кемпинг", "палатк", "костер", "фонар", "факел", "веревк", "узел", "компас", "лес", "дикий", "природ"]);
tag("outdoor_survival", "fishing", ["fish", "fishing", "rod", "bait", "hook", "lake", "river", "sea", "ocean", "boat"], ["рыбалк", "удочк", "наживк", "крючок", "озеро", "река", "море", "океан", "лодк"]);
tag("outdoor_survival", "hunting", ["hunt", "hunting", "hunter", "prey", "bow", "arrow", "trap", "rifle", "deer", "wolf", "bear"], ["охот", "добыч", "лук", "стрел", "ловушк", "олень", "волк", "медвед"]);
tag("outdoor_survival", "geocaching", ["geocache", "cache", "gps", "coordinate"], ["геокеш", "координат", "тайник"]);
tag("outdoor_survival", "metal_detecting", ["detector", "metal", "treasure", "dig"], ["металлоиск", "клад", "копать"]);
tag("outdoor_survival", "survivalism", ["survive", "survival", "shelter", "fire", "knife", "blade", "danger", "rescue", "emergency", "wound", "blood", "death", "kill", "fight", "enemy", "escape", "hide", "threat", "weapon"], ["выживан", "укрыти", "огонь", "нож", "лезви", "опасн", "спасен", "рана", "кровь", "смерть", "убить", "враг", "побег", "угроз", "оружи"]);

tag("spirituality", "meditation", ["meditat", "mindful", "breathe", "breath", "calm", "peace", "silence", "aware"], ["медитац", "осознан", "дыхан", "спокойств", "тишин", "мир"]);
tag("spirituality", "astrology", ["astrology", "horoscope", "zodiac", "star", "constellation", "planet", "natal"], ["астролог", "гороскоп", "зодиак", "созвезди", "натальн"]);
tag("spirituality", "tarot", ["tarot", "fortune", "omen", "prophecy", "prophet", "vision"], ["таро", "гадан", "предзнаменован", "пророчеств", "пророк", "виден"]);
tag("spirituality", "esotericism", ["esoteric", "occult", "spirit", "ghost", "soul", "aura", "ritual", "curse", "bless", "prayer", "god", "church", "angel", "demon", "hell", "heaven", "fate", "destiny", "miracle", "sacred", "holy", "sin", "faith"], ["эзотерик", "оккульт", "дух", "призра", "душ", "аура", "ритуал", "проклят", "благослов", "молитв", "бог", "церков", "ангел", "демон", "ад", "рай", "судьб", "чудо", "свящ", "свят", "грех", "вера"]);
tag("spirituality", "lucid_dreams", ["dream", "nightmare", "sleep", "asleep"], ["сон", "кошмар", "сновиден", "спать"]);

tag("business", "entrepreneurship", ["business", "company", "entrepreneur", "founder", "startup", "office", "boss", "client", "customer", "contract", "deal", "market", "brand", "profit", "revenue", "corporate"], ["бизнес", "компани", "предпринимател", "основател", "стартап", "офис", "босс", "клиент", "заказчик", "контракт", "сделк", "рынок", "бренд", "прибыл", "выручк", "корпорац"]);
tag("business", "startups", ["startup", "venture", "investor", "pitch", "funding"], ["стартап", "венчур", "инвестор", "питч", "финансирован"]);
tag("business", "project_management", ["project", "agile", "scrum", "deadline", "sprint", "task", "plan", "schedule", "manager", "management"], ["проект", "эджайл", "agile", "срок", "спринт", "задач", "план", "расписан", "менеджер", "управлен"]);
tag("business", "marketing", ["marketing", "advert", "ad", "campaign", "brand", "promotion", "audience", "smm"], ["маркетинг", "реклам", "кампани", "бренд", "продвижен", "аудитор"]);
tag("business", "sales", ["sale", "sell", "sales", "negotiate", "negotiation", "offer", "discount", "buyer", "seller"], ["продаж", "продавать", "переговор", "предложен", "скидк", "покупател", "продавец"]);
tag("business", "ecommerce", ["shop", "store", "order", "delivery", "cart", "checkout", "marketplace", "product"], ["магазин", "заказ", "доставк", "корзин", "маркетплейс", "товар"]);
tag("business", "business_analytics", ["analytics", "metric", "kpi", "report", "dashboard", "statistic", "growth"], ["аналитик", "метрик", "отчет", "статистик", "рост"]);

tag("career", "career_growth", ["career", "promotion", "promote", "mentor", "skill", "profession", "professional", "job", "work", "colleague", "employee", "employer"], ["карьер", "повышен", "наставник", "навык", "професси", "работ", "коллег", "сотрудник", "работодател"]);
tag("career", "hr_and_recruiting", ["hire", "hiring", "recruit", "resume", "cv", "interview", "candidate", "vacancy"], ["наем", "рекру", "резюме", "собеседован", "кандидат", "ваканс"]);
tag("career", "remote_work", ["remote", "freelance", "freelancer", "homeoffice"], ["удален", "фриланс"]);
tag("career", "public_speaking", ["speech", "speak", "speaker", "rhetoric", "presentation", "lecture", "audience", "voice"], ["речь", "оратор", "риторик", "презентац", "лекци", "голос"]);
tag("career", "personal_branding", ["brand", "reputation", "network", "influence", "image"], ["репутац", "нетворк", "влиян", "имидж"]);
tag("career", "productivity", ["productivity", "deadline", "focus", "habit", "routine", "schedule", "time", "efficient", "priority"], ["продуктив", "привычк", "распорядок", "расписан", "время", "эффектив", "приоритет"]);

tag("social", "networking", ["friend", "friendship", "meet", "meeting", "introduce", "acquaintance", "party", "guest", "neighbor", "neighbour", "conversation", "talk", "chat"], ["друг", "дружб", "знаком", "встреч", "вечеринк", "гость", "сосед", "разговор", "беседова"]);
tag("social", "charity", ["charity", "donate", "foundation", "fund", "aid", "poor", "homeless"], ["благотвор", "фонд", "помощь", "бездом"]);
tag("social", "community_building", ["community", "group", "club", "member", "society", "people", "public", "social", "together", "team"], ["сообществ", "комьюнити", "клуб", "член", "обществ", "люди", "публич", "вместе", "команд"]);
tag("social", "social_activism", ["protest", "activism", "activist", "rights", "justice", "law", "court", "police", "crime", "prison", "vote", "election", "government", "politics", "politician", "freedom", "equality"], ["протест", "активист", "прав", "справедливост", "закон", "суд", "полиц", "преступлен", "тюрьм", "голос", "выбор", "правительств", "политик", "свобод", "равенств"]);
tag("social", "mentorship", ["teach", "teacher", "student", "lesson", "school", "class", "education", "learn", "study", "mentor", "pupil"], ["учител", "ученик", "урок", "школ", "класс", "образован", "учить", "учитьс", "наставник"]);
tag("social", "event_management", ["event", "party", "wedding", "ceremony", "celebration", "celebrate", "holiday", "birthday", "invite", "invitation", "festival", "organize"], ["мероприят", "свадьб", "церемони", "праздник", "деньрожден", "приглашен", "организац"]);

const LOOSE = new Map<string, { en: string[]; ru: string[] }>();

function loose(categoryId: string, slug: string, en: string[], ru: string[]): void {
  LOOSE.set(`${categoryId}/${slug}`, { en, ru });
}

loose("intellectual", "languages", ["word", "phrase", "literally", "barely", "somehow", "somebody", "anybody", "nothing", "everything", "okay", "ok", "alright", "totally", "exactly", "precisely", "obviously", "apparently", "basically", "actually", "really", "just", "maybe", "perhaps", "already", "still", "again", "always", "never", "often", "suddenly", "immediately", "finally", "simply", "merely", "quite", "rather", "almost", "enough", "instead", "although", "however", "therefore", "whether", "unless", "until", "during", "within", "without", "toward", "amongst"], ["буквальн", "едва", "еле", "как-нибудь", "кто-нибудь", "никт", "вообще", "именно", "очевидн", "явн", "постоянн", "внезапн", "намеренн", "совместн", "обязательн", "к сожалению", "точно", "спонтан", "строго", "полностью", "абсолютн", "примерно", "например", "значит", "поэтому", "однако"]);
loose("intellectual", "philosophy", ["absurd", "chaos", "nothingness", "existence", "judgment", "judgement", "interpretation", "criterion", "aspect", "attribute", "consequence", "distinction", "fallacy", "ignorance", "illusion", "impossible", "inference", "premise", "standpoint", "stance", "speculation", "symbolic", "concept", "abstract", "paradox", "reason", "logic", "truth", "meaning", "idea", "principle", "theory", "assume", "assumption", "conclude", "conclusion", "infer", "obvious", "apparent", "definite", "precise", "relative", "absolute", "possible", "necessary", "sufficient", "inherent", "essence"], ["абсурд", "хаос", "небытие", "сужден", "интерпретац", "критери", "аспект", "последств", "различ", "отлич", "заблужден", "невежеств", "иллюзи", "невозможн", "вывод", "предпосылк", "точка зрения", "размышлен", "символич", "понят", "принцип", "предположен", "заключа", "очевидн", "определен", "присущ", "сущност", "парадокс", "смысл", "идея"]);
loose("intellectual", "psychology", ["behave", "behavior", "aggressive", "distract", "charisma", "fright", "motive", "pretend", "neglect", "vibe", "struggle", "fear", "angry", "calm", "nervous", "mood", "feel", "emotion", "mind", "memory", "dream", "trauma", "stress", "panic", "shame", "guilt", "pride", "jealous", "lonely", "sad", "happy", "hope", "hate", "love"], ["агрессив", "отвлек", "харизм", "пуга", "ужас", "мотив", "притвор", "пренебрежен", "атмосфер", "вайб", "бороться", "страх", "тревог", "настроен", "чувств", "памят", "стресс", "паник", "стыд", "вин", "одинок"]);
loose("intellectual", "science", ["absorb", "aluminum", "aluminium", "trajectory", "pyramid", "hybrid", "proportion", "rotation", "sphere", "gram", "kilo", "kilometer", "liter", "litre", "pi", "weigh", "ton", "tonne", "saturate", "diagonal", "elevation", "gauge", "cipher", "decipher", "calibrate", "stable", "stability", "vibrate", "spiral", "mixture", "segment", "atom", "molecule", "energy", "gravity", "orbit", "radius", "diameter", "angle", "degree", "percent", "ratio", "formula", "experiment", "laboratory", "chemical", "metal", "steel", "iron", "rust", "cement", "dust", "foam", "powder", "liquid", "gas", "pressure", "temperature", "vacuum", "laser", "radar", "signal"], ["поглощ", "алюмини", "траектор", "пирамид", "гибрид", "пропорц", "вращен", "сфер", "грамм", "кило", "литр", "весить", "тонн", "насыщ", "диагонал", "измерен", "шифр", "калибр", "стабильн", "вибр", "смес", "сегмент", "атом", "молекул", "энерг", "гравитац", "радиус", "диаметр", "угол", "процент", "формул", "эксперимент", "химическ", "металл", "сталь", "ржав", "цемент", "пыль", "пен", "порошок", "жидкост", "газ", "давлен", "температур", "вакуум"]);
loose("intellectual", "history", ["caesar", "crown", "legacy", "odyssey", "victorian", "invasion", "troop", "naval", "salute", "insignia", "emperor", "empire", "kingdom", "dynasty", "ancient", "medieval", "century", "war", "battle", "soldier", "army", "navy", "weapon", "cannon", "sword", "armor", "castle", "throne", "knight", "king", "queen", "prince", "princess", "revolution", "treaty", "colony", "empire"], ["цезар", "корол", "наслед", "одиссе", "викториан", "вторжен", "войск", "флот", "салют", "отличи", "импер", "династ", "древн", "средневек", "век", "войн", "битв", "солдат", "арми", "оруж", "пушк", "меч", "доспех", "замок", "трон", "рыцар", "революц", "договор", "колони"]);
loose("intellectual", "reading", ["story", "tale", "legend", "myth", "poem", "chapter", "page", "author", "novel", "book", "library", "tragedy", "comedy", "drama", "scene", "plot", "character", "hero", "villain"], ["истори", "сказк", "легенд", "миф", "стих", "глава", "страниц", "автор", "роман", "книг", "трагед", "комеди", "драм", "сюжет", "персонаж", "геро"]);
loose("travel", "culture", ["french", "russian", "american", "chinese", "egyptian", "african", "mexican", "italian", "irish", "indian", "greek", "bulgarian", "cambodian", "colombian", "czech", "german", "nigerian", "pakistani", "peruvian", "romanian", "siberian", "vietnamese", "albanian", "afghan", "british", "english", "spanish", "japanese", "korean", "arabic", "turkish", "polish", "swedish", "culture", "tradition", "custom", "folk", "nation", "foreign", "local", "native"], ["француз", "русск", "американ", "китай", "египет", "африк", "мексик", "итальян", "ирланд", "индий", "греческ", "болгар", "камбодж", "колумб", "чеш", "герман", "нигери", "пакистан", "перу", "румын", "сибир", "вьетнам", "уэльс", "лондон", "техас", "флорид", "белорус", "албан", "афган", "зеланд", "культур", "традиц", "обыча", "народ", "иностран", "местн"]);
loose("travel", "traveling", ["trip", "travel", "tour", "journey", "flight", "airport", "hotel", "map", "border", "island", "city", "country", "road", "path", "route", "distance", "mile", "kilometer", "abroad", "visitor", "tourist", "luggage", "ticket", "station", "harbor", "harbour", "port", "ship", "boat", "sail"], ["путешеств", "поездк", "аэропорт", "отель", "границ", "остров", "город", "стран", "дорог", "путь", "маршрут", "расстоя", "миль", "километр", "турист", "багаж", "билет", "вокзал", "порт", "корабл", "лодк"]);
loose("spirituality", "esotericism", ["devil", "deity", "apocalypse", "altar", "buddha", "christ", "christmas", "jesus", "satan", "pray", "prayer", "preacher", "sermon", "hallelujah", "resurrection", "purgatory", "voodoo", "trinity", "santa", "halloween", "mystical", "mystic", "immortal", "epiphany", "revelation", "redemption", "glory", "glorify", "oath", "vow", "sigil", "unicorn", "gnome", "imp", "ark", "chakra", "elixir", "curse", "bless", "holy", "sacred", "sin", "faith", "god", "angel", "demon", "ghost", "spirit", "soul", "ritual", "omen", "prophecy", "miracle", "heaven", "hell", "church", "priest", "witch", "magic", "spell"], ["дьявол", "божеств", "апокалип", "алтар", "будд", "христ", "рождеств", "иисус", "сатан", "молит", "проповед", "проповед", "аллилуй", "воскреш", "чистилищ", "вуду", "троиц", "санта", "хэллоуин", "мистическ", "бессмерт", "озарен", "откровен", "искуплен", "прослав", "слав", "клятв", "символ", "единорог", "гном", "чертен", "вельзевул", "ковчег", "чакра", "эликсир", "проклят", "благослов", "свят", "свящ", "грех", "вера", "ангел", "демон", "призрак", "душ", "ритуал", "чудо", "церков", "ведьм", "маги"]);
loose("entertainment", "stand_up", ["joke", "comedy", "funny", "laugh", "humor", "gag", "antics", "amusement", "chortle", "sarcasm", "irony", "prank", "silly"], ["шутк", "юмор", "смешн", "смех", "выходк", "развлечен", "хихик", "сарказм", "ирон", "розыгрыш"]);
loose("entertainment", "movies", ["movie", "film", "cinema", "actor", "scene", "episode", "series", "hero", "villain", "monster", "zombie", "alien", "superhero", "cartoon", "animation", "hollywood", "oscar", "trailer", "spectacle", "tragedy", "drama"], ["кино", "фильм", "сериал", "эпизод", "злодей", "монстр", "зомби", "супергеро", "зрелищ", "трагед", "драм"]);
loose("entertainment", "concerts", ["concert", "festival", "ticket", "crowd", "show", "performance", "stage", "audience"], ["концерт", "фестивал", "билет", "шоу", "представлен", "сцен", "зрител"]);
loose("automotive", "cars", ["ferrari", "bentley", "honda", "maserati", "lancia", "renault", "rolls", "chrome", "dent", "phaeton", "dashboard", "engine", "brake", "tire", "wheel", "garage", "driver", "traffic", "highway", "truck", "taxi", "fuel", "petrol", "hood", "bumper", "clutch", "gear", "speed", "mileage"], ["феррари", "бентли", "хонда", "мазерати", "ланча", "рено", "роллс", "хром", "вмятин", "фаэтон", "двигател", "тормоз", "шина", "колес", "гараж", "водител", "пробк", "трасс", "грузовик", "такси", "бензин", "капот", "бампер", "передач", "скорост"]);
loose("automotive", "mechanics", ["repair", "wrench", "screw", "bolt", "tool", "machine", "gear", "weld", "grease", "engine", "motor", "fix", "install", "assemble", "attach", "leak", "pipe", "valve", "pump", "cable", "wire"], ["ремонт", "гаечн", "винт", "болт", "инструмент", "шестерн", "сварк", "смаз", "мотор", "собира", "прикреп", "протеч", "труб", "клапан", "насос", "провод"]);
loose("automotive", "aviation", ["plane", "pilot", "aircraft", "helicopter", "jet", "cockpit", "runway", "aviation", "flight"], ["самолет", "пилот", "вертолет", "кабин", "взлетн", "авиац", "рейс"]);
loose("tabletop", "wargaming", ["ammunition", "bayonet", "cannon", "howitzer", "glock", "holster", "flamethrower", "semtex", "shrapnel", "saber", "spear", "mace", "melee", "rifle", "pistol", "bullet", "grenade", "bomb", "explosion", "blast", "soldier", "army", "battle", "weapon", "gun", "armor"], ["боеприпас", "штык", "гаубиц", "глок", "кобура", "огнемет", "взрывчат", "шрапнел", "сабля", "копье", "булава", "рукопашн", "винтовк", "пистолет", "пуля", "гранат", "бомб", "взрыв", "солдат", "оружи", "брон"]);
loose("tabletop", "dnd", ["dragon", "wizard", "spell", "quest", "elf", "orc", "goblin", "potion", "dungeon", "fantasy", "magic", "sword", "knight", "castle", "monster", "hero", "scroll", "potion"], ["дракон", "волшебник", "заклинан", "квест", "эльф", "орк", "гоблин", "зелье", "подземель", "фэнтези", "маги", "меч", "рыцар"]);
loose("outdoor_survival", "survivalism", ["survive", "rescue", "danger", "emergency", "wound", "blood", "death", "kill", "enemy", "escape", "threat", "knife", "blade", "fire", "shelter", "ruin", "destroy", "wreck", "corpse", "coffin", "grave", "evacuate", "camouflage", "trap", "hunt", "wild", "forest", "storm", "flood", "earthquake"], ["выживан", "спасен", "опасн", "рана", "кровь", "смерть", "уби", "враг", "побег", "угроз", "нож", "лезви", "укрыт", "разруш", "обломк", "труп", "гроб", "могил", "эваку", "маскир", "ловушк", "охот", "лес", "шторм", "наводнен"]);
loose("outdoor_survival", "camping", ["tent", "camp", "rope", "torch", "flashlight", "compass", "trail", "backpack", "bonfire", "lantern", "knot", "map"], ["палатк", "костер", "веревк", "факел", "фонар", "компас", "троп", "рюкзак"]);
loose("outdoor_survival", "fishing", ["fish", "rod", "bait", "hook", "lake", "river", "ocean", "boat", "sail", "anchor"], ["рыб", "удочк", "наживк", "крючок", "озеро", "река", "океан", "лодк", "парус", "якорь"]);
loose("lifestyle", "cooking", ["cook", "recipe", "kitchen", "meal", "food", "eat", "taste", "flavor", "bread", "meat", "soup", "sauce", "wine", "beer", "sugar", "salt", "spicy", "sweet", "restaurant", "chef", "bake", "oven"], ["готов", "рецепт", "кухн", "еда", "вкус", "хлеб", "мясо", "суп", "соус", "вино", "пиво", "сахар", "ресторан", "повар", "выпеч"]);
loose("lifestyle", "pets", ["dog", "cat", "pet", "horse", "bird", "animal", "paw", "fur", "bark", "puppy", "kitten"], ["собак", "кошк", "питомец", "лошад", "птиц", "животн", "лапа", "шерст", "гав"]);
loose("lifestyle", "fashion", ["fashion", "dress", "shirt", "suit", "shoe", "hat", "jacket", "silk", "cotton", "wear", "outfit", "style", "clothes"], ["мода", "платье", "рубашк", "костюм", "обув", "шляп", "куртк", "шелк", "одежд", "наряд", "стиль"]);
loose("lifestyle", "interior_design", ["furniture", "sofa", "room", "house", "door", "window", "wall", "floor", "roof", "lamp", "curtain", "apartment", "home", "decor"], ["мебел", "диван", "комнат", "квартир", "двер", "окн", "стен", "крыш", "лампа", "штор", "декор"]);
loose("lifestyle", "gardening", ["garden", "plant", "flower", "soil", "seed", "leaf", "tree", "grass", "dirt"], ["сад", "растен", "цвет", "почв", "семен", "лист", "дерев", "трава", "грязь"]);
loose("lifestyle", "coffee_and_tea", ["coffee", "tea", "cafe", "cup", "mug"], ["кофе", "чай", "кафе", "чашк", "кружк"]);
loose("collecting", "mineralogy", ["emerald", "diamond", "gold", "silver", "jewel", "gem", "crystal", "mineral", "stone", "rock"], ["изумруд", "алмаз", "золот", "серебр", "драгоцен", "кристалл", "минерал", "камень"]);
loose("collecting", "antiques", ["antique", "vintage", "relic", "heirloom", "retro"], ["антиквар", "винтаж", "реликви", "старин", "ретро"]);
loose("collecting", "action_figures", ["toy", "doll", "figurine", "collect", "collection"], ["игрушк", "кукл", "фигурк", "коллекц"]);
loose("tech", "programming", ["code", "software", "computer", "internet", "website", "password", "hack", "digital", "online", "data", "server", "algorithm", "program", "screen", "keyboard", "email", "browser", "app", "instagram", "twitter"], ["код", "программ", "компьютер", "интернет", "сайт", "парол", "хакер", "цифров", "данн", "сервер", "алгоритм", "экран", "клавиатур", "инстаграм", "твиттер"]);
loose("tech", "gaming", ["game", "gamer", "console", "quest", "level", "player", "avatar", "pixel"], ["видеоигр", "геймер", "консол", "квест", "игрок", "аватар", "пиксель"]);
loose("tech", "gadgets", ["phone", "smartphone", "tablet", "headphone", "battery", "charger", "device", "gadget", "camera", "speaker"], ["телефон", "смартфон", "планшет", "наушник", "батаре", "зарядк", "устройств", "гаджет", "камер", "колонк"]);
loose("tech", "robotics", ["robot", "drone", "android", "cyborg", "sensor"], ["робот", "дрон", "андроид", "киборг", "сенсор"]);
loose("business", "entrepreneurship", ["business", "company", "client", "customer", "contract", "deal", "market", "brand", "profit", "office", "boss", "corporate", "startup"], ["бизнес", "компани", "клиент", "контракт", "сделк", "рынок", "бренд", "прибыл", "офис", "босс", "корпорац", "стартап"]);
loose("business", "marketing", ["marketing", "advert", "campaign", "promotion", "brand", "audience"], ["маркетинг", "реклам", "кампани", "продвижен", "аудитор"]);
loose("business", "sales", ["sale", "sell", "discount", "buyer", "offer", "negotiate", "price", "cost"], ["продаж", "скидк", "покупател", "предложен", "переговор", "цен", "стоимость"]);
loose("business", "project_management", ["project", "deadline", "task", "plan", "schedule", "manager", "management", "benchmark", "capability"], ["проект", "срок", "задач", "план", "расписан", "менеджер", "управлен", "эталон", "способност"]);
loose("business", "ecommerce", ["shop", "store", "order", "delivery", "product", "warehouse"], ["магазин", "заказ", "доставк", "товар", "склад"]);
loose("career", "career_growth", ["career", "job", "work", "colleague", "employee", "profession", "skill", "promotion", "mentor", "office"], ["карьер", "работ", "коллег", "сотрудник", "професси", "навык", "повышен", "наставник"]);
loose("career", "hr_and_recruiting", ["hire", "recruit", "resume", "interview", "candidate", "vacancy"], ["наем", "рекру", "резюме", "собеседован", "кандидат", "ваканс"]);
loose("career", "public_speaking", ["speech", "speaker", "presentation", "lecture", "voice", "rhetoric", "audience"], ["речь", "оратор", "презентац", "лекци", "голос", "риторик"]);
loose("career", "productivity", ["productivity", "habit", "routine", "efficient", "priority", "focus", "deadline"], ["продуктив", "привычк", "распорядок", "эффектив", "приоритет"]);
loose("social", "community_building", ["community", "society", "people", "public", "group", "club", "member", "together", "team", "friend", "neighbor"], ["сообществ", "обществ", "люди", "публич", "клуб", "вместе", "команд", "друг", "сосед"]);
loose("social", "social_activism", ["protest", "rights", "justice", "law", "court", "police", "crime", "prison", "vote", "election", "government", "politics", "freedom", "punish", "obey"], ["протест", "прав", "справедливост", "закон", "суд", "полиц", "преступлен", "тюрьм", "выбор", "правительств", "политик", "свобод", "наказ", "подчиня"]);
loose("social", "event_management", ["event", "party", "wedding", "ceremony", "celebration", "holiday", "birthday", "invite", "festival", "organize", "prize", "raffle"], ["мероприят", "свадьб", "церемони", "праздник", "приглашен", "организац", "приз", "лотере"]);
loose("social", "networking", ["friend", "meet", "introduce", "conversation", "talk", "chat", "guest", "party"], ["друг", "знаком", "встреч", "разговор", "беседова", "гость", "вечеринк"]);
loose("social", "mentorship", ["teach", "teacher", "student", "lesson", "school", "class", "learn", "study", "education", "pupil"], ["учител", "ученик", "урок", "школ", "класс", "образован", "учить"]);
loose("social", "charity", ["charity", "donate", "foundation", "aid", "volunteer", "homeless"], ["благотвор", "фонд", "пожертвован", "волонтер", "бездом"]);
loose("sports", "fitness", ["sport", "gym", "workout", "muscle", "train", "training", "coach", "athlete", "team", "match", "score", "champion", "medal", "stadium", "exercise"], ["спорт", "тренажер", "трениров", "мышц", "тренер", "атлет", "команд", "матч", "счет", "чемпион", "медал", "стадион"]);
loose("sports", "martial_arts", ["boxing", "karate", "fighter", "punch", "kick", "wrestling", "kung"], ["бокс", "каратэ", "боец", "удар", "борьб", "кунг"]);
loose("sports", "running", ["run", "runner", "sprint", "marathon", "jog"], ["бег", "бегун", "спринт", "марафон"]);
loose("arts", "music", ["music", "song", "sing", "guitar", "piano", "drum", "melody", "rhythm", "orchestra", "violin", "concert", "band", "album", "choir"], ["музык", "песн", "гитар", "пианино", "мелодия", "оркестр", "концерт", "альбом", "хор"]);
loose("arts", "theater", ["theater", "theatre", "actor", "stage", "drama", "rehearsal", "script", "role", "costume", "curtain", "audience"], ["театр", "актер", "сцен", "драм", "репетиц", "роль", "костюм"]);
loose("arts", "art", ["paint", "draw", "canvas", "gallery", "sculpture", "portrait", "sketch", "illustration"], ["рисун", "живопис", "картин", "галере", "скульптур", "портрет"]);
loose("arts", "writing", ["write", "writer", "poem", "poetry", "novel", "author", "blog", "essay", "manuscript"], ["писател", "стих", "поэм", "роман", "автор", "блог", "эссе"]);
loose("arts", "design", ["design", "logo", "font", "layout", "graphic", "poster"], ["дизайн", "логотип", "шрифт", "макет", "графическ"]);
loose("arts", "photography", ["photo", "photograph", "camera", "lens", "snapshot"], ["фото", "камер", "объектив", "снимок"]);

const INTERJECTIONS = new Set(
  "ah ah ah alas amen arf aw aww bam bing boom bong buzz clang clank clunk eh gee gosh ha hallelujah hooray hmm jeez mm nah nay oh ooh oop oops oopsie ouch ow poof shh shoo snort ugh uh um whoa whoo whoosh wow yeesh yo yuck yum".split(
    /\s+/,
  ),
);

function norm(value: string): string {
  return value.toLowerCase().replaceAll("ё", "е");
}

function tokens(value: string, letters: RegExp): string[] {
  return norm(value).split(letters).filter((part) => part.length > 1);
}

export interface InterestMatch {
  categoryId: string;
  tagSlug: string;
  score: number;
}

function scoreMap(
  source: Map<string, { en: string[]; ru: string[] }>,
  enTokens: string[],
  ruTokens: string[],
  enBlob: string,
  ruBlob: string,
  minimum: number,
): InterestMatch | null {
  let best: InterestMatch | null = null;
  for (const [key, words] of source) {
    const [categoryId, tagSlug] = key.split("/") as [string, string];
    let score = 0;
    for (const raw of words.en) {
      const kw = norm(raw);
      if (kw.length < 3) continue;
      if (enTokens.includes(kw) || (kw.length >= 4 && enBlob.includes(kw))) score += 12 + kw.length;
      else if (kw.length >= 4 && enTokens.some((token) => token.startsWith(kw))) score += 6 + kw.length;
    }
    for (const raw of words.ru) {
      const kw = norm(raw);
      if (kw.length < 4) continue;
      if (ruTokens.some((token) => token === kw || token.startsWith(kw)) || ruBlob.includes(kw)) {
        score += 10 + kw.length;
      }
    }
    if (score < minimum) continue;
    if (!best || score > best.score) best = { categoryId, tagSlug, score };
  }
  return best;
}

function isPlaceName(en: string, ru: string[]): boolean {
  const head = norm(en).split(/[^a-z]+/).filter(Boolean)[0] ?? "";
  if (head.length < 5) return false;
  const gloss = norm(ru.join(" "));
  if (!/(ский|ская|ское|ские)/.test(gloss) && !/(ец|цы|янин|янка)$/.test(gloss.trim())) return false;
  return /(ian|ese|ish|ani|ean)$/.test(head);
}

/** Best interest tag for a lemma, using the catalog descriptions expanded into keywords. */
export function classifyInterest(en: string, ru: string[]): InterestMatch | null {
  const enTokens = tokens(en, /[^a-z0-9]+/);
  const ruTokens = tokens(ru.join(" "), /[^а-я0-9]+/);
  const enBlob = enTokens.join(" ");
  const ruBlob = ruTokens.join(" ");
  const strict = scoreMap(TAGS, enTokens, ruTokens, enBlob, ruBlob, 12);
  if (strict) return strict;
  const head = enTokens[0] ?? "";
  if (head && INTERJECTIONS.has(head) && enTokens.length <= 2) {
    return { categoryId: "intellectual", tagSlug: "languages", score: 8 };
  }
  if (isPlaceName(en, ru)) return { categoryId: "travel", tagSlug: "culture", score: 8 };
  const looseHit = scoreMap(LOOSE, enTokens, ruTokens, enBlob, ruBlob, 10);
  if (looseHit) return looseHit;
  return glossHint(ruBlob);
}

/** Last resort: a gloss that clearly names one interest, not a grab-bag. */
function glossHint(gloss: string): InterestMatch | null {
  const rules: [RegExp, string, string][] = [
    [/скрыва|тайник|прятать|маскир/, "outdoor_survival", "survivalism"],
    [/разруш|уничтож|взрыв|убий|смерт|труп|ранен|опасн|спасен|эваку/, "outdoor_survival", "survivalism"],
    [/говор|кричать|шепот|речь|спор|болта/, "career", "public_speaking"],
    [/думать|мысль|понят|знан|помнит|забыв|решен|вывод|размыш/, "intellectual", "philosophy"],
    [/чувств|страх|злост|радост|груст|любов|ненавист|тревог|стыд/, "intellectual", "psychology"],
    [/деньг|платеж|долг|богатств|дешев|дорого|зарплат|налог/, "intellectual", "finance"],
    [/еда|кухн|рецепт|вкус|повар|выпеч/, "lifestyle", "cooking"],
    [/собак|кошк|питомец|лошад|животн/, "lifestyle", "pets"],
    [/одежд|мод|платье|обув/, "lifestyle", "fashion"],
    [/мебел|комнат|квартир|интерьер/, "lifestyle", "interior_design"],
    [/растен|сад|дерев|цветок/, "lifestyle", "gardening"],
    [/автомобил|двигател|колес|гараж|водител|бензин/, "automotive", "cars"],
    [/самолет|пилот|вертолет|авиац/, "automotive", "aviation"],
    [/ремонт|инструмент|механик|болт|винт/, "automotive", "mechanics"],
    [/путешеств|аэропорт|отель|турист|багаж/, "travel", "traveling"],
    [/культур|традиц|храм|памятник/, "travel", "culture"],
    [/кино|фильм|сериал|монстр|геро/, "entertainment", "movies"],
    [/шутк|юмор|смешн|комеди/, "entertainment", "stand_up"],
    [/музык|песн|гитар|концерт/, "arts", "music"],
    [/театр|актер|сцен/, "arts", "theater"],
    [/рисун|картин|скульптур/, "arts", "art"],
    [/компьютер|программ|интернет|сайт|робот/, "tech", "programming"],
    [/видеоигр|геймер/, "tech", "gaming"],
    [/бизнес|компани|клиент|контракт|прибыл/, "business", "entrepreneurship"],
    [/реклам|маркетинг/, "business", "marketing"],
    [/продаж|скидк|покупател/, "business", "sales"],
    [/карьер|сотрудник|професси|собеседован/, "career", "career_growth"],
    [/закон|суд|полиц|преступлен|выбор|политик/, "social", "social_activism"],
    [/праздник|свадьб|мероприят|приглашен/, "social", "event_management"],
    [/друг|сообществ|сосед|разговор/, "social", "networking"],
    [/школ|учител|ученик|урок/, "social", "mentorship"],
    [/спорт|трениров|стадион|медал/, "sports", "fitness"],
    [/молитв|церков|дьявол|свят|душ|проклят|благослов/, "spirituality", "esotericism"],
    [/шахмат|головолом/, "intellectual", "chess"],
    [/книг|роман|библиотек/, "intellectual", "reading"],
    [/наук|хими|физик|атом|эксперимент/, "intellectual", "science"],
    [/истори|древн|войн|корол|рыцар/, "intellectual", "history"],
    [/язык|граммат|перевод|словар/, "intellectual", "languages"],
  ];
  for (const [pattern, categoryId, tagSlug] of rules) {
    if (pattern.test(gloss)) return { categoryId, tagSlug, score: 6 };
  }
  return null;
}

export function interestCategory(id: string): InterestCategory | undefined {
  return INTERESTS.find((category) => category.id === id);
}

export function interestTag(categoryId: string, slug: string): InterestTag | undefined {
  return interestCategory(categoryId)?.tags.find((item) => item.slug === slug);
}

function interestChildThemes(parentId: string): DictTheme[] {
  const block = dictionary.blocks.find((item) => item.id === parentId);
  const fromBlock = (block?.themeIds ?? [])
    .map((id) => dictionary.getTheme(id))
    .filter((theme): theme is DictTheme => theme != null && theme.id !== parentId);
  if (fromBlock.length > 0) return fromBlock;
  return [...dictionary.themes.values()].filter((theme) => theme.blockId === parentId && theme.id !== parentId);
}

/**
 * Subcategory already created when a theme passed 1000 words.
 * A letter band that can still hold the lemma wins; otherwise any open subcategory.
 */
export function pickInterestChild(parentId: string, word: { en: string }): string | null {
  const themes = interestChildThemes(parentId);
  if (themes.length === 0) return null;
  const letter = (word.en[0] ?? "").toLowerCase();
  const band = themes.find((theme) => {
    const letters = theme.words
      .map((item) => (item.en[0] ?? "").toLowerCase())
      .filter(Boolean)
      .sort();
    if (letters.length === 0) return false;
    return letter >= letters[0]! && letter <= letters[letters.length - 1]!;
  });
  if (band && band.words.length < CATEGORY_WORD_LIMIT) return band.id;
  const open = themes.find((theme) => theme.words.length < CATEGORY_WORD_LIMIT);
  if (open) return open.id;
  return (band ?? themes[0])?.id ?? null;
}

/** interest-other, or the leftover subcategory from an existing split of that file. */
export function leftoverInterestThemeId(word?: { en: string }): string {
  if (dictionary.getTheme(INTEREST_OTHER_ID)) return INTEREST_OTHER_ID;
  if (word) return pickInterestChild(INTEREST_OTHER_ID, word) ?? "general";
  return interestChildThemes(INTEREST_OTHER_ID)[0]?.id ?? "general";
}

/** Theme id that already exists for this interest match. Tag themes win when the category was split. */
export function resolveInterestThemeId(categoryId: string, tagSlug: string): string {
  const tagTheme = `interest-${categoryId}-${tagSlug}`;
  const categoryTheme = `interest-${categoryId}`;
  if (dictionary.getTheme(tagTheme)) return tagTheme;
  if (dictionary.getTheme(categoryTheme)) return categoryTheme;
  if (dictionary.getTheme(INTEREST_OTHER_ID)) return INTEREST_OTHER_ID;
  return leftoverInterestThemeId();
}

/**
 * Catalog theme for a lemma.
 * A word that already sits in a theme stays there.
 * Otherwise it goes to the best interest category, or interest-other.
 */
export function themeForMediaWord(word: { id: string; en: string; ru: string[] }): string {
  const existing = dictionary.catalogThemesFor(word.id).find((theme) => !theme.id.startsWith("interest-"));
  if (existing) return existing.id;
  const interest = dictionary.catalogThemeIdFor(word.id);
  if (interest) return interest;
  const match = classifyInterest(word.en, word.ru);
  if (!match) return leftoverInterestThemeId(word);
  return resolveInterestThemeId(match.categoryId, match.tagSlug);
}
