import { useEffect, useRef, useState } from "react";
import type { PetAction, PetSnapshot } from "../types";

/** Source boards are 12 fps. Playback is 4×: 21 ms per frame, about 3 s. */
export const MOTI_LOOP_FRAMES = 145;
export const MOTI_LOOP_FRAME_MS = 21;
export const MOTI_LOOP_MS = MOTI_LOOP_FRAMES * MOTI_LOOP_FRAME_MS;

/** One-shot care actions play one full clip. */
export const MOTI_ACTION_MS = MOTI_LOOP_MS;

/** One-shot reactions that fire without a button (coins earned, rescue from cryo). */
export type MotiReaction = "coins" | "rescued";

export const MOTI_REACTION_MS: Record<MotiReaction, number> = {
  coins: MOTI_LOOP_MS,
  rescued: MOTI_LOOP_MS,
};

/** Below this value an alive Moti starts hinting (rumble / droop) that a bar is low. */
export const MOTI_LOW_STAT = 30;

const MOTI_ASSET = "/moti";
/** Bump when replacing static assets so Telegram WebView / browser cache picks up new files. */
const MOTI_ASSET_V = "10";

/** Everyday gestures. Breathing stays between them; coins is listed twice so a happy Moti hops more often. */
const CALM_GESTURES = ["yawn", "stretch", "wave", "shy", "drink", "sneeze", "sleep"] as const;
const HAPPY_GESTURES = ["coins", "coins", "wave", "stretch", "yawn", "drink"] as const;
type MotiGesture = (typeof CALM_GESTURES)[number] | (typeof HAPPY_GESTURES)[number];
export function motiBarsLow(pet: Pick<PetSnapshot, "hunger" | "mood">): boolean {
  return pet.hunger < MOTI_LOW_STAT || pet.mood < MOTI_LOW_STAT;
}

/** Broke + full bars should look alive. Slump / idle-suffering only when a bar is low. */
export function motiLooksAlive(pet: PetSnapshot): boolean {
  return pet.status === "alive" || (pet.status === "suffering" && !motiBarsLow(pet));
}

export function motiIsHappy(pet: PetSnapshot): boolean {
  return motiLooksAlive(pet) && pet.hunger >= 70 && pet.mood >= 70;
}

export function motiLowStat(pet: PetSnapshot): "hunger" | "mood" | null {
  if (!motiLooksAlive(pet)) return null;
  if (pet.hunger < MOTI_LOW_STAT) return "hunger";
  if (pet.mood < MOTI_LOW_STAT) return "mood";
  return null;
}

function asset(file: string): string {
  return `${MOTI_ASSET}/${file}?v=${MOTI_ASSET_V}`;
}

/** Storyboard clips. Old pose stills (hop, sit, look, walk, ice) are not used. */
export const MOTI_LOOPS = [
  "idle",
  "coins",
  "sad",
  "feed",
  "play",
  "wave",
  "cold",
  "correct",
  "drink",
  "exam-passed",
  "newword",
  "shy",
  "sleep",
  "sneeze",
  "stretch",
  "test-passed",
  "unfreeze",
  "wrong",
  "yawn",
] as const;
export type MotiLoopName = (typeof MOTI_LOOPS)[number];

export type MotiArt = {
  src: string;
  /** Which storyboard loop this pose uses. Null keeps a single still. */
  loop: MotiLoopName | null;
};

function loopArt(name: MotiLoopName, reduced: boolean): MotiArt {
  return { src: asset(reduced ? `${name}-still.webp` : `${name}.webp`), loop: name };
}

function stillArt(file: string): MotiArt {
  return { src: asset(file), loop: null };
}

/**
 * Resolve which Moti art clip to show.
 * Feed, play, coins, and unfreeze are one-shots.
 * Cryo uses the ice-capsule still, not the shivering cold clip.
 * Sad plays when a bar is low. Otherwise he breathes, and sometimes does one gesture.
 * Graduated stays on the single suitcase still: that board has no clip.
 */
export function motiArt(
  pet: PetSnapshot,
  acting: PetAction | null,
  _happy: boolean,
  life: MotiGesture | null,
  reaction: MotiReaction | null = null,
  low: "hunger" | "mood" | null = null,
  reduced = false,
): MotiArt | null {
  if (acting === "feed") return loopArt("feed", reduced);
  if (acting === "play") return loopArt("play", reduced);
  if (reaction === "coins") return loopArt("coins", reduced);
  if (reaction === "rescued") return loopArt("unfreeze", reduced);
  if (pet.status === "graduated") return stillArt("idle-graduated.webp");
  if (pet.status === "cryo") return stillArt("idle-cryo.webp");
  if (pet.status === "suffering" && motiBarsLow(pet)) return loopArt("sad", reduced);
  if (pet.status === "alive" || pet.status === "suffering") {
    if (low) return loopArt("sad", reduced);
    if (life) return loopArt(life, reduced);
    return loopArt("idle", reduced);
  }
  return null;
}

export function motiArtSrc(
  pet: PetSnapshot,
  acting: PetAction | null,
  _happy: boolean,
  life: MotiGesture | null,
  reaction: MotiReaction | null = null,
  low: "hunger" | "mood" | null = null,
  reduced = false,
): string | null {
  return motiArt(pet, acting, _happy, life, reaction, low, reduced)?.src ?? null;
}

/** Clips after the one on screen. One at a time, so playback is not fighting sixteen decoders. */
const PRELOAD_ORDER: MotiLoopName[] = [
  "idle",
  "sad",
  "cold",
  "feed",
  "play",
  "coins",
  "unfreeze",
  "yawn",
  "stretch",
  "wave",
  "shy",
  "drink",
  "sneeze",
  "sleep",
  "correct",
  "wrong",
  "newword",
  "exam-passed",
  "test-passed",
];

const loadedClips = new Set<string>();
let preloadQueueStarted = false;

function loadImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
    if (img.complete && img.naturalWidth > 0) finish(true);
  });
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function openingArt(pet: PetSnapshot, reduced: boolean): MotiArt | null {
  const happy = motiIsHappy(pet);
  const low = happy ? null : motiLowStat(pet);
  return motiArt(pet, null, happy, null, null, low, reduced);
}

function startPreloadQueue(reduced: boolean) {
  if (preloadQueueStarted || reduced) return;
  preloadQueueStarted = true;
  const pending = PRELOAD_ORDER.map((name) => asset(`${name}.webp`)).filter((src) => !loadedClips.has(src));
  const next = () => {
    const src = pending.shift();
    if (!src) return;
    void loadImage(src).then((ok) => {
      if (ok) loadedClips.add(src);
      next();
    });
  };
  next();
}

/** Fetch the clip Moti will show first. The rest follow one by one after it is ready. */
export function preloadMotiOpening(pet: PetSnapshot): Promise<void> {
  const reduced = prefersReducedMotion();
  const art = openingArt(pet, reduced);
  const poster = art?.loop ? asset(`${art.loop}-still.webp`) : null;
  const clip = art?.src ?? null;
  if (poster && poster !== clip) void loadImage(poster);
  const ready = clip
    ? loadImage(clip).then((ok) => {
        if (ok && clip) loadedClips.add(clip);
      })
    : Promise.resolve();
  void ready.then(() => startPreloadQueue(reduced));
  return ready;
}

/** Keeps a frame on screen until the next clip has decoded, so Moti does not vanish. */
function MotiSprite({ src, poster, playId }: { src: string; poster: string | null; playId: string }) {
  const [layers, setLayers] = useState(() => {
    if (poster && poster !== src && !loadedClips.has(src)) {
      return [{ src: poster, playId: `${playId}|still`, on: true }];
    }
    return [{ src, playId, on: true }];
  });

  useEffect(() => {
    setLayers((prev) => {
      const visible = prev.find((layer) => layer.on);
      if (visible && visible.src === src && visible.playId === playId && prev.length === 1) return prev;
      if (prev.some((layer) => !layer.on && layer.src === src && layer.playId === playId)) return prev;
      const shown = prev.filter((layer) => layer.on);
      const base =
        shown.length > 0 || !poster || poster === src
          ? shown
          : [{ src: poster, playId: `${playId}|still`, on: true }];
      if (base.some((layer) => layer.on && layer.src === src)) return prev;
      return [...base, { src, playId, on: false }];
    });
  }, [src, playId, poster]);

  function show(layer: { src: string; playId: string }) {
    setLayers((prev) => {
      if (!prev.some((item) => item.src === layer.src && item.playId === layer.playId)) return prev;
      if (prev.length === 1 && prev[0]?.on && prev[0].src === layer.src && prev[0].playId === layer.playId) return prev;
      return [{ src: layer.src, playId: layer.playId, on: true }];
    });
  }

  return (
    <>
      {layers.map((layer) => (
        <img
          key={`${layer.playId}|${layer.src}`}
          className={layer.on ? "moti-art" : "moti-art moti-art-next"}
          src={layer.src}
          alt=""
          draggable={false}
          ref={(node) => {
            if (!layer.on && node?.complete && node.naturalWidth > 0) show(layer);
          }}
          onLoad={() => {
            if (!layer.on) show(layer);
          }}
          onError={() => {
            if (!layer.on) show(layer);
          }}
        />
      ))}
    </>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function Moti({
  pet,
  acting,
  actKey,
  reaction = null,
  reactKey = 0,
}: {
  pet: PetSnapshot;
  acting: PetAction | null;
  actKey: number;
  reaction?: MotiReaction | null;
  reactKey?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const looksAlive = motiLooksAlive(pet);
  const happy = motiIsHappy(pet);
  const busy = acting ?? reaction;
  const lifeEnabled = looksAlive && !busy;
  const low = !happy && !busy ? motiLowStat(pet) : null;
  const poseStatus = looksAlive && pet.status === "suffering" ? "alive" : pet.status;
  const [gesture, setGesture] = useState<MotiGesture | null>(null);
  const [gestureTick, setGestureTick] = useState(0);
  const lastGesture = useRef<MotiGesture | null>(null);
  const life = lifeEnabled && !low ? gesture : null;

  useEffect(() => {
    if (!lifeEnabled || low) return;
    const ms = reducedMotion ? 2800 : MOTI_LOOP_MS;
    const timer = window.setTimeout(() => {
      setGesture((current) => {
        if (current) return null;
        const stayIdle = Math.random() < (happy ? 0.4 : 0.62);
        if (stayIdle) return null;
        const pool = (happy ? HAPPY_GESTURES : CALM_GESTURES).filter((name) => name !== lastGesture.current);
        const next = pool[Math.floor(Math.random() * pool.length)] ?? null;
        lastGesture.current = next;
        return next;
      });
      setGestureTick((n) => n + 1);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [lifeEnabled, low, happy, reducedMotion, gestureTick]);

  useEffect(() => {
    if (!lifeEnabled || low) setGesture(null);
  }, [lifeEnabled, low]);

  const art = motiArt(pet, acting, happy, life, reaction, low, reducedMotion);
  const artSrc = art?.src ?? null;
  const poster = art?.loop && !reducedMotion ? asset(`${art.loop}-still.webp`) : null;
  const useArt = Boolean(artSrc);
  const className = [
    "moti-stage",
    `moti-${poseStatus}`,
    happy ? "moti-happy" : "",
    acting ? `moti-acting moti-act-${acting}` : "",
    reaction && !acting ? `moti-react moti-react-${reaction}` : "",
    life && !busy ? `moti-life moti-life-${life}` : "",
    low ? `moti-low moti-low-${low}` : "",
    useArt ? "moti-has-art" : "",
    art?.loop ? `moti-frame moti-frame-${art.loop}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playId = acting
    ? `act-${actKey}`
    : reaction
      ? `react-${reaction}-${reactKey}`
      : life
        ? `g-${life}-${gestureTick}`
        : `rest-${art?.loop ?? "idle"}`;

  return (
    <div
      className={className}
      data-moti-status={pet.status}
      data-moti-acting={acting ?? ""}
      data-moti-reaction={reaction ?? ""}
      data-moti-life={life ?? ""}
      data-moti-low={low ?? ""}
      data-moti-loop={art?.loop ?? ""}
      aria-hidden
    >
      {pet.status === "graduated" && !useArt ? <div className="city" /> : null}
      {pet.status === "cryo" && !useArt ? (
        <>
          <span className="frost f1" />
          <span className="frost f2" />
          <span className="frost f3" />
        </>
      ) : null}

      {acting === "play" && art?.loop !== "play" ? (
        <div className="disco-scene" key={`disco-${actKey}`}>
          <img className="disco-ball" src={asset("disco-ball.webp")} alt="" draggable={false} />
          <span className="disco-beam b1" />
          <span className="disco-beam b2" />
          <span className="disco-beam b3" />
          <span className="disco-beam b4" />
          <span className="disco-spark s1" />
          <span className="disco-spark s2" />
          <span className="disco-spark s3" />
          <span className="disco-spark s4" />
          <span className="disco-spark s5" />
          <span className="disco-wash" />
        </div>
      ) : null}

      {reaction === "coins" && !acting && art?.loop !== "coins" ? (
        <div className="coin-scene" key={`coins-${reactKey}`}>
          <span className="coin-spark c1" />
          <span className="coin-spark c2" />
          <span className="coin-spark c3" />
          <span className="coin-spark c4" />
          <span className="coin-spark c5" />
          <span className="coin-spark c6" />
        </div>
      ) : null}

      {reaction === "rescued" && !acting && art?.loop !== "unfreeze" ? (
        <div className="thaw-scene" key={`thaw-${reactKey}`}>
          <span className="thaw-drop t1" />
          <span className="thaw-drop t2" />
          <span className="thaw-drop t3" />
          <span className="thaw-drop t4" />
          <span className="thaw-drop t5" />
          <span className="thaw-glow" />
        </div>
      ) : null}

      <div className="moti">
        {useArt ? (
          <>
            <div className="moti-shadow" />
            <MotiSprite src={artSrc!} poster={poster} playId={playId} />
            {low === "mood" ? <span className="moti-sigh" /> : null}
          </>
        ) : (
          <>
            {pet.status === "cryo" ? <div className="capsule" /> : null}
            <div className="moti-shadow" />
            {acting === "feed" ? <div className="moti-food" /> : null}
            {acting === "play" ? (
              <>
                <span className="play-burst b1" />
                <span className="play-burst b2" />
                <span className="play-burst b3" />
              </>
            ) : null}
            {pet.status === "graduated" ? <div className="suitcase" /> : null}
            {pet.status === "suffering" ? <div className="tear" /> : null}
            <div className="moti-arm left" />
            <div className="moti-body">
              <div className="moti-blush left" />
              <div className="moti-blush right" />
              <div className="moti-eye left" />
              <div className="moti-eye right" />
              <div className="moti-mouth" />
            </div>
            <div className="moti-arm right" />
          </>
        )}
      </div>
    </div>
  );
}
