/**
 * Classroom CEFR overrides. Google-10k frequency misses many A1/A2 lemmas
 * (eighteen, grandmother, rainy, sofa, hers…) and dumps them into C2.
 *
 * Used by `tag-cefr-and-blocks.ts` so a future retag does not revert these.
 * Only high-confidence A1/A2 (and a few B1 numerals). Borderline B1/B2 stays on frequency.
 */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export function lemma(en: string): string {
  const head = en.split(/\s*\/\s*/)[0]?.trim() ?? en;
  return head.toLowerCase().replace(/[^a-z-]+/g, " ").trim().split(/\s+/)[0] ?? head;
}

function bag(text: string): Set<string> {
  return new Set(text.trim().split(/\s+/).filter(Boolean));
}

const NUMBER_A1 = bag(`
  zero one two three four five six seven eight nine ten
  eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty
  thirty forty fifty sixty seventy eighty ninety
  hundred thousand million billion
  first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth
  half pair number once twice
`);

const NUMBER_A2 = bag(`
  thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth
  thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth
  hundredth thousandth millionth billionth dozen score minus plus
`);

const NUMBER_B1 = bag(`
  firstly secondly thirdly fourthly fifthly sixthly seventhly
  twenties thirties forties fifties sixties seventies eighties nineties
  digit decimal fraction integer percent percentage
`);

/** Classroom CEFR for numerals — frequency lists miss eighteen/ninety and dump them into C2. */
export function numberLevel(en: string): CefrLevel | null {
  const w = lemma(en);
  if (NUMBER_A1.has(w)) return "A1";
  if (NUMBER_A2.has(w)) return "A2";
  if (NUMBER_B1.has(w)) return "B1";
  if (/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-[a-z]+$/.test(w)) return "A2";
  return null;
}

const A1 = bag(`
  ${[...NUMBER_A1].join(" ")}
  colour color red blue green yellow black white brown grey gray pink orange
  dark light bright gold silver
  family mother father parent mom mum dad mama papa brother sister son daughter
  husband wife baby child kid uncle aunt cousin grandmother grandfather grandma grandpa
  hello goodbye please thanks thank sorry welcome yes no
  toothbrush
  i you he she it we they me him her us them my your his its our their
  mine yours this that these those who what where when why how
  and or but because if so
  today tomorrow yesterday now day night morning evening afternoon week month year
  hour minute second time clock monday tuesday wednesday thursday friday saturday sunday
  january february march april may june july august september october november december
  birthday weekend today
  head hair eye ear nose mouth tooth face neck arm hand finger leg foot back body
  lip
  clothes shirt trousers pants dress skirt shoes hat coat jacket socks jeans wear
  umbrella
  food apple banana bread breakfast lunch dinner butter cake cheese chicken coffee
  egg fish fruit meat milk potato rice salad sandwich sugar tea tomato vegetable
  water hungry meal cook kitchen restaurant menu delicious
  sofa chair table bed door window floor wall house home apartment room kitchen
  bathroom bedroom garden fridge refrigerator cupboard curtain pillow blanket sink
  stairs towel neighbour neighbor
  rain snow sun cloud wind hot cold warm cool weather
  doctor hospital nurse medicine sick ill hurt
  go come see look want need have be do make take give get know think say tell
  ask like love work live play walk sit stand open close start stop help eat drink
  sleep wake wash
`);

const A2 = bag(`
  ${[...NUMBER_A2].join(" ")}
  beige violet turquoise indigo purple navy colourful colorful brightly pale
  golden rainbow
  grandchild granddaughter grandson grandparent nephew niece relative relatives
  married wedding divorced childhood habit
  hers ours theirs myself yourself himself herself itself ourselves themselves
  whoever whatever whom whose
  weekday yearly hourly nightly
  ankle beard belly breathe breathing cheek chin elbow eyebrow eyelash forehead
  headache jaw moustache mustache stomach thumb waist wrist heel knee shoulder
  throat brain bone blood heart skin muscle chest toe nail
  blouse scarf sweater tights vest raincoat pajamas pyjamas hoodie collar jumper
  fashionable purse wallet wool belt boots gloves pocket button underwear tie
  uniform silk cotton cloak robe overcoat
  mango melon mushroom pancake pea peach pear sausage snack spoon steak strawberry
  thirsty toast yogurt yoghurt waffle watermelon peanut porridge salty spicy sweets
  waiter waitress napkin noodle soda sour spice ingredient onion pasta pork
  banana
  armchair attic balcony basement broom bucket chimney couch curtains cushion
  drawer faucet fence fireplace garbage housework mattress pillow sofa stove
  tidy trash vase wardrobe cooker couch lamp shelf mirror carpet key lock
  furniture
  rainy snowy fog foggy freeze freezing humid lightning thunder thunderstorm
  sunrise umbrella damp breeze hail mist dusk melt tornado blizzard drought
  sunny cloudy windy storm forecast temperature season spring summer autumn winter
  ache ambulance bandage cough dentist allergy asthma hygiene symptom vaccine
  wound healthy exercise fever pain pill
  goodbye
`);

const B1 = bag(`
  ${[...NUMBER_B1].join(" ")}
  crimson scarlet hue
  ancestor adulthood
  tornado blizzard drought humidity
`);

const LEVELS: { level: CefrLevel; words: Set<string> }[] = [
  { level: "A1", words: A1 },
  { level: "A2", words: A2 },
  { level: "B1", words: B1 },
];

/**
 * Pedagogical CEFR for classroom lemmas. Returns null to fall back to frequency.
 * Hyphenated numerals (seventy-eight) are handled via numberLevel.
 */
export function pedagogicalLevel(en: string): CefrLevel | null {
  const numbered = numberLevel(en);
  if (numbered) return numbered;
  const w = lemma(en);
  for (const { level, words } of LEVELS) {
    if (words.has(w)) return level;
  }
  return null;
}
