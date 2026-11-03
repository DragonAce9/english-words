#!/usr/bin/env npx tsx
/**
 * Import FreeDict English–Russian (CC-BY-SA 3.0) into data/themes/*.json.
 *
 *   npm run import:dict
 *
 * Downloads the FreeDict source tarball (and a MIT common-English list) into
 * data/source/, which is gitignored. Word ids are canonical slugs of `en`
 * (`airport`, `wake-up`) so the same headword can appear in several themes.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourceDir = join(root, "data", "source");
const seedsDir = join(root, "data", "seeds");
const themesDir = join(root, "data", "en", "themes");
const exclusionsPath = join(root, "data", "theme-exclusions.json");

const FREEDICT_VERSION = "2025.11.23";
const FREEDICT_TAR = `freedict-eng-rus-${FREEDICT_VERSION}.src.tar.xz`;
const FREEDICT_URL = `https://download.freedict.org/dictionaries/eng-rus/${FREEDICT_VERSION}/${FREEDICT_TAR}`;
const TEI_PATH = join(sourceDir, "eng-rus", "eng-rus.tei");
const COMMON_URL =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt";
const COMMON_PATH = join(sourceDir, "google-10000-english-no-swears.txt");

const OK_POS = new Set([
  "n",
  "v",
  "adj",
  "adv",
  "numeral",
  "pronoun",
  "determiner",
  "preposition",
  "conjunction",
  "interjection",
]);
const SKIP_HEAD = new Set(["the", "a", "an"]);
const TWO_LETTER = new Set([
  "am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it",
  "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we",
]);
const SLANG = /\b(slang|vulgar|obsolete|archaic|offensive|derogatory|pejorative)\b/i;
const WIKI_LINK = /\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g;
const CYRILLIC = /[а-яёА-ЯЁ]/;
const LATIN = /[a-zA-Z]/;
const HEADWORD = /^[a-z]+(?:-[a-z]+)?$/;
const RU_SKIP =
  /^(жрать|сожрать|срать|обосрать|блевать|ссать|бабло|хер|хуй|хуйня|пизда|пиздец|блять|блядь|ебать|ёбать)$/i;

interface DictWord {
  id: string;
  en: string;
  ru: string[];
  example: string;
}

interface ThemeSpec {
  id: string;
  title: string;
  paid: boolean;
  en: string[];
  ru: string[];
}

interface CuratedWord {
  en: string;
  ru: string[];
  example?: string;
}

interface CuratedTheme {
  id: string;
  title: string;
  paid: boolean;
  words: CuratedWord[];
}

/** Lemma for FreeDict lookup: first principal part before ` / `, else full `en`. */
function curatedLemma(en: string): string {
  const head = en.split(/\s*\/\s*/)[0]?.trim() ?? en;
  return head.replace(/\/.*/, "").trim().toLowerCase();
}

const SEEDS: { themeId: string; word: Omit<DictWord, "id"> }[] = [
  { themeId: "travel", word: { en: "airport", ru: ["аэропорт"], example: "We arrived at the airport early." } },
  { themeId: "travel", word: { en: "ticket", ru: ["билет"], example: "I bought a ticket to London." } },
  { themeId: "travel", word: { en: "passport", ru: ["паспорт"], example: "Don't forget your passport at home." } },
  { themeId: "travel", word: { en: "luggage", ru: ["багаж"], example: "Her luggage was waiting at the belt." } },
  { themeId: "travel", word: { en: "hotel", ru: ["отель", "гостиница"], example: "The hotel is close to the station." } },
  { themeId: "travel", word: { en: "flight", ru: ["рейс", "полёт"], example: "Our flight was delayed by an hour." } },
  { themeId: "travel", word: { en: "departure", ru: ["отправление", "вылет"], example: "The departure is at six in the morning." } },
  { themeId: "travel", word: { en: "arrival", ru: ["прибытие"], example: "Please wait in the arrival hall." } },
  { themeId: "travel", word: { en: "map", ru: ["карта"], example: "This map shows the old town." } },
  { themeId: "travel", word: { en: "suitcase", ru: ["чемодан"], example: "He packed the suitcase last night." } },
  { themeId: "travel", word: { en: "border", ru: ["граница"], example: "We crossed the border on foot." } },
  { themeId: "travel", word: { en: "tourist", ru: ["турист"], example: "Many tourists visit the museum." } },
  { themeId: "food", word: { en: "breakfast", ru: ["завтрак"], example: "Breakfast is the first meal of the day." } },
  { themeId: "food", word: { en: "lunch", ru: ["обед"], example: "We had lunch at a small cafe." } },
  { themeId: "food", word: { en: "dinner", ru: ["ужин"], example: "Dinner is at seven tonight." } },
  { themeId: "food", word: { en: "bread", ru: ["хлеб"], example: "Fresh bread smells wonderful." } },
  { themeId: "food", word: { en: "cheese", ru: ["сыр"], example: "Would you like some cheese with that?" } },
  { themeId: "food", word: { en: "soup", ru: ["суп"], example: "The soup is hot and tasty." } },
  { themeId: "food", word: { en: "salad", ru: ["салат"], example: "I ordered a green salad." } },
  { themeId: "food", word: { en: "dessert", ru: ["десерт"], example: "Ice cream is my favourite dessert." } },
  { themeId: "food", word: { en: "restaurant", ru: ["ресторан"], example: "This restaurant opens at noon." } },
  { themeId: "food", word: { en: "menu", ru: ["меню"], example: "Could I see the menu, please?" } },
  { themeId: "food", word: { en: "delicious", ru: ["вкусный", "вкусно"], example: "The cake was delicious." } },
  { themeId: "food", word: { en: "hungry", ru: ["голодный"], example: "I am hungry after the walk." } },
  { themeId: "daily", word: { en: "morning", ru: ["утро"], example: "I drink tea every morning." } },
  { themeId: "daily", word: { en: "evening", ru: ["вечер"], example: "We stay at home in the evening." } },
  { themeId: "daily", word: { en: "toothbrush", ru: ["зубная щётка", "зубная щетка"], example: "Pack a toothbrush for the trip." } },
  { themeId: "daily", word: { en: "shower", ru: ["душ"], example: "She takes a shower after work." } },
  { themeId: "daily", word: { en: "wake up", ru: ["просыпаться", "вставать"], example: "I wake up at seven." } },
  { themeId: "daily", word: { en: "sleep", ru: ["спать", "сон"], example: "Children need enough sleep." } },
  { themeId: "daily", word: { en: "work", ru: ["работа", "работать"], example: "He goes to work by bus." } },
  { themeId: "daily", word: { en: "home", ru: ["дом", "домой"], example: "Let's go home now." } },
  { themeId: "daily", word: { en: "family", ru: ["семья"], example: "My family lives in the city." } },
  { themeId: "daily", word: { en: "friend", ru: ["друг", "подруга"], example: "She is my best friend." } },
  { themeId: "daily", word: { en: "shop", ru: ["магазин"], example: "The shop closes at nine." } },
  { themeId: "daily", word: { en: "key", ru: ["ключ"], example: "I can't find my key." } },
];

const THEMES: ThemeSpec[] = [
  {
    id: "travel",
    title: "Путешествия",
    paid: false,
    en: [
      "airport", "ticket", "passport", "luggage", "hotel", "flight", "departure", "arrival", "map", "suitcase",
      "border", "tourist", "travel", "trip", "journey", "voyage", "plane", "airplane", "aircraft", "airline",
      "train", "bus", "taxi", "metro", "subway", "tram", "station", "platform", "terminal", "gate", "runway",
      "pilot", "passenger", "cabin", "boarding", "delay", "destination", "route", "fare", "baggage", "backpack",
      "customs", "visa", "embassy", "hostel", "motel", "inn", "reservation", "booking", "souvenir", "guide",
      "sightseeing", "beach", "cruise", "ferry", "ship", "boat", "harbor", "harbour", "port", "highway", "road",
      "bridge", "tunnel", "compass", "railway", "railroad", "coach", "carriage", "vehicle", "traffic", "parking",
      "pedestrian", "sidewalk", "crosswalk", "motorway", "roundabout", "intersection", "tourist", "tourism",
      "vacation", "holiday", "check-in", "checkout", "lobby", "reception",
      "delayed", "cancelled", "timetable",
      "wagon", "bicycle", "motorcycle", "car", "truck", "van", "driver", "seat",
      "lane", "direction", "north", "south", "east", "west", "abroad", "foreign",
      "country", "island", "coast", "helicopter",
      "unpack", "tour", "excursion", "museum", "monument",
      "castle", "palace", "cathedral", "square", "avenue", "boulevard", "district", "suburb", "downtown",
      "receptionist", "porter", "balcony",
      "confirm", "security",
      "accommodation", "adventure", "camping", "explore", "guest", "lodge", "resort", "safari",
      "trail", "visit", "visitor", "voyage",
    ],
    ru: [
      "аэропорт", "билет", "паспорт", "багаж", "отель", "гостиница", "рейс", "полёт", "полет", "чемодан",
      "граница", "турист", "путешествие", "поезд", "самолёт", "самолет", "автобус", "такси", "метро",
      "вокзал", "станция", "виза", "хостел", "паром", "корабль", "гавань", "шоссе", "туризм", "отпуск",
      "таможня", "посадка", "вылет", "прибытие", "направление", "достопримечательность",
    ],
  },
  {
    id: "food",
    title: "Еда",
    paid: true,
    en: [
      "breakfast", "lunch", "dinner", "supper", "bread", "cheese", "soup", "salad", "dessert", "restaurant",
      "menu", "delicious", "hungry", "food", "eat", "meal", "snack", "drink", "tea", "coffee", "juice", "milk",
      "beer", "wine", "meat", "fish", "chicken", "beef", "pork", "lamb", "egg", "butter", "oil", "sugar", "salt",
      "pepper", "rice", "pasta", "noodle", "potato", "tomato", "onion", "garlic", "carrot", "apple", "banana",
      "orange", "lemon", "berry", "fruit", "vegetable", "cake", "cookie", "pie", "chocolate", "candy", "sandwich",
      "pizza", "burger", "steak", "sausage", "bacon", "ham", "yogurt", "cream", "flour", "cook", "boil", "fry",
      "bake", "roast", "grill", "taste", "sweet", "sour", "bitter", "spicy", "salty", "thirsty", "fork", "knife",
      "spoon", "plate", "cup", "glass", "bowl", "napkin", "waiter", "waitress", "cafe", "cafeteria", "bar", "pub",
      "chef", "recipe", "ingredient", "breakfast", "lunch", "dinner", "kitchen", "oven", "fridge", "taste",
      "flavour", "flavor", "hungry", "thirsty", "delicious", "tasty", "fresh", "raw", "fried", "boiled", "baked",
      "soup", "sauce", "spice", "herb", "mushroom", "cabbage", "cucumber", "pea", "bean", "corn", "wheat", "honey",
      "jam", "butter", "cheese", "bread", "toast", "cereal", "porridge", "pancake", "waffle", "ice-cream",
      "icecream", "water", "soda", "cola", "cocktail", "whisky", "vodka", "champagne", "grape", "peach", "pear",
      "cherry", "strawberry", "watermelon", "melon", "pineapple", "mango", "nut", "almond", "walnut", "peanut",
      "alcohol", "bottle", "dish", "gourmet", "nutrition", "organic", "pan",
    ],
    ru: [
      "завтрак", "обед", "ужин", "хлеб", "сыр", "суп", "салат", "десерт", "ресторан", "меню", "еда", "есть",
      "кушать", "напиток", "чай", "кофе", "сок", "молоко", "мясо", "рыба", "курица", "яйцо", "масло", "сахар",
      "соль", "перец", "рис", "картофель", "помидор", "лук", "яблоко", "фрукт", "овощ", "торт", "пицца",
      "вкусный", "голодный", "жарить", "варить", "печь", "ложка", "вилка", "тарелка", "чашка", "повар",
    ],
  },
  {
    id: "animals",
    title: "Животные",
    paid: true,
    en: [
      "animal", "cat", "dog", "bird", "horse", "cow", "pig", "sheep", "goat", "duck", "rabbit", "mouse", "rat",
      "bear", "wolf", "fox", "lion", "tiger", "elephant", "monkey", "snake", "frog", "bee", "ant", "spider",
      "insect", "pet", "puppy", "kitten", "tail", "paw", "feather", "wing", "zoo", "wild", "deer", "elk", "moose",
      "eagle", "owl", "crow", "pigeon", "sparrow", "swan", "goose", "turkey", "chicken", "hen", "rooster", "chick",
      "shark", "whale", "dolphin", "seal", "crab", "lobster", "shrimp", "butterfly", "mosquito",
      "worm", "snail", "turtle", "crocodile", "lizard", "camel", "zebra", "giraffe", "hippo", "rhino", "panda",
      "kangaroo", "koala", "squirrel", "hedgehog", "bat", "hamster", "parrot", "penguin", "nest", "cage", "hunt",
      "hunter", "prey", "herd", "flock", "breed", "wildlife", "creature", "beast", "mammal", "species",
      "buffalo", "bug", "wildlife",
    ],
    ru: [
      "животное", "кошка", "кот", "собака", "птица", "лошадь", "корова", "свинья", "овца", "коза", "утка",
      "кролик", "мышь", "медведь", "волк", "лиса", "лев", "тигр", "слон", "обезьяна", "змея", "лягушка",
      "пчела", "муравей", "паук", "насекомое", "питомец", "хвост", "крыло", "зоопарк", "орёл", "сова",
      "кит", "дельфин", "бабочка", "черепаха", "верблюд", "зебра", "жираф", "пингвин", "гнездо",
    ],
  },
  {
    id: "body",
    title: "Тело",
    paid: true,
    en: [
      "body", "head", "hair", "face", "eye", "ear", "nose", "mouth", "tooth", "teeth", "tongue", "lip", "neck",
      "shoulder", "arm", "hand", "finger", "nail", "chest", "back", "stomach", "belly", "heart", "lung", "liver",
      "blood", "bone", "skin", "leg", "knee", "foot", "feet", "toe", "brain", "muscle",
      "weight", "tall", "short", "thin", "fat", "strong", "weak", "breathe",
      "breath", "voice", "throat", "wrist", "ankle", "elbow", "hip", "waist", "beard", "mustache", "moustache",
      "eyebrow", "eyelash", "cheek", "chin", "forehead", "jaw", "thumb", "palm", "fist", "heel", "sole", "rib",
      "spine", "nerve", "vein", "pulse", "birth", "cell", "female", "gender", "male", "physical",
    ],
    ru: [
      "тело", "голова", "волосы", "лицо", "глаз", "ухо", "нос", "рот", "зуб", "язык", "шея", "плечо", "рука",
      "палец", "грудь", "спина", "живот", "сердце", "лёгкое", "легкое", "печень", "кровь", "кость", "кожа",
      "нога", "колено", "ступня", "мозг", "мышца", "мужчина", "женщина",
    ],
  },
  {
    id: "clothes",
    title: "Одежда",
    paid: true,
    en: [
      "clothes", "clothing", "wear", "dress", "shirt", "pants", "trousers", "jeans", "skirt", "shorts", "coat",
      "jacket", "sweater", "jumper", "hoodie", "underwear", "socks", "shoes", "boots", "sneakers", "sandals",
      "hat", "cap", "scarf", "gloves", "belt", "button", "pocket", "collar", "sleeve", "fashion", "uniform",
      "pajamas", "pyjamas", "tie", "suit", "umbrella", "glasses", "sunglasses", "purse", "wallet", "jewelry",
      "jewellery", "ring", "necklace", "earring", "bracelet", "outfit", "costume", "robe", "cloak", "raincoat",
      "overcoat", "blazer", "blouse", "t-shirt", "tshirt", "vest", "waistcoat", "stockings", "tights", "heels",
      "slippers", "boots", "lace", "zip", "zipper", "wool", "cotton", "silk", "leather", "size", "fit", "tight",
      "loose", "put-on", "take-off", "naked", "bare", "dressed",
      "accessory", "jersey", "lingerie", "vintage", "boot", "boots",
    ],
    ru: [
      "одежда", "платье", "рубашка", "брюки", "джинсы", "юбка", "шорты", "пальто", "куртка", "свитер",
      "футболка", "носки", "обувь", "ботинки", "туфли", "шляпа", "шапка", "шарф", "перчатки", "ремень",
      "пуговица", "карман", "мода", "костюм", "галстук", "зонт", "очки", "кольцо", "ожерелье", "серьга",
    ],
  },
  {
    id: "nature",
    title: "Природа",
    paid: true,
    en: [
      "nature", "tree", "forest", "wood", "woods", "river", "lake", "sea", "ocean", "mountain", "hill", "valley",
      "sun", "moon", "star", "sky", "cloud",
      "earth", "ground", "stone", "rock", "sand", "grass", "flower", "plant", "leaf", "root", "garden",
      "park", "field", "farm", "soil", "fire", "ice",
      "earthquake", "volcano", "desert", "jungle", "island", "coast", "shore", "wave", "tide", "current", "stream",
      "waterfall", "cave", "cliff", "peak", "slope", "meadow", "bush", "branch", "trunk", "bark", "seed", "bloom",
      "blossom", "rose", "oak", "pine", "birch", "environment", "planet", "world", "landscape", "horizon",
      "agricultural", "agriculture", "air", "conservation", "creek", "environmental", "outdoor", "outdoors",
      "solar", "organic",
    ],
    ru: [
      "природа", "дерево", "лес", "река", "озеро", "море", "океан", "гора", "холм", "солнце", "луна", "звезда",
      "небо", "облако", "земля", "камень",
      "песок", "трава", "цветок", "растение", "лист", "сад", "парк", "поле", "ферма", "огонь", "лёд", "лед",
      "волна", "берег", "пустыня", "природа",
    ],
  },
  {
    id: "home",
    title: "Дом",
    paid: true,
    en: [
      "house", "apartment", "flat", "room", "bedroom", "bathroom", "kitchen", "hall", "ceiling", "wall", "window",
      "door", "roof", "stairs", "furniture", "table", "chair", "sofa", "couch", "bed", "mattress", "pillow",
      "blanket", "lamp", "mirror", "carpet", "curtain", "closet", "cupboard", "shelf", "drawer", "fridge",
      "refrigerator", "stove", "microwave", "sink", "toilet", "bath", "soap", "towel", "broom", "vacuum", "lock",
      "fence", "garage", "balcony", "basement", "attic", "chimney", "fireplace", "cushion", "armchair", "desk",
      "wardrobe", "dresser", "vase", "picture", "frame", "candle", "switch", "plug", "socket", "wire",
      "pipe", "tap", "faucet", "bucket", "trash", "garbage", "waste", "recycle", "clean", "dirty", "tidy", "mess",
      "household", "housework", "chore", "neighbor", "neighbour", "landlord", "rent", "address", "building",
      "floor", "interior", "lighting", "residence", "residential", "estate",
    ],
    ru: [
      "квартира", "комната", "спальня", "ванная", "кухня", "потолок", "стена", "окно", "дверь", "крыша",
      "лестница", "мебель", "стол", "стул", "диван", "кровать", "подушка", "одеяло", "лампа", "зеркало",
      "ковёр", "ковер", "штора", "шкаф", "полка", "холодильник", "плита", "раковина", "туалет", "ванна",
      "мыло", "полотенце", "замок", "гараж", "балкон", "соседи", "аренда",
    ],
  },
  {
    id: "work",
    title: "Работа",
    paid: true,
    en: [
      "job", "office", "business", "company", "career", "employee", "employer", "boss", "manager", "colleague",
      "meeting", "salary", "wage", "interview", "resume", "profession", "occupation", "factory", "worker",
      "engineer", "lawyer", "store", "customer", "client", "service", "product", "market", "money", "bank",
      "cash", "coin", "pay", "price", "cheap", "expensive", "tax", "contract", "deadline", "project", "email",
      "phone", "call", "computer", "internet", "website", "software", "screen", "keyboard", "printer", "file",
      "document", "report", "team", "task", "goal", "plan", "strategy", "profit", "loss", "budget", "account",
      "invoice", "bill", "debt", "loan", "credit", "investment", "share", "stock", "trade", "deal", "sale",
      "discount", "offer", "order", "delivery", "supply", "demand", "quality", "brand", "advertising", "marketing",
      "secretary", "assistant", "director", "president", "staff", "hire", "fire", "resign", "retire", "unemployed",
      "employment", "labor", "labour", "shift", "overtime", "break", "vacation", "leave",
      "admin", "administration", "administrator", "agency", "agent", "applicant", "apply", "asset",
      "audit", "bonus", "commission", "committee", "consultant", "contractor", "corporate", "corporation",
      "enterprise", "executive", "industry", "management", "manufacturer", "personnel", "professional",
      "recruitment", "workshop", "career",
      "conference", "construction", "consultation", "consumption", "develop", "development", "equipment",
      "expert", "expertise", "manufacturing", "opportunity", "performance", "portfolio", "principal",
      "procedure", "progress", "provider", "supplier", "operate", "operation", "project", "task",
    ],
    ru: [
      "работа", "офис", "бизнес", "компания", "карьера", "сотрудник", "начальник", "менеджер", "коллега",
      "совещание", "зарплата", "собеседование", "профессия", "завод", "рабочий", "инженер", "юрист",
      "клиент", "услуга", "товар", "рынок", "деньги", "банк", "наличные", "цена", "дешёвый", "дешевый",
      "дорогой", "налог", "договор", "проект", "компьютер", "интернет", "зарплата", "должность",
    ],
  },
  {
    id: "education",
    title: "Учёба",
    paid: true,
    en: [
      "school", "student", "teacher", "lesson", "class", "classroom", "homework", "exam", "test", "grade",
      "university", "college", "book", "notebook", "pen", "pencil", "paper", "read", "write", "study", "learn",
      "teach", "language", "word", "sentence", "dictionary", "library", "science", "math", "mathematics",
      "history", "geography", "art", "music", "knowledge", "question", "answer", "education", "pupil", "professor",
      "lecture", "course", "subject", "topic", "chapter", "page", "essay", "research", "experiment", "lab",
      "laboratory", "degree", "diploma", "certificate", "scholarship", "campus", "faculty", "department",
      "alphabet", "letter", "grammar", "spelling", "translate", "translation", "meaning", "example", "practice",
      "exercise", "mistake", "error", "correct", "wrong", "right", "smart", "clever", "stupid", "idea", "think",
      "memory", "remember", "forget", "understand", "explain", "describe", "discuss", "argue", "opinion",
      "academic", "academy", "curriculum", "encyclopedia", "graduate", "seminar", "examination",
      "homework", "notebook", "eraser", "ruler", "sharpener", "marker", "highlighter", "glue",
      "scissors", "backpack", "blackboard", "whiteboard", "chalk", "textbook", "workbook", "binder",
      "biology", "chemistry", "physics", "philosophy", "psychology", "literature", "elementary",
      "institute", "instruction", "instructor",
    ],
    ru: [
      "школа", "студент", "учитель", "урок", "класс", "домашнее", "экзамен", "оценка", "университет",
      "колледж", "книга", "тетрадь", "ручка", "карандаш", "бумага", "читать", "писать", "учить", "учиться",
      "язык", "слово", "предложение", "словарь", "библиотека", "наука", "математика", "история", "география",
      "знания", "вопрос", "ответ", "образование", "ученик", "профессор", "лекция",
    ],
  },
  {
    id: "sport",
    title: "Спорт",
    paid: true,
    en: [
      "sport", "game", "play", "player", "win", "lose", "score", "ball", "football", "soccer", "basketball",
      "tennis", "volleyball", "hockey", "golf", "swim", "swimming", "run", "jump", "throw", "catch", "race",
      "gym", "exercise", "fitness", "coach", "stadium", "match", "championship", "olympic", "olympics", "ski",
      "skate", "boxing", "wrestling", "cycling", "athlete", "champion", "medal", "cup", "goal", "kick", "pass",
      "team", "fan", "referee", "umpire", "training", "practice", "warmup", "stretch", "yoga", "dance", "dancer",
      "competition", "tournament", "league", "record", "finish", "start", "track", "field", "court", "pool",
      "net", "racket", "bat", "club", "helmet", "champion", "victory", "defeat", "draw", "tie",
      "baseball", "contest", "cycle", "fight", "hit", "ride", "running", "winner", "winning",
      "camp", "camping", "shot", "strike", "won", "score", "goal", "match", "race",
    ],
    ru: [
      "спорт", "игра", "играть", "игрок", "победа", "проигрыш", "счёт", "счет", "мяч", "футбол", "баскетбол",
      "теннис", "волейбол", "хоккей", "гольф", "плавать", "бегать", "прыгать", "гонка", "зал", "тренер",
      "стадион", "матч", "чемпионат", "олимпиада", "лыжи", "коньки", "атлет", "медаль", "гол",
    ],
  },
  {
    id: "feelings",
    title: "Чувства",
    paid: true,
    en: [
      "happy", "sad", "angry", "afraid", "scared", "love", "hate", "like", "feel", "feeling", "emotion", "smile",
      "laugh", "cry", "fear", "hope", "dream", "wish", "kind", "nice", "glad", "sorry", "proud", "jealous",
      "lonely", "bored", "excited", "surprised", "calm", "nervous", "brave", "shy", "funny", "interesting",
      "boring", "beautiful", "ugly", "joy", "happiness", "sadness", "anger", "worry", "anxious", "anxiety",
      "stress", "peace", "peaceful", "friendly", "polite", "rude", "honest", "lie", "truth", "trust", "respect",
      "shame", "guilt", "guilty", "pity", "sympathy", "empathy", "care", "miss", "enjoy", "pleasure", "pain",
      "comfort", "comfortable", "uncomfortable", "confident", "insecure", "optimistic", "pessimistic", "mood",
      "humour", "humor", "joke", "serious", "crazy", "mad", "upset", "disappointed", "satisfied", "grateful",
      "thankful", "please", "thank", "welcome", "hello", "goodbye", "bye",
      "amazing", "beauty", "believe", "confidence", "desire", "doubt", "faith", "famous", "favourite",
      "guess", "wonderful", "satisfaction", "soul", "success", "trouble", "wonder", "aware", "awareness",
      "behavior", "character", "mind", "thought", "vision", "hope", "fear",
    ],
    ru: [
      "счастливый", "грустный", "злой", "бояться", "любовь", "ненавидеть", "нравиться", "чувствовать",
      "чувство", "эмоция", "улыбка", "смеяться", "плакать", "страх", "надежда", "мечта", "добрый", "милый",
      "гордый", "скучать", "скучный", "весёлый", "веселый", "красивый", "радость", "счастье", "злость",
      "беспокойство", "спокойный", "храбрый", "стеснительный", "интересный",
    ],
  },
  {
    id: "time",
    title: "Время",
    paid: true,
    en: [
      "time", "clock", "hour", "minute", "second", "day", "night", "afternoon", "noon", "midnight", "week",
      "month", "year", "today", "tomorrow", "yesterday", "now", "soon", "late", "early", "always", "never",
      "often", "sometimes", "calendar", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
      "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
      "november", "december", "date", "birthday", "age", "old", "young", "past", "future", "present", "moment",
      "period", "century", "decade", "weekend", "weekday", "daily", "weekly", "monthly", "yearly", "once",
      "twice", "again", "still", "yet", "already", "before", "after", "during", "until", "since", "while",
      "then", "duration", "schedule", "temporary", "tonight", "season", "spring", "summer", "autumn", "winter",
    ],
    ru: [
      "время", "часы", "час", "минута", "секунда", "день", "ночь", "полдень", "полночь", "неделя", "месяц",
      "год", "сегодня", "завтра", "вчера", "сейчас", "поздно", "рано", "всегда", "никогда", "часто",
      "иногда", "календарь", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота",
      "воскресенье", "январь", "февраль", "число", "возраст", "прошлый", "будущее", "настоящее",
    ],
  },
  {
    id: "colors",
    title: "Цвета",
    paid: true,
    en: [
      "color", "colour", "red", "blue", "green", "yellow", "black", "white", "brown", "grey", "gray", "pink",
      "purple", "gold", "silver", "dark", "bright", "pale", "orange", "violet", "indigo", "turquoise", "beige",
      "navy", "crimson", "scarlet", "rainbow", "paint", "painter", "shade", "tint", "hue", "colourful", "colorful",
    ],
    ru: [
      "цвет", "красный", "синий", "голубой", "зелёный", "зеленый", "жёлтый", "желтый", "чёрный", "черный",
      "белый", "коричневый", "серый", "розовый", "фиолетовый", "золотой", "серебряный", "тёмный", "темный",
      "яркий", "оранжевый",
    ],
  },
  {
    id: "daily",
    title: "Повседневное",
    paid: true,
    en: [
      "morning", "evening", "toothbrush", "shower", "sleep", "wake", "family", "friend", "people", "person",
      "man", "woman", "child", "boy", "girl", "baby", "mother", "father", "brother", "sister", "parent", "son",
      "daughter", "husband", "wife", "uncle", "aunt", "grandmother", "grandfather", "name", "live", "life",
      "rest", "bath", "brush", "wash", "shop", "buy", "key", "home", "work", "go", "come", "get", "make", "take",
      "give", "see", "look", "hear", "know", "want", "need", "use", "find", "tell", "ask", "say", "speak", "talk",
      "walk", "sit", "stand", "wait", "open", "close", "start", "stop", "help", "try", "keep", "let", "put",
      "leave", "stay", "meet", "send", "city", "people", "everyone", "somebody", "anyone", "nobody", "something",
      "nothing", "everything", "today", "routine", "habit", "everyday", "usual", "normally", "please", "thanks",
      "yes", "no", "hello", "goodbye", "sorry", "excuse", "welcome", "friendship",
      "bag", "carry", "check", "choice", "routine", "habit", "anything", "event", "lifestyle",
      "thing", "everyday", "usual",
    ],
    ru: [
      "утро", "вечер", "душ", "спать", "просыпаться", "семья", "друг", "подруга", "люди", "человек",
      "мужчина", "женщина", "ребёнок", "ребенок", "мальчик", "девочка", "малыш", "мать", "отец", "брат",
      "сестра", "родитель", "сын", "дочь", "муж", "жена", "имя", "жить", "жизнь", "магазин", "покупать",
      "ключ", "дом", "идти", "приходить",
    ],
  },
  {
    id: "family",
    title: "Семья",
    paid: true,
    en: [
      "family", "mother", "father", "parent", "mom", "mum", "dad", "mama", "papa", "brother", "sister",
      "son", "daughter", "husband", "wife", "uncle", "aunt", "cousin", "nephew", "niece", "grandmother",
      "grandfather", "grandma", "grandpa", "grandchild", "grandson", "granddaughter", "relative", "relatives",
      "marriage", "married", "wedding", "wed", "couple", "twin", "baby", "child", "kid", "birth", "born",
      "anniversary", "adoption", "adopt", "household", "home", "generation", "ancestor", "orphan",
      "bride", "groom", "fiance", "fiancée", "partner", "relationship", "divorce", "widow", "widower",
    ],
    ru: [
      "семья", "мать", "отец", "мама", "папа", "родитель", "брат", "сестра", "сын", "дочь", "муж", "жена",
      "дядя", "тётя", "тетя", "двоюродный", "бабушка", "дедушка", "родственник", "свадьба", "брак",
      "ребёнок", "ребенок", "пара",
    ],
  },
  {
    id: "numbers",
    title: "Числа",
    paid: true,
    en: [
      "number", "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
      "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
      "million", "billion", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
      "ninth", "tenth", "half", "quarter", "pair", "double", "triple", "single", "amount", "average",
      "total", "sum", "plus", "minus", "percent", "percentage", "equal", "count", "calculate", "calculator",
      "measure", "measurement", "meter", "inch", "mile", "quantity", "numerous", "multiple", "few", "many",
      "most", "least", "less", "more", "much", "lot", "several", "both", "none", "all", "some", "any",
      "each", "every", "whole", "part", "half", "decimal", "digit", "integer", "fraction", "ratio", "rate",
    ],
    ru: [
      "число", "ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять",
      "сто", "тысяча", "миллион", "первый", "второй", "третий", "половина", "процент", "сумма", "количество",
    ],
  },
  {
    id: "places",
    title: "Город",
    paid: true,
    en: [
      "city", "town", "village", "capital", "place", "area", "zone", "region", "district", "suburb",
      "downtown", "neighborhood", "neighbourhood", "street", "road", "avenue", "boulevard", "square",
      "bridge", "tunnel", "building", "tower", "center", "centre", "local", "location", "address", "map",
      "block", "corner", "cross", "crossing", "path", "park", "garden", "museum", "library", "church",
      "cinema", "theater", "theatre", "stadium", "market", "mall", "shop", "store", "office", "factory",
      "hospital", "school", "university", "station", "airport", "harbor", "harbour", "port", "beach",
      "island", "coast", "river", "lake", "mountain", "forest", "country", "nation", "state", "province",
      "county", "urban", "rural", "site", "facility", "campus", "plaza", "alley", "lane", "highway",
      "motorway", "sidewalk", "pavement", "traffic", "parking", "entrance", "exit", "gate", "wall",
      "castle", "palace", "cathedral", "monument", "statue", "fountain", "playground", "zoo", "embassy",
      "court", "prison", "jail", "bank", "post", "postal", "cafe", "restaurant", "hotel", "hostel",
      "apartment", "house", "home", "nearby", "around", "outside", "inside", "here", "there", "where",
      "bay", "cape", "fort", "eastern", "northern", "northwest", "southern", "pacific", "marine",
      "regional", "distance", "base", "spot", "site", "area", "zone", "region",
      "anywhere", "somewhere", "everywhere", "nowhere", "visit", "visitor", "resident", "citizen",
    ],
    ru: [
      "город", "деревня", "столица", "место", "район", "улица", "площадь", "мост", "здание", "центр",
      "адрес", "парк", "музей", "церковь", "кинотеатр", "театр", "рынок", "магазин", "больница", "школа",
      "вокзал", "аэропорт", "берег", "страна", "область", "вход", "выход", "житель",
    ],
  },
  {
    id: "shopping",
    title: "Покупки",
    paid: true,
    en: [
      "shop", "shopping", "store", "market", "mall", "buy", "buyer", "sell", "seller", "purchase",
      "price", "cheap", "expensive", "cost", "pay", "payment", "cash", "card", "receipt", "change",
      "discount", "sale", "offer", "deal", "bargain", "cart", "basket", "bag", "pack", "package",
      "order", "delivery", "shipping", "return", "refund", "exchange", "customer", "consumer", "goods",
      "product", "item", "brand", "size", "fit", "try-on", "checkout", "queue", "line", "cashier",
      "counter", "shelf", "aisle", "wholesale", "retail", "vendor", "outlet", "luxury", "premium",
      "affordable", "free", "gift", "present", "warranty", "guarantee", "stock", "inventory", "catalogue",
      "catalog", "advertisement", "advertise", "commercial", "commerce", "trade", "merchant", "auction",
      "bid", "fee", "toll", "charge", "spend", "save", "saving", "coupon", "promo", "promotion",
    ],
    ru: [
      "магазин", "покупка", "покупать", "продавать", "цена", "дешёвый", "дешевый", "дорогой", "платить",
      "скидка", "распродажа", "корзина", "заказ", "доставка", "клиент", "товар", "кассир", "чек", "возврат",
    ],
  },
  {
    id: "health",
    title: "Здоровье",
    paid: true,
    en: [
      "health", "healthy", "unhealthy", "sick", "ill", "illness", "pain", "ache", "hurt", "injury",
      "wound", "doctor", "nurse", "hospital", "clinic", "medicine", "medical", "pill", "tablet", "dose",
      "fever", "cough", "cold", "flu", "virus", "bacteria", "disease", "cancer", "diabetes", "allergy",
      "asthma", "infection", "symptom", "treatment", "therapy", "cure", "recover", "recovery", "patient",
      "ambulance", "bandage", "surgery", "operation", "dentist", "dental", "pharmacy", "prescription",
      "diet", "nutrition", "vitamin", "protein", "exercise", "fitness", "energy", "tired", "sleep",
      "wake", "stress", "mental", "disability", "disabled", "pregnant", "pregnancy", "birth", "blood",
      "heart", "lung", "brain", "temperature", "pulse", "emergency", "aid", "first-aid", "vaccine",
      "injection", "scan", "x-ray", "test", "exam", "checkup", "prevention", "prevent", "safe", "safety",
      "hygiene", "soap", "wash", "clean", "dirty", "smoke", "smoking", "alcohol", "drug", "addiction",
      "massage", "spa", "wellness", "life", "death", "dead", "alive", "survive",
      "clinical", "oral", "relief", "treatment", "therapy", "mental", "physical",
    ],
    ru: [
      "здоровье", "здоровый", "больной", "болезнь", "боль", "врач", "медсестра", "больница", "клиника",
      "лекарство", "таблетка", "температура", "кашель", "рана", "скорая", "лечение", "пациент", "диета",
      "аптека", "прививка", "травма",
    ],
  },
  {
    id: "weather",
    title: "Погода",
    paid: true,
    en: [
      "weather", "climate", "forecast", "temperature", "degree", "hot", "warm", "cool", "cold", "heat",
      "freeze", "frozen", "melt", "rain", "rainy", "snow", "snowy", "wind", "windy", "storm", "thunder",
      "lightning", "cloud", "cloudy", "sun", "sunny", "sky", "fog", "foggy", "mist", "dew", "rainbow",
      "ice", "hail", "flood", "drought", "humidity", "humid", "dry", "wet", "damp", "breeze", "gale",
      "hurricane", "tornado", "blizzard", "season", "spring", "summer", "autumn", "fall", "winter",
      "sunset", "sunrise", "dawn", "dusk", "shadow", "shade", "umbrella", "coat", "boots",
    ],
    ru: [
      "погода", "климат", "прогноз", "жара", "тепло", "прохладно", "холод", "дождь", "снег", "ветер",
      "шторм", "гроза", "молния", "облако", "солнце", "туман", "радуга", "лёд", "лед", "наводнение",
      "засуха", "весна", "лето", "осень", "зима", "влажный", "сухой", "мокрый",
    ],
  },
  {
    id: "technology",
    title: "Технологии",
    paid: true,
    en: [
      "technology", "computer", "laptop", "desktop", "tablet", "phone", "smartphone", "mobile", "internet",
      "web", "website", "online", "offline", "email", "software", "hardware", "program", "programming",
      "code", "app", "application", "screen", "keyboard", "mouse", "printer", "file", "folder", "data",
      "database", "server", "network", "wifi", "wireless", "bluetooth", "password", "login", "user",
      "username", "download", "upload", "update", "upgrade", "install", "delete", "click", "link", "site",
      "browser", "browse", "search", "google", "digital", "electronic", "electronics", "device", "gadget",
      "chip", "processor", "memory", "disk", "drive", "battery", "cable", "charger", "adapter", "plug",
      "socket", "wireless", "signal", "satellite", "robot", "ai", "virtual", "video", "audio", "camera",
      "photo", "image", "icon", "button", "menu", "window", "system", "backup", "cloud", "hosting",
      "domain", "blog", "blogger", "forum", "chat", "message", "notification", "spam", "virus", "bug",
      "firewall", "privacy", "security", "hack", "cyber", "tech", "digital", "automatic", "robot",
      "machine", "engine", "electric", "electricity", "battery", "laser", "optical", "monitor", "display",
      "interface", "input", "output", "module", "protocol", "format", "version", "beta", "alpha", "demo",
      "zoom", "ipod", "router", "gateway", "node", "log", "debug", "pixel", "graphic", "graphics",
      "multimedia", "podcast", "stream", "streaming", "smartphone", "tablet", "console",
      "access", "accessibility", "accessible", "archive", "array", "avatar", "background", "banner",
      "bookmark", "broadband", "computing", "configuration", "controller", "default", "developer",
      "font", "implementation", "index", "infrastructure", "kernel", "keyword", "logo", "loop",
      "matrix", "null", "object", "operator", "patch", "portal", "ram", "register", "registration",
      "setup", "spyware", "storage", "subscription", "tab", "tag", "template", "thread", "unsubscribe",
      "wallpaper", "backup", "click", "download", "upload", "offline", "online", "username", "spam",
      "hosting", "domain", "format", "version", "beta", "alpha", "demo",
    ],
    ru: [
      "технология", "компьютер", "ноутбук", "телефон", "интернет", "сайт", "программа", "приложение",
      "экран", "клавиатура", "файл", "данные", "пароль", "скачать", "загрузить", "устройство", "батарея",
      "камера", "видео", "сеть", "сервер", "робот",
    ],
  },
  {
    id: "transport",
    title: "Транспорт",
    paid: true,
    en: [
      "transport", "transportation", "vehicle", "car", "bus", "train", "tram", "metro", "subway", "taxi",
      "plane", "airplane", "aircraft", "helicopter", "ship", "boat", "ferry", "bike", "bicycle", "motorcycle",
      "truck", "van", "lorry", "scooter", "drive", "driving", "driver", "ride", "passenger", "traffic",
      "road", "highway", "motorway", "street", "lane", "parking", "park", "garage", "station", "stop",
      "platform", "ticket", "fare", "route", "direction", "map", "wheel", "engine", "fuel", "gas", "petrol",
      "diesel", "speed", "fast", "slow", "brake", "seat", "belt", "helmet", "accident", "crash", "delay",
      "arrival", "departure", "transit", "journey", "trip", "travel", "aviation", "airline", "airport",
      "runway", "pilot", "captain", "crew", "cabin", "carriage", "wagon", "coach", "railway", "railroad",
      "pedestrian", "sidewalk", "crosswalk", "intersection", "roundabout", "bridge", "tunnel", "toll",
      "license", "licence", "automotive", "motor", "cycle", "cycling", "sail", "cruise", "port", "harbor",
      "harbour", "navigation", "compass", "north", "south", "east", "west",
    ],
    ru: [
      "транспорт", "машина", "автомобиль", "автобус", "поезд", "трамвай", "метро", "такси", "самолёт",
      "самолет", "корабль", "лодка", "велосипед", "мотоцикл", "грузовик", "водитель", "дорога", "пробка",
      "билет", "станция", "вокзал", "двигатель", "бензин", "скорость",
    ],
  },
  {
    id: "music",
    title: "Музыка",
    paid: true,
    en: [
      "music", "musical", "song", "sing", "singer", "album", "band", "concert", "festival", "guitar",
      "piano", "violin", "drum", "bass", "jazz", "rock", "pop", "opera", "orchestra", "choir", "melody",
      "rhythm", "lyric", "lyrics", "note", "tune", "sound", "audio", "speaker", "headphones", "radio",
      "record", "recording", "studio", "composer", "musician", "instrument", "play", "listen", "listening",
      "dance", "dancer", "dj", "hit", "track", "playlist", "karaoke", "voice", "chorus", "verse", "beat",
      "tempo", "symphony", "classical", "folk", "rap", "hip-hop", "acoustic", "electric", "amp", "microphone",
    ],
    ru: [
      "музыка", "песня", "петь", "певец", "альбом", "группа", "концерт", "гитара", "пианино", "рояль",
      "барабан", "джаз", "опера", "мелодия", "текст", "звук", "радио", "музыкант", "инструмент", "слушать",
    ],
  },
  {
    id: "art",
    title: "Искусство",
    paid: true,
    en: [
      "art", "artist", "paint", "painter", "painting", "drawing", "draw", "sketch", "design", "designer",
      "gallery", "museum", "exhibition", "sculpture", "statue", "photo", "photograph", "photography",
      "camera", "image", "picture", "portrait", "landscape", "color", "colour", "canvas", "brush",
      "creative", "creation", "create", "style", "fashion", "beauty", "beautiful", "ugly", "classic",
      "modern", "abstract", "antique", "vintage", "architecture", "architect", "pattern", "shape",
      "circle", "square", "triangle", "line", "graphic", "graphics", "illustration", "cartoon", "comics",
      "animation", "anime", "studio", "craft", "handmade", "pottery", "ceramic", "poem", "poetry", "poet",
      "literature", "novel", "fiction", "story", "author", "writer", "book", "publish", "publisher",
    ],
    ru: [
      "искусство", "художник", "картина", "рисовать", "рисунок", "дизайн", "галерея", "музей", "скульптура",
      "фото", "фотография", "камера", "творчество", "стиль", "архитектура", "поэзия", "роман", "писатель",
    ],
  },
  {
    id: "society",
    title: "Общество",
    paid: true,
    en: [
      "society", "social", "law", "legal", "illegal", "lawyer", "judge", "court", "justice", "crime",
      "criminal", "police", "officer", "prison", "jail", "rule", "right", "rights", "freedom", "free",
      "government", "governor", "president", "minister", "ministry", "parliament", "congress", "senate",
      "election", "vote", "voting", "politics", "political", "policy", "party", "nation", "national",
      "state", "citizen", "civil", "public", "community", "people", "population", "census", "democracy",
      "democratic", "republic", "king", "queen", "prince", "royal", "empire", "kingdom", "war", "peace",
      "army", "military", "soldier", "navy", "weapon", "gun", "attack", "defense", "defence", "battle",
      "conflict", "violence", "fight", "kill", "death", "murder", "steal", "theft", "fraud", "trial",
      "evidence", "witness", "claim", "contract", "tax", "duty", "union", "organization", "organisation",
      "committee", "council", "authority", "official", "leader", "leadership", "power", "force",
      "security", "safety", "protect", "protection", "human", "rights", "welfare", "poverty", "poor",
      "rich", "equality", "equal", "diversity", "culture", "cultural", "religion", "religious", "church",
      "faith", "god", "bible", "holy", "saint", "spirit", "spiritual", "volunteer", "charity", "help",
      "campaign", "protest", "reform", "constitution", "amendment", "legislation", "regulation",
      "enforcement", "investigation", "judge", "jury", "sentence", "guilty", "innocent", "legal",
      "abuse", "alliance", "assembly", "association", "award", "candidate", "certification", "chairman",
      "charter", "chief", "federal", "legislative", "majority", "membership", "mission", "organized",
      "owner", "ownership", "patent", "permission", "permit", "poll", "publication", "representative",
      "requirement", "revolution", "survey", "trademark", "vat", "committee", "council", "authority",
      "official", "leader", "union", "organization", "organisation",
    ],
    ru: [
      "общество", "закон", "право", "юрист", "судья", "суд", "преступление", "полиция", "тюрьма",
      "правительство", "президент", "выборы", "голосовать", "политика", "государство", "гражданин",
      "война", "мир", "армия", "солдат", "налог", "религия", "церковь",
    ],
  },
  {
    id: "cooking",
    title: "Готовка",
    paid: true,
    en: [
      "cook", "cooking", "chef", "recipe", "ingredient", "kitchen", "oven", "stove", "fridge", "freezer",
      "microwave", "pan", "pot", "bowl", "knife", "fork", "spoon", "plate", "cup", "glass", "boil",
      "fry", "bake", "roast", "grill", "steam", "mix", "cut", "chop", "slice", "peel", "stir", "pour",
      "taste", "flavour", "flavor", "spice", "herb", "salt", "pepper", "oil", "butter", "flour", "sugar",
      "sauce", "soup", "salad", "dough", "yeast", "oven", "timer", "heat", "burn", "raw", "fried",
      "boiled", "baked", "fresh", "delicious", "tasty", "bitter", "sweet", "sour", "spicy", "salty",
      "prepare", "preparation", "meal", "dish", "menu", "serve", "serving", "portion", "recipe",
    ],
    ru: [
      "готовить", "готовка", "повар", "рецепт", "ингредиент", "кухня", "духовка", "плита", "кипятить",
      "жарить", "печь", "варить", "смешивать", "резать", "специя", "соус", "блюдо",
    ],
  },
  {
    id: "supplies",
    title: "Канцелярия",
    paid: true,
    en: [
      "pen", "pencil", "eraser", "rubber", "ruler", "notebook", "notepad", "paper", "page", "sheet",
      "book", "folder", "file", "clip", "stapler", "staple", "glue", "tape", "scissors", "marker",
      "highlighter", "crayon", "chalk", "board", "whiteboard", "blackboard", "desk", "backpack", "bag",
      "case", "box", "envelope", "stamp", "letter", "mail", "post", "ink", "printer", "print", "copy",
      "scan", "label", "sticker", "card", "calendar", "diary", "planner", "note", "memo", "document",
      "binder", "hole", "punch", "sharpener", "compass", "protractor", "calculator", "supply", "stationery",
      "office", "kit", "tool", "brush", "paint",
    ],
    ru: [
      "ручка", "карандаш", "ластик", "линейка", "тетрадь", "бумага", "книга", "папка", "файл", "клей",
      "скотч", "ножницы", "маркер", "доска", "рюкзак", "конверт", "марка", "чернила", "принтер",
      "калькулятор", "канцелярия",
    ],
  },
  {
    id: "verbs",
    title: "Действия",
    paid: true,
    en: [
      "go", "come", "get", "make", "take", "give", "see", "look", "hear", "know", "want", "need", "use",
      "find", "tell", "ask", "say", "speak", "talk", "walk", "sit", "stand", "wait", "open", "close",
      "start", "stop", "help", "try", "keep", "let", "put", "leave", "stay", "meet", "send", "bring",
      "do", "be", "have", "begin", "end", "continue", "change", "move", "turn", "run", "jump", "fall",
      "rise", "grow", "build", "break", "fix", "cut", "add", "remove", "create", "destroy", "buy", "sell",
      "pay", "work", "play", "learn", "teach", "read", "write", "draw", "sing", "dance", "eat", "drink",
      "sleep", "wake", "wash", "clean", "cook", "drive", "fly", "ride", "carry", "hold", "push", "pull",
      "throw", "catch", "pick", "choose", "decide", "think", "remember", "forget", "understand", "explain",
      "show", "hide", "call", "answer", "listen", "watch", "feel", "touch", "smile", "laugh", "cry",
      "love", "hate", "like", "hope", "wish", "dream", "live", "die", "born", "win", "lose", "fight",
      "agree", "allow", "accept", "refuse", "offer", "receive", "return", "visit", "travel", "arrive",
      "enter", "exit", "join", "share", "save", "spend", "search", "seek", "follow", "lead", "serve",
      "prepare", "finish", "complete", "check", "test", "pass", "fail", "happen", "become", "seem",
      "appear", "remain", "stay", "keep", "let", "set", "put", "get", "make", "take",
      "achieve", "act", "affect", "aim", "alert", "approach", "assist", "assume", "attempt", "attend",
      "avoid", "blow", "cancel", "capture", "cause", "challenge", "compare", "conduct", "consider",
      "contain", "contribute", "control", "cover", "damage", "define", "deliver", "determine", "develop",
      "drop", "edit", "enable", "encourage", "enhance", "enlarge", "ensure", "establish", "exist",
      "expand", "expect", "fill", "filter", "focus", "found", "gain", "generate", "identify", "improve",
      "include", "increase", "indicate", "insert", "launch", "load", "maintain", "manage", "mention",
      "modify", "notify", "obtain", "occur", "operate", "participate", "perform", "produce", "promote",
      "provide", "pump", "raise", "reach", "reduce", "refer", "reflect", "repair", "replace", "represent",
      "request", "require", "reserve", "roll", "select", "sign", "skip", "split", "spread", "submit",
      "support", "treat", "wonder",
    ],
    ru: [
      "идти", "приходить", "делать", "брать", "давать", "видеть", "смотреть", "слышать", "знать",
      "хотеть", "нуждаться", "находить", "говорить", "спрашивать", "ждать", "открывать", "закрывать",
      "начинать", "останавливать", "помогать", "пробовать", "класть", "встречать", "приносить",
    ],
  },
  {
    id: "people",
    title: "Люди",
    paid: true,
    en: [
      "people", "person", "human", "man", "woman", "men", "women", "child", "boy", "girl", "baby", "kid",
      "adult", "teen", "teenager", "youth", "young", "old", "elderly", "gentleman", "lady", "sir", "madam",
      "friend", "stranger", "neighbor", "neighbour", "guest", "host", "crowd", "group", "team", "member",
      "individual", "someone", "somebody", "anyone", "everybody", "everyone", "nobody", "none",
      "male", "female", "gender", "name", "identity", "self", "myself", "yourself", "himself", "herself",
      "themselves", "our", "we", "they", "he", "she", "him", "her", "who", "whom", "whose", "someone",
      "amateur", "angel", "celebrity", "star", "hero", "leader", "boss", "worker", "student", "teacher", "doctor", "nurse",
      "engineer", "driver", "pilot", "farmer", "chef", "waiter", "artist", "actor", "actress", "writer",
      "author", "journalist", "scientist", "soldier", "police", "officer", "judge", "lawyer", "king",
      "queen", "prince", "princess", "baby", "twin", "generation", "population", "citizen", "resident",
    ],
    ru: [
      "люди", "человек", "мужчина", "женщина", "ребёнок", "ребенок", "мальчик", "девочка", "взрослый",
      "друг", "гость", "группа", "имя", "актёр", "актер", "учёный", "ученый", "журналист",
    ],
  },
  {
    id: "communication",
    title: "Общение",
    paid: true,
    en: [
      "talk", "speak", "say", "tell", "ask", "answer", "question", "reply", "call", "phone", "message",
      "text", "email", "letter", "mail", "post", "chat", "conversation", "discuss", "discussion", "debate",
      "argue", "opinion", "idea", "word", "sentence", "language", "translate", "meaning", "explain",
      "describe", "inform", "information", "news", "newspaper", "magazine", "article", "story", "report",
      "interview", "speech", "presentation", "announce", "announcement", "notice", "note", "comment",
      "feedback", "review", "recommend", "suggestion", "suggest", "advise", "advice", "warn", "warning",
      "promise", "lie", "truth", "honest", "secret", "whisper", "shout", "scream", "listen", "hear",
      "voice", "sound", "silence", "quiet", "loud", "contact", "connect", "connection", "network",
      "social", "media", "blog", "forum", "comment", "share", "like", "follow", "subscribe", "newsletter",
      "broadcast", "channel", "signal", "express", "expression", "communicate", "communication",
      "argument", "attention", "approval", "appeal", "comment", "feedback", "review", "statement",
      "request", "response", "quote", "mention", "notify", "notice", "announce", "publication",
    ],
    ru: [
      "говорить", "сказать", "спросить", "ответить", "вопрос", "звонок", "сообщение", "письмо", "чат",
      "разговор", "обсуждение", "новости", "статья", "речь", "совет", "информация", "общение",
    ],
  },
  {
    id: "money",
    title: "Деньги",
    paid: true,
    en: [
      "money", "cash", "coin", "bank", "account", "card", "credit", "debit", "loan", "debt", "pay",
      "payment", "salary", "wage", "income", "earn", "earnings", "spend", "save", "saving", "budget",
      "price", "cost", "cheap", "expensive", "rich", "poor", "wealth", "profit", "loss", "tax", "fee",
      "bill", "invoice", "receipt", "change", "dollar", "euro", "pound", "currency", "exchange", "rate",
      "interest", "percent", "investment", "invest", "investor", "stock", "share", "fund", "funding",
      "capital", "asset", "property", "mortgage", "deposit", "withdraw", "transfer", "transaction",
      "atm", "wallet", "purse", "safe", "value", "worth", "afford", "affordable", "discount", "refund",
      "insurance", "pension", "retirement", "bankrupt", "economy", "economic", "finance", "financial",
      "fiscal", "revenue", "equity", "bonus", "tip", "donate", "donation", "charity", "poverty",
      "benefit", "compensation", "grant", "fund", "funding", "profit", "loss", "asset", "balance",
      "bond", "sterling", "cent", "vat", "fee", "toll",
    ],
    ru: [
      "деньги", "наличные", "монета", "банк", "счёт", "счет", "карта", "кредит", "долг", "платить",
      "зарплата", "доход", "экономить", "бюджет", "цена", "налог", "доллар", "евро", "валюта", "инвестиция",
    ],
  },
  {
    id: "science",
    title: "Наука",
    paid: true,
    en: [
      "science", "scientific", "scientist", "research", "experiment", "lab", "laboratory", "theory",
      "hypothesis", "proof", "evidence", "discovery", "discover", "invent", "invention", "physics",
      "chemistry", "biology", "math", "mathematics", "geometry", "algebra", "statistics", "atom", "molecule",
      "cell", "gene", "genetic", "dna", "energy", "force", "mass", "weight", "gravity", "speed", "light",
      "sound", "heat", "electric", "electricity", "magnet", "magnetic", "chemical", "acid", "oxygen",
      "carbon", "hydrogen", "water", "air", "gas", "liquid", "solid", "metal", "iron", "steel", "gold",
      "silver", "plastic", "material", "element", "compound", "reaction", "formula", "equation", "number",
      "measure", "unit", "scale", "telescope", "microscope", "planet", "star", "space", "universe",
      "galaxy", "earth", "moon", "sun", "evolution", "nature", "environment", "ecology", "climate",
      "nuclear", "radiation", "laser", "robot", "technology", "engineer", "engineering", "data", "analysis",
      "observe", "observation", "result", "conclusion", "method", "process", "system", "model",
      "biological", "biology", "molecular", "density", "crystal", "gamma", "plasma", "resistance",
      "analysis", "data", "logic", "mechanism", "phase", "scale", "unit",
    ],
    ru: [
      "наука", "учёный", "ученый", "исследование", "эксперимент", "лаборатория", "теория", "открытие",
      "физика", "химия", "биология", "математика", "атом", "клетка", "энергия", "кислота", "планета",
      "космос", "вселенная",
    ],
  },
  {
    id: "media",
    title: "Кино и СМИ",
    paid: true,
    en: [
      "movie", "film", "cinema", "theater", "theatre", "actor", "actress", "star", "scene", "plot",
      "director", "camera", "video", "tv", "television", "show", "series", "episode", "season", "channel",
      "broadcast", "news", "newspaper", "magazine", "journal", "press", "media", "radio", "podcast",
      "internet", "blog", "youtube", "stream", "streaming", "audience", "viewer", "watch", "screen",
      "comedy", "drama", "horror", "action", "romance", "thriller", "documentary", "cartoon", "animation",
      "anime", "comics", "book", "novel", "story", "fiction", "fantasy", "mystery", "adventure",
      "entertainment", "celebrity", "famous", "premiere", "trailer", "poster", "ticket", "seat",
      "biography", "genre", "stage", "scene", "cast", "edition", "editorial", "chart", "collection",
      "headline", "article", "interview", "reporter", "journalist", "editor", "publisher", "publish",
      "advertisement", "commercial", "sponsor", "program", "programme", "host", "guest", "live",
    ],
    ru: [
      "фильм", "кино", "кинотеатр", "актёр", "актер", "актриса", "сцена", "режиссёр", "режиссер",
      "телевидение", "шоу", "сериал", "серия", "новости", "газета", "журнал", "радио", "зритель",
      "комедия", "драма",
    ],
  },
  {
    id: "grammar",
    title: "Грамматика",
    paid: true,
    en: [
      "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his",
      "its", "our", "their", "mine", "yours", "hers", "ours", "theirs", "myself", "yourself", "himself",
      "herself", "itself", "ourselves", "themselves", "this", "that", "these", "those", "who", "whom",
      "whose", "which", "what", "where", "when", "why", "how", "whether", "whatever", "whoever",
      "and", "or", "but", "because", "if", "although", "though", "while", "since", "until", "unless",
      "so", "than", "as", "of", "in", "on", "at", "to", "for", "from", "with", "without", "by", "about",
      "above", "below", "under", "over", "into", "onto", "upon", "through", "across", "along", "around",
      "between", "among", "behind", "beyond", "near", "off", "out", "up", "down", "inside", "outside",
      "within", "against", "during", "before", "after", "except", "despite", "via", "per", "plus",
      "a", "an", "the", "some", "any", "no", "not", "none", "every", "each", "all", "both", "either",
      "neither", "few", "many", "much", "more", "most", "less", "least", "other", "another", "same",
      "such", "own", "very", "too", "also", "even", "just", "only", "almost", "already", "still", "yet",
      "never", "always", "often", "sometimes", "here", "there", "now", "then", "once", "again",
      "yes", "yeah", "no", "not", "maybe", "perhaps", "probably", "really", "actually", "especially",
      "however", "therefore", "thus", "instead", "indeed", "else", "otherwise", "anyway", "quite",
      "rather", "enough", "almost", "nearly", "exactly", "certainly", "sure", "of-course",
      "can", "could", "may", "might", "must", "shall", "should", "will", "would", "do", "does", "did",
      "have", "has", "had", "be", "am", "is", "are", "was", "were", "been", "being",
    ],
    ru: [
      "я", "ты", "он", "она", "мы", "они", "мой", "твой", "его", "её", "наш", "их", "этот", "тот",
      "кто", "что", "где", "когда", "почему", "как", "и", "или", "но", "если", "потому", "в", "на",
      "к", "от", "с", "без", "для", "из", "о", "да", "нет", "уже", "ещё", "еще", "всегда", "никогда",
    ],
  },
  {
    id: "descriptions",
    title: "Описание",
    paid: true,
    en: [
      "big", "small", "large", "little", "huge", "tiny", "long", "short", "tall", "high", "low", "wide",
      "narrow", "thick", "thin", "deep", "shallow", "heavy", "light", "hard", "soft", "strong", "weak",
      "fast", "slow", "quick", "early", "late", "new", "old", "young", "fresh", "stale", "hot", "cold",
      "warm", "cool", "wet", "dry", "clean", "dirty", "full", "empty", "open", "closed", "free", "busy",
      "easy", "difficult", "hard", "simple", "complex", "good", "bad", "better", "best", "worse", "worst",
      "great", "fine", "nice", "beautiful", "ugly", "pretty", "handsome", "smart", "stupid", "clever",
      "kind", "rude", "polite", "friendly", "happy", "sad", "angry", "calm", "quiet", "loud", "bright",
      "dark", "clear", "true", "false", "real", "fake", "right", "wrong", "correct", "possible", "able",
      "ready", "sure", "certain", "important", "necessary", "useful", "useless", "special", "normal",
      "usual", "strange", "common", "rare", "unique", "popular", "famous", "unknown", "main", "basic",
      "primary", "secondary", "general", "specific", "exact", "approximate", "complete", "whole", "partial",
      "safe", "dangerous", "rich", "poor", "expensive", "cheap", "public", "private", "local", "global",
      "national", "international", "modern", "ancient", "traditional", "classic", "natural", "artificial",
      "physical", "mental", "personal", "official", "legal", "illegal", "positive", "negative", "active",
      "passive", "direct", "available", "busy", "free", "similar", "different", "same", "other", "next",
      "last", "first", "final", "original", "typical", "regular", "extra", "additional", "enough",
      "serious", "funny", "interesting", "boring", "amazing", "wonderful", "terrible", "excellent",
      "perfect", "poor", "rich", "lucky", "unlucky", "healthy", "sick", "alive", "dead", "alone",
      "together", "near", "far", "close", "distant", "left", "right", "top", "bottom", "upper", "lower",
      "inner", "outer", "front", "back", "central", "middle", "side", "straight", "round", "flat",
      "sharp", "smooth", "rough", "solid", "liquid", "empty", "full", "broken", "fixed", "new", "used",
      "absolutely", "accurate", "actual", "advanced", "alternative", "annual", "anonymous", "applicable",
      "appropriate", "available", "bold", "broad", "compact", "compatible", "competitive", "comprehensive",
      "concerned", "consistent", "constant", "contemporary", "continuous", "critical", "custom", "dedicated",
      "detailed", "determined", "domestic", "dual", "dynamic", "effective", "efficient", "eligible",
      "entire", "equivalent", "exclusive", "existing", "expected", "experienced", "extended", "extensive",
      "external", "extreme", "extremely", "flexible", "focused", "formal", "former", "fully", "generic",
      "grand", "helpful", "hidden", "historic", "historical", "ideal", "immediate", "immediately",
      "independent", "industrial", "initial", "innovative", "instant", "integrated", "intellectual",
      "interactive", "internal", "involved", "limited", "linear", "major", "massive", "maximum",
      "mechanical", "minimum", "minor", "native", "optional", "outstanding", "overall", "parallel",
      "particular", "particularly", "permanent", "portable", "potential", "powerful", "practical",
      "preferred", "prior", "proper", "properly", "pure", "qualified", "random", "reasonable", "recent",
      "recently", "related", "relevant", "reliable", "remote", "responsible", "reverse", "secure",
      "senior", "sensitive", "separate", "significant", "significantly", "simply", "slightly", "stable",
      "standard", "static", "strategic", "successful", "successfully", "sufficient", "suitable", "super",
      "superior", "supreme", "sustainable", "technical", "truly", "ultimate", "unable", "universal",
      "unlimited", "valid", "variable", "visual", "western", "worldwide", "written", "ahead", "away",
      "easily", "ever", "eventually", "further", "later", "previously", "primarily", "recently",
    ],
    ru: [
      "большой", "маленький", "длинный", "короткий", "высокий", "низкий", "тяжёлый", "тяжелый", "лёгкий",
      "легкий", "быстрый", "медленный", "новый", "старый", "молодой", "хороший", "плохой", "лучший",
      "важный", "простой", "сложный", "лёгкий", "трудный", "похожий", "разный",
    ],
  },
];

const GENERAL: ThemeSpec = {
  id: "general",
  title: "Общее",
  paid: true,
  en: [],
  ru: [],
};

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanRu(raw: string): string | undefined {
  let value = decodeXml(raw);
  value = value.replace(WIKI_LINK, "$1");
  value = value.replace(/\u0301/g, "").replace(/\u0300/g, "");
  value = value.replace(/[[\]{}*_]+/g, "");
  value = value.replace(/\s+/g, " ").replace(/^[ .,;:—–·-]+|[ .,;:—–·-]+$/g, "");
  if (!value || !CYRILLIC.test(value) || value.length > 32) return undefined;
  if (LATIN.test(value) && value.length > 24) return undefined;
  if (RU_SKIP.test(value)) return undefined;
  return value;
}

function stems(word: string): string[] {
  const out = new Set<string>([word]);
  const add = (value: string) => {
    if (value.length >= 2) out.add(value);
  };
  const addBase = (base: string) => {
    add(base);
    add(`${base}e`);
    if (base.length >= 4 && /(.)\1$/.test(base)) add(base.slice(0, -1));
  };
  if (word.endsWith("ies") && word.length > 5) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 4) add(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) add(word.slice(0, -1));
  if (word.endsWith("ing") && word.length > 5) addBase(word.slice(0, -3));
  if (word.endsWith("ed") && word.length > 4) {
    addBase(word.slice(0, -2));
    add(word.slice(0, -1));
  }
  if (word.endsWith("ly") && word.length > 4) add(word.slice(0, -2));
  if (word.endsWith("er") && word.length > 5) addBase(word.slice(0, -2));
  if (word.endsWith("est") && word.length > 5) addBase(word.slice(0, -3));
  return [...out];
}

function slug(en: string): string {
  return en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "word";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status} ${url}`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

async function loadCuratedThemes(): Promise<CuratedTheme[]> {
  if (!existsSync(seedsDir)) return [];
  const files = (await readdir(seedsDir)).filter((name) => name.endsWith(".json")).sort();
  const themes: CuratedTheme[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(seedsDir, file), "utf8")) as CuratedTheme;
    if (!raw.id || !raw.title || !Array.isArray(raw.words) || raw.words.length === 0) {
      throw new Error(`Invalid curated seed ${file}`);
    }
    themes.push({
      id: raw.id,
      title: raw.title,
      paid: raw.paid !== false,
      words: raw.words.map((word) => ({
        en: word.en.trim(),
        ru: unique(word.ru ?? []).slice(0, 3),
        example: word.example?.trim() ?? "",
      })),
    });
  }
  return themes;
}

async function ensureSources(): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  if (!existsSync(TEI_PATH)) {
    const tarPath = join(sourceDir, FREEDICT_TAR);
    if (!existsSync(tarPath)) {
      console.info(`downloading ${FREEDICT_URL}`);
      await download(FREEDICT_URL, tarPath);
    }
    console.info("extracting FreeDict source");
    execFileSync("tar", ["-xJf", tarPath, "-C", sourceDir], { stdio: "inherit" });
  }
  if (!existsSync(COMMON_PATH)) {
    console.info(`downloading ${COMMON_URL}`);
    await download(COMMON_URL, COMMON_PATH);
  }
}

function parseTei(tei: string): Map<string, { en: string; ru: string[] }> {
  const merged = new Map<string, { en: string; ru: string[] }>();
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(tei))) {
    const chunk = match[1];
    const orth = chunk.match(/<orth>([^<]+)<\/orth>/)?.[1];
    if (!orth) continue;
    const pos = chunk.match(/<pos>([^<]+)<\/pos>/)?.[1] ?? "";
    if (!OK_POS.has(pos)) continue;
    const orthRaw = decodeXml(orth).trim();
    if (/^[A-Z]/.test(orthRaw)) continue;
    const en = orthRaw.toLowerCase();
    if (SKIP_HEAD.has(en) || !HEADWORD.test(en) || en.length < 2 || en.length > 20) continue;
    if (en.length === 2 && !TWO_LETTER.has(en)) continue;

    const translations: string[] = [];
    const parts = chunk.split(/<cit type="trans"[^>]*>/);
    let keptCits = 0;
    for (const part of parts.slice(1)) {
      const end = part.indexOf("</cit>");
      if (end < 0) continue;
      const quotesXml = part.slice(0, end);
      const rest = part.slice(end);
      const nextCit = rest.indexOf('<cit type="trans"');
      const region = nextCit < 0 ? rest : rest.slice(0, nextCit);
      const defs = [...region.matchAll(/<def>([\s\S]*?)<\/def>/g)].map((item) => item[1]);
      if (defs.some((def) => SLANG.test(def))) continue;
      const quotes: string[] = [];
      for (const quote of quotesXml.matchAll(/<quote>([\s\S]*?)<\/quote>/g)) {
        const cleaned = cleanRu(quote[1]);
        if (cleaned) quotes.push(cleaned);
      }
      if (quotes.length === 0) continue;
      translations.push(...quotes);
      keptCits += 1;
      if (keptCits >= 2) break;
    }
    const ru = unique(translations).slice(0, 3);
    if (ru.length === 0) continue;
    const existing = merged.get(en);
    if (existing) existing.ru = unique([...existing.ru, ...ru]).slice(0, 3);
    else merged.set(en, { en, ru });
  }
  return merged;
}

function buildLookups(themes: ThemeSpec[]) {
  return themes.map((theme) => ({
    id: theme.id,
    title: theme.title,
    paid: theme.paid,
    en: new Set(theme.en.map((word) => word.toLowerCase())),
    ru: new Set(theme.ru.map((word) => word.toLowerCase())),
  }));
}

function englishHits(en: string, keywords: Set<string>): boolean {
  const compact = en.replace(/-/g, "");
  const candidates = new Set(stems(compact));
  candidates.add(en);
  candidates.add(compact);
  for (const candidate of candidates) {
    if (keywords.has(candidate)) return true;
  }
  for (const keyword of keywords) {
    if (keyword.length >= 7 && compact.startsWith(keyword)) return true;
  }
  return false;
}

function classifyThemes(en: string, ru: string[], lookups: ReturnType<typeof buildLookups>): string[] {
  const matches: string[] = [];
  for (const lookup of lookups) {
    let hit = englishHits(en, lookup.en);
    if (!hit) {
      for (const translation of ru.slice(0, 2)) {
        if (lookup.ru.has(translation.toLowerCase())) {
          hit = true;
          break;
        }
      }
    }
    if (hit) matches.push(lookup.id);
  }
  return matches;
}

async function main(): Promise<void> {
  await ensureSources();
  const curatedThemes = await loadCuratedThemes();
  const exclusionsRaw = existsSync(exclusionsPath)
    ? (JSON.parse(await readFile(exclusionsPath, "utf8")) as { remove?: Record<string, string[]> })
    : { remove: {} };
  const themeExclusions = new Map<string, Set<string>>(
    Object.entries(exclusionsRaw.remove ?? {}).map(([themeId, ids]) => [themeId, new Set(ids)]),
  );
  const tei = await readFile(TEI_PATH, "utf8");
  const commonList = (await readFile(COMMON_PATH, "utf8"))
    .split(/\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const common = new Set(commonList);
  const commonRank = new Map(commonList.map((word, index) => [word, index]));
  const GENERAL_MAX_RANK = 4000;
  const parsed = parseTei(tei);
  const lookups = buildLookups(THEMES);
  const keywordEnglish = new Set(THEMES.flatMap((theme) => theme.en.map((word) => word.toLowerCase())));
  const englishKeyword = (en: string) => englishHits(en, keywordEnglish);
  const catalog = new Map<string, DictWord>();
  const buckets = new Map<string, DictWord[]>();
  const curatedIds = new Set(curatedThemes.map((theme) => theme.id));

  function ensureWord(en: string, ru: string[], example: string): DictWord {
    const id = slug(en);
    const existing = catalog.get(id);
    if (existing) {
      existing.ru = unique([...existing.ru, ...ru]).slice(0, 3);
      if (!existing.example && example) existing.example = example;
      return existing;
    }
    const word: DictWord = { id, en, ru: unique(ru).slice(0, 3), example };
    catalog.set(id, word);
    return word;
  }

  function addToTheme(themeId: string, word: DictWord) {
    if (themeExclusions.get(themeId)?.has(word.id)) return;
    const list = buckets.get(themeId) ?? [];
    if (list.some((item) => item.id === word.id)) return;
    list.push(word);
    buckets.set(themeId, list);
  }

  function preferThemeRu(ru: string[], themeIds: string[]): string[] {
    const lookup = lookups.find((item) => themeIds.includes(item.id));
    if (!lookup) return unique(ru);
    return unique(
      [...ru].sort((a, b) => {
        const as = lookup.ru.has(a.toLowerCase()) ? 0 : 1;
        const bs = lookup.ru.has(b.toLowerCase()) ? 0 : 1;
        return as - bs;
      }),
    );
  }

  for (const seed of SEEDS) {
    const extra = parsed.get(seed.word.en.toLowerCase());
    const ru = unique([...seed.word.ru, ...(extra?.ru ?? [])]).slice(0, 3);
    const word = ensureWord(seed.word.en, ru, seed.word.example);
    const matched = classifyThemes(word.en, word.ru, lookups).filter((id) => id !== GENERAL.id);
    for (const themeId of new Set([seed.themeId, ...matched])) addToTheme(themeId, word);
  }

  const include: { en: string; ru: string[] }[] = [];
  for (const item of parsed.values()) {
    if (catalog.has(slug(item.en))) continue;
    if (common.has(item.en) || englishKeyword(item.en)) include.push(item);
  }
  include.sort((a, b) => a.en.localeCompare(b.en));

  for (const item of include) {
    const rank = commonRank.get(item.en);
    const topicIds = classifyThemes(item.en, item.ru, lookups).filter((id) => id !== GENERAL.id);
    if (topicIds.length === 0) {
      if (rank === undefined || rank >= GENERAL_MAX_RANK) continue;
      addToTheme(GENERAL.id, ensureWord(item.en, item.ru, ""));
      continue;
    }
    if (!englishKeyword(item.en) && (rank === undefined || rank >= GENERAL_MAX_RANK)) continue;
    const word = ensureWord(item.en, preferThemeRu(item.ru, topicIds), "");
    for (const themeId of topicIds) addToTheme(themeId, word);
  }

  // Curated themes (connectors, irregular principal parts, popular verbs).
  // Seed Russian glosses win over FreeDict noise for shared lemmas.
  const curatedOrder = new Map<string, number>();
  for (const curated of curatedThemes) {
    curated.words.forEach((item, index) => {
      const id = slug(item.en);
      if (!curatedOrder.has(id)) curatedOrder.set(id, index);
      const lemma = curatedLemma(item.en);
      const fromDict = parsed.get(lemma);
      const ru =
        item.ru.length > 0
          ? unique(item.ru).slice(0, 3)
          : unique(fromDict?.ru ?? []).slice(0, 3);
      const word = ensureWord(item.en, ru, item.example ?? "");
      word.ru = ru;
      // Keep principal-parts spelling from the seed even if id already existed.
      if (item.en.includes(" / ")) word.en = item.en;
      addToTheme(curated.id, word);
      // Lemmas without forms also join FreeDict topic themes when they hit.
      if (!item.en.includes(" / ")) {
        const matched = classifyThemes(word.en, word.ru, lookups).filter((tid) => tid !== GENERAL.id);
        for (const themeId of matched) addToTheme(themeId, word);
      }
    });
  }

  const curatedSpecs: ThemeSpec[] = curatedThemes.map((theme) => ({
    id: theme.id,
    title: theme.title,
    paid: theme.paid,
    en: [],
    ru: [],
  }));
  const specs = [...THEMES, ...curatedSpecs, GENERAL];
  await mkdir(themesDir, { recursive: true });
  for (const name of await readdir(themesDir)) {
    if (name.endsWith(".json")) await unlink(join(themesDir, name));
  }

  let listings = 0;
  const summary: string[] = [];
  const seedOrder = new Map(SEEDS.map((seed, index) => [slug(seed.word.en), index]));
  const written = new Set<string>();
  for (const spec of specs) {
    const words = buckets.get(spec.id) ?? [];
    if (words.length === 0) continue;
    if (words.length < 12 && spec.id !== "travel" && !curatedIds.has(spec.id)) {
      const general = buckets.get(GENERAL.id) ?? [];
      for (const word of words) {
        if (!general.some((item) => item.id === word.id)) general.push(word);
      }
      buckets.set(GENERAL.id, general);
      buckets.delete(spec.id);
      summary.push(`${spec.id}: merged into general (${words.length})`);
      continue;
    }
    words.sort((a, b) => {
      if (curatedIds.has(spec.id)) {
        const ao = curatedOrder.get(a.id);
        const bo = curatedOrder.get(b.id);
        if (ao !== undefined && bo !== undefined) return ao - bo;
        if (ao !== undefined) return -1;
        if (bo !== undefined) return 1;
      }
      const as = seedOrder.get(a.id);
      const bs = seedOrder.get(b.id);
      if (as !== undefined && bs !== undefined) return as - bs;
      if (as !== undefined) return -1;
      if (bs !== undefined) return 1;
      return a.en.localeCompare(b.en);
    });
    const theme = { id: spec.id, title: spec.title, paid: spec.paid, words };
    await writeFile(join(themesDir, `${spec.id}.json`), `${JSON.stringify(theme, null, 2)}\n`);
    written.add(spec.id);
    listings += words.length;
    summary.push(`${spec.id}: ${words.length}`);
  }

  const uniqueIds = new Set(
    [...written].flatMap((id) => (buckets.get(id) ?? []).map((word) => word.id)),
  );
  console.info(
    `wrote ${written.size} themes, ${uniqueIds.size} unique words (${listings} listings, ${listings - uniqueIds.size} overlaps)`,
  );
  for (const line of summary) console.info(`  ${line}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
