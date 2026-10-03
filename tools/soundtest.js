// The noises and the announcer, checked without a speaker.
//
//   node tools/soundtest.js
//
// Sound is the one part of a game with no way to see whether it worked. A
// polygon in the wrong place is on the screen; a gain that is never raised, or a
// word the synthesiser was never taught and therefore silently did not say, is
// indistinguishable from working perfectly until somebody says "why does he
// never call the ultra kill".
//
// So this stands a recording AudioContext up in place of the real one, plays a
// match into it, and asks what the game *asked for*. It cannot tell you the
// rocket sounds like a rocket. It can tell you the game tried, and it can tell
// you exactly which words the announcer would have swallowed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Audio } from '../src/audio.js';
import { Speech, phrase } from '../src/speech.js';
import { LINES, MULTI_NAMES, SPREE_NAMES, WORDS } from '../src/commentary.js';
import { createMatch } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { MULTI_MAX, SPREE_STEPS } from '../src/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (what, condition) => {
  console.log(`  ${condition ? ' ' : '✗'} ${what}`);
  if (!condition) failures++;
};

// --- An audio graph that only remembers ---------------------------------------

const raised = [];

class Param {
  constructor(name) { this.name = name; this.value = 0; }

  setValueAtTime(v, t) { this.note(v, t); return this; }

  linearRampToValueAtTime(v, t) { this.note(v, t); return this; }

  exponentialRampToValueAtTime(v, t) { this.note(v, t); return this; }

  setTargetAtTime(v, t) { this.note(v, t); return this; }

  cancelScheduledValues() { return this; }

  note(v, t) {
    this.value = v;
    if (this.name === 'gain' && v > 0.001) raised.push({ at: t || 0, value: v });
  }
}

function node() {
  return {
    gain: new Param('gain'),
    frequency: new Param('frequency'),
    detune: new Param('detune'),
    pan: new Param('pan'),
    Q: new Param('Q'),
    type: '',
    buffer: null,
    loop: false,
    connect(next) { return next || this; },
    disconnect() {},
    start() {},
    stop() {},
    setPeriodicWave() {},
  };
}

class StubContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = node();
    this.state = 'running';
    this.built = 0;
  }

  resume() {}

  createGain() { this.built++; return node(); }

  createOscillator() { this.built++; return node(); }

  createBiquadFilter() { this.built++; return node(); }

  createStereoPanner() { this.built++; return node(); }

  createConvolver() { this.built++; return node(); }

  createBufferSource() { this.built++; return node(); }

  createPeriodicWave() { return {}; }

  createBuffer(channels, length) {
    return { length, getChannelData: () => new Float32Array(length) };
  }
}

globalThis.AudioContext = StubContext;

// --- The vocabulary -----------------------------------------------------------
//
// The synthesiser is shared verbatim with the other games in this series, so it
// does not export its phoneme table for this test's convenience. Reading the
// list out of the source is the lesser evil: the alternative is a copy of the
// list here, which would be the thing that goes out of date.

const phonemes = new Set(
  [...readFileSync(path.join(ROOT, 'src/speech.js'), 'utf8')
    .matchAll(/^\s{2}([A-Z_]+):\s*\{/gm)].map((m) => m[1]),
);

console.log('\nThe announcer knows what he is being asked to say:');
let unknownWords = 0;
let unknownSounds = 0;
for (const [event, lines] of Object.entries(LINES)) {
  for (const line of lines) {
    for (const word of line.split(/\s+/)) {
      if (!WORDS[word]) {
        console.error(`  ✗ ${event}: no word "${word}", so it would be left out silently`);
        unknownWords++;
      }
    }
  }
}
for (const [word, sounds] of Object.entries(WORDS)) {
  for (const sound of sounds) {
    if (!phonemes.has(sound)) {
      console.error(`  ✗ "${word}" uses ${sound}, which the synthesiser has never heard of`);
      unknownSounds++;
    }
  }
}
ok(`${Object.keys(WORDS).length} words, all of them made of sounds it can make`, !unknownSounds);
ok(`${Object.keys(LINES).length} lines, all of them made of words it knows`, !unknownWords);

// Every rung of both ladders has to have something to say and something to show.
for (let i = 2; i <= MULTI_MAX; i++) {
  ok(`a ${i}-kill has a line and a name`, !!LINES[`multi${i}`] && !!MULTI_NAMES[i]);
}
for (const step5 of SPREE_STEPS) {
  ok(`a spree of ${step5} has a line and a name`, !!LINES[`spree${step5}`] && !!SPREE_NAMES[step5]);
}

// --- And that he opens his mouth ----------------------------------------------

const audio = new Audio();
audio.start();
const speech = new Speech(audio, { WORDS, LINES });
console.log('\nAnd that saying it builds something:');
for (const event of ['firstblood', 'multi5', 'spree20', 'scoreRed', 'won']) {
  const before = audio.ctx.built;
  const nodes = speech.say(event);
  ok(`"${LINES[event][0]}" builds ${audio.ctx.built - before} nodes`, nodes > 0);
}
ok('a phrase of words it does not know builds nothing',
  speech.line('supercalifragilistic') === 0);
ok('and phrase() drops them rather than throwing', phrase('kill unknownword', WORDS).length > 0);

// --- What a match asks for ----------------------------------------------------

console.log('\nWhat two minutes of play asks the speakers for:');
raised.length = 0;
const state = createMatch({ humans: [true], bots: 5, map: 'foundry', mode: 'dm', seed: 5 });
const heard = {};
for (let t = 0; t < 60 * 120; t++) {
  step(state);
  for (const e of state.events) heard[e.type] = (heard[e.type] || 0) + 1;
  audio.play(state, state.events, 0);
  audio.setListener(0, 1.6, 0, 1, 0);
  audio.steps(state.bodies[0], t / 60);
}
ok(`${raised.length} sounds were asked for`, raised.length > 200);
ok('shots were fired', (heard.fire || 0) > 100);
ok('somebody died', (heard.death || 0) > 5);
ok('something was picked up', (heard.pickup || 0) > 0);
ok('the announcer had something to announce',
  (heard.firstblood || 0) + (heard.multi || 0) + (heard.spree || 0) > 0);
const loudest = raised.reduce((max, r) => Math.max(max, r.value), 0);
ok(`and nothing asked for a gain over 4 (loudest was ${loudest.toFixed(2)})`, loudest <= 4);

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the sound.`);
  process.exit(1);
}
console.log('\nThe game is making all the right noises.');
