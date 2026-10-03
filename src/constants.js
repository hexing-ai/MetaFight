/**
 * Every dimension, speed and rule in one place - the same arrangement as
 * websoccer, webtennis, webracing and webtrack, and for the same reason: tuning
 * a game means changing numbers, and hunting them through the code is how a game
 * stops being tuneable.
 *
 * The world is metres, Y is up, and the simulation never asks how big the window
 * is. A shot that hits on one machine has to hit on all four of them.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const FRAME_TIME = 1000 / TICK_RATE;

/** Four seats, and no more: the relay hands out four and the arena is built for
 *  four. Bots fill whatever is left over. */
export const MAX_PLAYERS = 4;
/** Humans plus bots. Eight bodies in an arena this size is already a scrum. */
export const MAX_BODIES = 8;

// --- The body ----------------------------------------------------------------
//
// A cylinder, and it collides as an upright box because a box against a world of
// boxes needs no tolerances and never wedges in a corner. Everything else about
// how the game moves comes out of the six numbers under it.

export const P_RADIUS = 0.42;
export const P_HEIGHT = 1.80;
export const P_EYE = 1.62;
/** How high a ledge you walk up without noticing. Stairs are built under it. */
export const P_STEP = 0.55;

export const GRAVITY = 24.0; // m/s^2 - heavier than earth, because falling is dull
export const JUMP_SPEED = 8.0; // 1.33 m of air, and about 0.67 s of it

/**
 * Running.
 *
 * GROUND_ACCEL is deliberately enormous and FRICTION with it: an arena shooter
 * wants a body that is at top speed by the second frame and stopped by the
 * third. The give in the controls comes from the air, not from the floor.
 */
export const RUN_SPEED = 9.0; // m/s
export const GROUND_ACCEL = 105.0;
export const FRICTION = 9.5; // per second, exponential
/** In the air you have almost no authority - AIR_SPEED is the ceiling on how
 *  much sideways you may add, not on how fast you may travel. */
export const AIR_ACCEL = 26.0;
export const AIR_SPEED = 1.6;
export const AIR_DRAG = 0.06;

/** A landing softer than this is silent; harder than it costs health. */
export const FALL_SAFE = 14.0; // m/s
export const FALL_HURT = 26.0; // m/s at which it costs 40
export const FALL_MAX_DAMAGE = 45;

/** Killed by the floor of the world. Every map has one and it is a long way down. */
export const VOID_DAMAGE = 1000;

// --- Staying alive -----------------------------------------------------------

export const MAX_HEALTH = 100;
export const MAX_ARMOUR = 100;
/** The share of a hit that armour takes instead of you, while it lasts. */
export const ARMOUR_SHARE = 0.6;

export const RESPAWN_TICKS = 96; // 1.6 s face down
export const SPAWN_SHIELD = 90; // 1.5 s of not being shot the moment you arrive
/** Moving or firing ends the shield early, so it cannot be camped behind. */
export const SHIELD_BREAK_SPEED = 3.0;

// --- The guns ----------------------------------------------------------------
//
// Four of them plus the instagib rifle, and they are meant to answer four
// different questions: what do I do at range, what do I do in a corridor, what
// do I do to somebody who is jumping, and what do I do when I have one shot.
//
//   dps      = damage * (TICK_RATE / interval) * pellets
//   hitscan  = the shot arrives on the tick it is fired
//   splash   = damage falls off linearly to nothing at the radius
//
// Everything here is per-shot. The AI reads the same table, so a gun that is
// changed here is a gun the bots re-learn for free.

export const WEAPONS = [
  {
    key: 'mg',
    name: 'Autogun',
    short: 'MG',
    kind: 'hitscan',
    damage: 9,
    interval: 6, // 10 shots a second
    spread: 0.017, // radians, and it grows while you hold it down
    spreadGrow: 0.010,
    spreadMax: 0.055,
    pellets: 1,
    ammo: 60,
    maxAmmo: 240,
    pickup: 40,
    kick: 0.4,
    range: 220,
    light: [1.0, 0.86, 0.45],
    aiRange: [2, 55],
    aiSkill: 1.0,
  },
  {
    key: 'scatter',
    name: 'Scattergun',
    short: 'SG',
    kind: 'hitscan',
    damage: 8,
    interval: 48,
    spread: 0.085,
    spreadGrow: 0,
    spreadMax: 0.085,
    pellets: 10,
    ammo: 20,
    maxAmmo: 60,
    pickup: 12,
    kick: 2.6,
    range: 40,
    light: [1.0, 0.8, 0.5],
    aiRange: [0, 14],
    aiSkill: 1.15,
  },
  {
    key: 'rocket',
    name: 'Rocket launcher',
    short: 'RL',
    kind: 'projectile',
    damage: 92, // a direct hit
    splash: 78,
    splashRadius: 3.6,
    speed: 27,
    interval: 54,
    spread: 0,
    spreadGrow: 0,
    spreadMax: 0,
    pellets: 1,
    ammo: 10,
    maxAmmo: 40,
    pickup: 8,
    kick: 3.2,
    /** What the blast does to whoever fired it. Rocket jumps live here. */
    selfShare: 0.5,
    push: 13.0,
    light: [1.0, 0.55, 0.2],
    aiRange: [6, 45],
    aiSkill: 0.85,
  },
  {
    key: 'rail',
    name: 'Rail rifle',
    short: 'RR',
    kind: 'hitscan',
    damage: 68,
    interval: 96,
    spread: 0,
    spreadGrow: 0,
    spreadMax: 0,
    pellets: 1,
    ammo: 8,
    maxAmmo: 24,
    pickup: 6,
    kick: 2.0,
    range: 400,
    trail: true,
    light: [0.6, 0.9, 1.0],
    aiRange: [12, 400],
    aiSkill: 0.75,
  },
  {
    key: 'insta',
    name: 'Instagib rifle',
    short: 'IG',
    kind: 'hitscan',
    damage: 1000,
    interval: 66,
    spread: 0,
    spreadGrow: 0,
    spreadMax: 0,
    pellets: 1,
    ammo: Infinity,
    maxAmmo: Infinity,
    pickup: 0,
    kick: 2.4,
    range: 400,
    trail: true,
    light: [0.75, 0.95, 1.0],
    aiRange: [0, 400],
    aiSkill: 0.95,
  },
];

export const WEAPON_INDEX = WEAPONS.reduce((out, w, i) => { out[w.key] = i; return out; }, {});
export const INSTA_WEAPON = WEAPON_INDEX.insta;
/** What everybody carries from the moment they spawn, in every normal match. */
export const START_WEAPON = WEAPON_INDEX.mg;

/** How long the muzzle stays lit, and how long a rail trail hangs in the air. */
export const FLASH_TICKS = 5;
export const TRAIL_TICKS = 42;
export const ROCKET_LIFE = 300;

// --- Things lying on the floor -----------------------------------------------

export const ITEMS = {
  health: { give: 25, respawn: 1200, radius: 0.75, label: 'Health' },
  bighealth: { give: 50, respawn: 1800, radius: 0.85, label: 'Health pack' },
  armour: { give: 50, respawn: 1500, radius: 0.8, label: 'Armour' },
  ammo: { respawn: 600, radius: 0.7, label: 'Ammo' },
  weapon: { respawn: 900, radius: 0.9, label: 'Weapon' },
};

/** How high above the floor an item floats, and how far it bobs. */
export const ITEM_HOVER = 0.75;
export const ITEM_BOB = 0.12;

// --- The match ---------------------------------------------------------------

export const MODES = {
  dm: { key: 'dm', name: 'Deathmatch', teams: false, flags: false, limit: 20 },
  tdm: { key: 'tdm', name: 'Team deathmatch', teams: true, flags: false, limit: 40 },
  ctf: { key: 'ctf', name: 'Capture the flag', teams: true, flags: true, limit: 3 },
};

export const TEAMS = [
  { key: 'red', name: 'Red', colour: [0.92, 0.28, 0.24] },
  { key: 'blue', name: 'Blue', colour: [0.30, 0.55, 0.98] },
];

export const WARMUP_TICKS = 180; // three seconds of reading the map before it starts
export const OVER_TICKS = 300;
export const DEFAULT_TIME_LIMIT = 600 * TICK_RATE; // ten minutes

/** The flag. Carried, dropped, and back on its stand after this long. */
export const FLAG_RADIUS = 1.5;
export const FLAG_RETURN_TICKS = 1500;

// --- The announcer -----------------------------------------------------------
//
// Two ladders, and between them they are the whole of what a shooter has to say
// out loud. The first is about a moment: kills close enough together that they
// were one piece of work. The second is about a life: kills without dying.
//
// Four seconds is the tournament's window and it is the right one. Longer and a
// double kill stops meaning "both of them, at once"; shorter and the second
// body has not finished falling over.

export const MULTI_WINDOW = 4 * TICK_RATE;
export const MULTI_MAX = 7;
export const SPREE_STEPS = [5, 10, 15, 20, 25, 30];

export const SKILLS = {
  easy: { key: 'easy', name: 'Rookie', aim: 0.055, react: 22, lead: 0.55, seek: 0.55, wander: 0.55 },
  normal: { key: 'normal', name: 'Regular', aim: 0.028, react: 13, lead: 0.8, seek: 0.8, wander: 0.3 },
  hard: { key: 'hard', name: 'Veteran', aim: 0.014, react: 7, lead: 0.95, seek: 1.0, wander: 0.12 },
  brutal: { key: 'brutal', name: 'Brutal', aim: 0.006, react: 3, lead: 1.0, seek: 1.0, wander: 0.05 },
};

// --- The buttons -------------------------------------------------------------
//
// One 16 bit mask per body per tick, and it is exactly what goes over the wire.
// Where you are looking rides alongside it as two more integers - see net/.

export const BTN = {
  FWD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  JUMP: 16,
  FIRE: 32,
  NEXT: 64,
  PREV: 128,
  W1: 256,
  W2: 512,
  W3: 1024,
  W4: 2048,
  RELOAD: 4096,
};

/** Yaw is a full turn in 65536 steps, pitch a quarter turn either way in 4096.
 *  Angles travel as integers so every machine turns the same amount. */
export const YAW_UNITS = 65536;
export const PITCH_LIMIT = 15000; // just under straight up, in yaw units

export const BOT_NAMES = [
  'Vega', 'Kessler', 'Ozu', 'Rask', 'Nyx', 'Bakker', 'Solano', 'Idris',
  'Wray', 'Petrova', 'Mensah', 'Koster',
];
