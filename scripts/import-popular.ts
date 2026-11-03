import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dict = resolve(root, "data/en/themes");

type Item = {
  id: string;
  title: string;
  year: number;
  imdb?: string;
  query?: string;
};

/** 2026 worldwide box office + current IMDb buzz. English-language titles with OS coverage. */
const ITEMS: Item[] = [
  { id: "spider-man-brand-new-day", title: "Spider-Man: Brand New Day", year: 2026, imdb: "22084616" },
  { id: "the-odyssey", title: "The Odyssey", year: 2026, imdb: "41605854" },
  { id: "toy-story-5", title: "Toy Story 5", year: 2026, imdb: "29355505" },
  { id: "michael", title: "Michael", year: 2026, imdb: "11378946" },
  { id: "super-mario-galaxy", title: "The Super Mario Galaxy Movie", year: 2026, imdb: "28650488" },
  { id: "devil-wears-prada-2", title: "The Devil Wears Prada 2", year: 2026, imdb: "33612209" },
  { id: "project-hail-mary", title: "Project Hail Mary", year: 2026, imdb: "12042730" },
  { id: "minions-and-monsters", title: "Minions & Monsters", year: 2026, imdb: "32890033" },
  { id: "obsession", title: "Obsession", year: 2025, imdb: "37287335" },
  { id: "backrooms", title: "Backrooms", year: 2026, imdb: "26657236" },
  { id: "hoppers", title: "Hoppers", year: 2026, imdb: "26443616" },
  { id: "mandalorian-and-grogu", title: "Star Wars: The Mandalorian and Grogu", year: 2026, imdb: "30825738" },
  { id: "moana-2026", title: "Moana", year: 2026, imdb: "27419466" },
  { id: "resident-evil-2026", title: "Resident Evil", year: 2026, imdb: "35538033" },
  { id: "disclosure-day", title: "Disclosure Day", year: 2026, imdb: "15047880" },
  { id: "wuthering-heights-2026", title: "Wuthering Heights", year: 2026, imdb: "32897959" },
  { id: "scary-movie-2026", title: "Scary Movie", year: 2026, imdb: "32093575" },
  { id: "scream-7", title: "Scream 7", year: 2026, imdb: "27047903" },
  { id: "goat-2026", title: "GOAT", year: 2026, imdb: "27613895" },
  { id: "insidious-out-of-the-further", title: "Insidious: Out of the Further", year: 2026, imdb: "32393988" },
  { id: "paw-patrol-dino", title: "PAW Patrol: The Dino Movie", year: 2026, imdb: "29356163" },
  { id: "the-drama", title: "The Drama", year: 2026, imdb: "33071426" },
  { id: "sheep-detectives", title: "The Sheep Detectives", year: 2026, imdb: "32565993" },
  { id: "mortal-kombat-ii", title: "Mortal Kombat II", year: 2026, imdb: "17490712" },
  { id: "supergirl-2026", title: "Supergirl", year: 2026, imdb: "8814476" },
  { id: "end-of-oak-street", title: "The End of Oak Street", year: 2026, imdb: "27165187" },
  { id: "masters-of-the-universe", title: "Masters of the Universe", year: 2026, imdb: "0427340" },
  { id: "heart-of-the-beast", title: "Heart of the Beast", year: 2026, imdb: "7526136" },
  { id: "practical-magic-2", title: "Practical Magic 2", year: 2026, imdb: "32588798" },
  { id: "coyote-vs-acme", title: "Coyote vs. Acme", year: 2026, imdb: "1756855" },
  { id: "send-help", title: "Send Help", year: 2026, imdb: "8036976" },
  { id: "the-mummy-2026", title: "The Mummy", year: 2026, imdb: "11100168" },
  { id: "reminders-of-him", title: "Reminders of Him", year: 2026, imdb: "33714084" },
  { id: "crime-101", title: "Crime 101", year: 2026, imdb: "32430579" },
  { id: "evil-dead-burn", title: "Evil Dead Burn", year: 2026, imdb: "31170389" },
  { id: "the-invite", title: "The Invite", year: 2026, imdb: "14173636" },
  { id: "28-years-later-bone-temple", title: "28 Years Later: The Bone Temple", year: 2026, imdb: "32141377" },
  { id: "shelter-2026", title: "Shelter", year: 2026, imdb: "32357218" },
  { id: "mercy-2026", title: "Mercy", year: 2026, imdb: "31050594" },
  { id: "iron-lung", title: "Iron Lung", year: 2026, imdb: "27564844" },
  { id: "return-to-silent-hill", title: "Return to Silent Hill", year: 2026, imdb: "22868010" },
  { id: "greenland-2", title: "Greenland 2: Migration", year: 2026, imdb: "14850054" },
  { id: "ready-or-not-2", title: "Ready or Not 2: Here I Come", year: 2026, imdb: "33978029" },
  { id: "love-hypothesis", title: "The Love Hypothesis", year: 2026, imdb: "22526100" },
  { id: "the-uprising", title: "The Uprising", year: 2026, imdb: "36983905" },
  { id: "pressure-2026", title: "Pressure", year: 2026, imdb: "32547691" },
  { id: "apex-2026", title: "Apex", year: 2026, imdb: "16431404" },
  { id: "the-rip", title: "The Rip", year: 2026, imdb: "32642706" },
  { id: "people-we-meet-on-vacation", title: "People We Meet on Vacation", year: 2026, imdb: "22740896" },
  { id: "verity", title: "Verity", year: 2026, query: "Verity" },
];

const BACKUPS: Item[] = [
  { id: "digger-2026", title: "Digger", year: 2026, query: "Digger" },
  { id: "unabomber-2026", title: "Unabomber", year: 2026, query: "Unabomber" },
  { id: "dune-part-two", title: "Dune: Part Two", year: 2024, imdb: "15239678" },
  { id: "deadpool-wolverine", title: "Deadpool & Wolverine", year: 2024, imdb: "6263850" },
  { id: "inside-out-2", title: "Inside Out 2", year: 2024, imdb: "22022452" },
];

async function wikiPoster(title: string, year: number): Promise<string | undefined> {
  const names = [`${title} (${year} film)`, `${title} (film)`, title];
  for (const name of names) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { "User-Agent": "EnglishWords/1.0 (local catalog)" } });
    if (!res.ok) continue;
    const body = (await res.json()) as { thumbnail?: { source?: string } };
    const src = body.thumbnail?.source?.split("?")[0];
    if (src) return src;
  }
  return undefined;
}

function runImport(args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", "import:media", "--", ...args], {
      cwd: root,
      env: { ...process.env, DICTIONARY_DIR: dict },
      stdio: "inherit",
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function importOne(item: Item): Promise<boolean> {
  const poster = await wikiPoster(item.title, item.year);
  const args = [
    "--id",
    item.id,
    "--title",
    item.title,
    "--kind",
    "movie",
    "--year",
    String(item.year),
    "--paid",
    "--query",
    item.query ?? item.title,
  ];
  if (item.imdb) args.push("--imdb", item.imdb);
  if (poster) args.push("--poster", poster);
  const code = await runImport(args);
  return code === 0;
}

async function main() {
  const ok: string[] = [];
  const failed: string[] = [];
  const queue = [...ITEMS];
  let backup = 0;
  while (ok.length < 50 && (queue.length > 0 || backup < BACKUPS.length)) {
    const item = queue.shift() ?? BACKUPS[backup++];
    if (!item) break;
    console.info(`\n=== ${ok.length + 1}/50 ${item.title} (${item.year}) ===`);
    try {
      const success = await importOne(item);
      if (success) ok.push(item.id);
      else {
        failed.push(item.id);
        console.error(`failed ${item.id}`);
      }
    } catch (error) {
      failed.push(item.id);
      console.error(error);
    }
    await sleep(1200);
  }
  console.info(`\ndone: ${ok.length} imported, ${failed.length} failed`);
  if (failed.length) console.info(`failed: ${failed.join(", ")}`);
  if (ok.length < 50) process.exit(1);
}

main();
