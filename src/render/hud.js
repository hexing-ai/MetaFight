/**
 * Everything drawn flat: the crosshair, the numbers, and the running commentary
 * down the side of the screen.
 *
 * On its own canvas over the top of the world, in 2D, because a HUD is text and
 * rectangles and there is nothing WebGL can do for either that is worth a second
 * shader. It is redrawn every frame - it is a few dozen fills - and it is the
 * only part of the game that knows what anything is called.
 */

import {
  MAX_ARMOUR, MAX_HEALTH, MODES, TEAMS, TICK_RATE, WEAPONS,
} from '../constants.js';
import { clockText, standings } from '../game/state.js';
import { MULTI_NAMES, SPREE_FEED, SPREE_NAMES } from '../commentary.js';

const FEED_LIFE = 5.5;
const SHOUT_LIFE = 2.6;
const CALL_LIFE = 2.8;

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.feed = [];
    this.shout = null;
    // What the announcer just said, which is drawn bigger and over the top of
    // whatever else was being shouted: a double kill outranks "fragged Nyx".
    this.call = null;
    this.hitAt = -99;
    this.hurtAt = -99;
    this.hurtFrom = 0;
    this.pickupAt = -99;
    this.time = 0;
    this.scale = 1;
  }

  resize(width, height, dpr) {
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // One scale for the whole HUD, from the shorter side, so a phone in
    // landscape gets readable numbers and a desktop does not get enormous ones.
    this.scale = Math.max(0.62, Math.min(1.5, Math.min(width / 1100, height / 620)));
  }

  addEvents(state, events, me) {
    for (const e of events) {
      // Whatever any of the branches below adds, the feed is the last six
      // things that happened. It is trimmed here rather than in each of them,
      // because it was trimmed in one of them and grew in four.
      if (e.type === 'death') {
        const victim = state.bodies[e.body];
        const killer = e.killer >= 0 ? state.bodies[e.killer] : null;
        this.feed.push({
          at: this.time,
          killer: killer ? killer.name : '',
          killerTeam: killer ? killer.team : -1,
          victim: victim.name,
          victimTeam: victim.team,
          weapon: e.cause,
          mine: killer ? killer.index === me : false,
          mineDeath: e.body === me,
        });
        if (killer && killer.index === me) {
          this.say(`FRAGGED ${victim.name.toUpperCase()}`, [0.8, 1, 0.85]);
        } else if (e.body === me) {
          this.say(killer ? `${killer.name.toUpperCase()} GOT YOU` : 'YOU DIED', [1, 0.6, 0.55]);
        }
      } else if (e.type === 'hit' && e.body === me) {
        this.hitAt = this.time;
      } else if (e.type === 'hurt' && e.body === me) {
        this.hurtAt = this.time;
        this.hurtFrom = e.from;
      } else if (e.type === 'pickup' && e.body === me) {
        this.pickupAt = this.time;
      } else if (e.type === 'take') {
        const who = state.bodies[e.body];
        this.say(`${TEAMS[e.team].name.toUpperCase()} FLAG TAKEN`, TEAMS[e.team].colour);
        this.feed.push({ at: this.time, note: `${who.name} took the ${TEAMS[e.team].name} flag` });
      } else if (e.type === 'capture') {
        const who = state.bodies[e.body];
        this.say(`${TEAMS[e.team].name.toUpperCase()} SCORES`, TEAMS[e.team].colour);
        this.feed.push({ at: this.time, note: `${who.name} captured` });
      } else if (e.type === 'return') {
        this.feed.push({ at: this.time, note: `${TEAMS[e.team].name} flag returned` });
      } else if (e.type === 'drop') {
        this.feed.push({ at: this.time, note: `${TEAMS[e.team].name} flag dropped` });
      } else if (e.type === 'begin') {
        this.announce('FIGHT', [1, 0.95, 0.7]);
      } else if (e.type === 'firstblood') {
        const who = state.bodies[e.body];
        if (e.body === me) this.announce('FIRST BLOOD', [1, 0.4, 0.35]);
        else this.feed.push({ at: this.time, note: `${who.name} drew first blood` });
      } else if (e.type === 'multi') {
        const who = state.bodies[e.body];
        const name = MULTI_NAMES[e.count] || MULTI_NAMES[MULTI_NAMES.length - 1];
        if (e.body === me) this.announce(name, [1, 0.78, 0.3]);
        else if (e.count >= 3) this.feed.push({ at: this.time, note: `${who.name}: ${name.toLowerCase()}` });
      } else if (e.type === 'spree') {
        const who = state.bodies[e.body];
        if (e.body === me) this.announce(SPREE_NAMES[e.count] || 'KILLING SPREE', [0.6, 0.95, 1]);
        else {
          this.feed.push({
            at: this.time,
            note: `${who.name} ${SPREE_FEED[e.count] || 'is on a killing spree'}`,
          });
        }
      } else if (e.type === 'spreeend') {
        const who = state.bodies[e.body];
        const by = e.killer >= 0 ? state.bodies[e.killer] : null;
        this.feed.push({
          at: this.time,
          note: by ? `${who.name}'s spree was ended by ${by.name}` : `${who.name}'s spree is over`,
        });
        if (e.killer === me) this.announce('SPREE ENDED', [0.75, 1, 0.8]);
      } else if (e.type === 'revenge' && e.body === me) {
        this.announce('PAYBACK', [1, 0.85, 0.45]);
      }
      while (this.feed.length > 6) this.feed.shift();
    }
  }

  say(text, colour) {
    this.shout = { text, colour, at: this.time };
  }

  announce(text, colour) {
    this.call = { text, colour, at: this.time };
  }

  draw(state, opts) {
    const ctx = this.ctx;
    // The HUD sits over a moving picture that can be any colour at all, so
    // everything on it carries a shadow. It costs nothing and it is the
    // difference between a number you can read against a lit wall and one you
    // cannot.
    const w = this.width;
    const h = this.height;
    this.time = opts.time;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    const s = this.scale;
    const me = state.bodies[opts.index];
    const mode = MODES[state.config.mode];
    // On a phone the right-hand corners belong to the thumbs: the fire button
    // is in one and the pause is in the other. Everything the HUD puts there
    // moves out of their way.
    this.thumbs = !!opts.touch;

    this.drawDamage(ctx, w, h, state, me);
    if (me.alive) this.drawCrosshair(ctx, w, h, me);
    this.drawVitals(ctx, w, h, s, me, state);
    this.drawScores(ctx, w, h, s, state, mode, me);
    this.drawFeed(ctx, w, h, s);
    this.drawShout(ctx, w, h, s);
    this.drawCall(ctx, w, h, s);
    if (!me.alive) this.drawDead(ctx, w, h, s, me);
    // Without the pointer there is no aim, and the only sign of it used to be a
    // mouse that did nothing. Now it says so.
    if (!opts.touch && !opts.locked && state.phase !== 'over') {
      this.centre(ctx, w, h * 0.62, 'CLICK TO TAKE THE MOUSE', 15 * s, 'rgba(255,209,102,0.9)');
    }
    if (state.phase === 'warmup') {
      this.centre(ctx, w, h * 0.36, `${state.map.name.toUpperCase()}`, 34 * s, '#f2efe6');
      this.centre(ctx, w, h * 0.36 + 26 * s,
        `${mode.name}${state.config.instagib ? ' · instagib' : ''}`, 15 * s, '#8f9aa6');
    }
    if (state.phase === 'over') this.drawOver(ctx, w, h, s, state, mode);
    if (opts.scoreboard || state.phase === 'over') this.drawBoard(ctx, w, h, s, state, mode, opts.index);
  }

  drawCrosshair(ctx, w, h, me) {
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const weapon = WEAPONS[me.weapon];
    // The crosshair opens as the gun's own spread opens, which is the only
    // honest way to show a number that changes while you hold the trigger.
    const spread = Math.min(weapon.spreadMax, weapon.spread + me.spread);
    const gap = 4 + spread * 260;
    const arm = weapon.kind === 'projectile' ? 9 : 6;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * gap + 0.5, cy + dy * gap + 0.5);
      ctx.lineTo(cx + dx * (gap + arm) + 0.5, cy + dy * (gap + arm) + 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    const since = this.time - this.hitAt;
    if (since < 0.34) {
      const k = 1 - since / 0.34;
      ctx.strokeStyle = `rgba(255,110,90,${k})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        ctx.moveTo(cx + dx * 5, cy + dy * 5);
        ctx.lineTo(cx + dx * 12, cy + dy * 12);
      }
      ctx.stroke();
    }
  }

  /** Red at the edges when you are hit, and a wedge pointing at whoever did it. */
  drawDamage(ctx, w, h, state, me) {
    const since = this.time - this.hurtAt;
    if (since > 1.2) return;
    const k = Math.max(0, 1 - since / 1.2);
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28,
      w / 2, h / 2, Math.max(w, h) * 0.62);
    grad.addColorStop(0, 'rgba(180,20,15,0)');
    grad.addColorStop(1, `rgba(180,20,15,${0.55 * k})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const from = this.hurtFrom >= 0 ? state.bodies[this.hurtFrom] : null;
    if (!from || from === me) return;
    // Where they are, relative to where you are looking. The canvas turns
    // clockwise and the marker below is drawn pointing up, so the bearing is the
    // rotation: nought is straight ahead, a quarter turn is off to the right.
    const bearing = Math.atan2(from.z - me.z, from.x - me.x) - (me.yaw / 65536) * Math.PI * 2;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(bearing);
    ctx.globalAlpha = k;
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.moveTo(0, -Math.min(w, h) * 0.22);
    ctx.lineTo(-13, -Math.min(w, h) * 0.22 + 22);
    ctx.lineTo(13, -Math.min(w, h) * 0.22 + 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawVitals(ctx, w, h, s, me, state) {
    const pad = 22 * s;
    // The numbers are drawn on this line and their labels and the weapon rack
    // hang below it, so the line itself has to sit a rack's height off the
    // bottom of the screen or the rack is drawn off the end of it.
    const bottom = h - pad - 36 * s;
    // With thumbs on, the bottom right corner is a fire button the size of a
    // thumb, so the ammunition moves along the bottom instead of up: up would
    // put it inside the button, and the button is 104 real pixels whatever the
    // HUD is scaled to.
    const rightEdge = this.thumbs ? pad + 320 * s : w - pad;
    ctx.textBaseline = 'alphabetic';

    // Health and armour, bottom left.
    ctx.font = `${34 * s}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'left';
    const low = me.health <= 30;
    ctx.fillStyle = low ? (Math.sin(this.time * 9) > 0 ? '#ff6a5a' : '#c8483c') : '#eef2f5';
    ctx.fillText(String(Math.max(0, me.health)), pad, bottom);
    ctx.font = `${12 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#7f8a95';
    ctx.fillText('HEALTH', pad + 2, bottom + 14 * s);

    if (me.armour > 0) {
      ctx.font = `${24 * s}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = '#7fb3ff';
      ctx.fillText(String(me.armour), pad + 92 * s, bottom - 2 * s);
      ctx.font = `${11 * s}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = '#5b7fa8';
      ctx.fillText('ARMOUR', pad + 94 * s, bottom + 14 * s);
    }

    const barW = 150 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(pad, bottom + 22 * s, barW, 4 * s);
    ctx.fillStyle = low ? '#e04a38' : '#5fd08a';
    ctx.fillRect(pad, bottom + 22 * s, barW * Math.max(0, me.health) / MAX_HEALTH, 4 * s);
    if (me.armour > 0) {
      ctx.fillStyle = '#4f88d8';
      ctx.fillRect(pad, bottom + 28 * s, barW * me.armour / MAX_ARMOUR, 3 * s);
    }

    // Ammunition and the gun in your hands, bottom right.
    const weapon = WEAPONS[me.weapon];
    ctx.textAlign = 'right';
    ctx.font = `${34 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#eef2f5';
    const ammo = me.ammo[me.weapon];
    ctx.fillText(Number.isFinite(ammo) ? String(ammo) : '∞', rightEdge, bottom);
    ctx.font = `${12 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#7f8a95';
    ctx.fillText(weapon.name.toUpperCase(), rightEdge - 2, bottom + 14 * s);

    // The rack: which guns you have found, and which one is up.
    if (!state.config.instagib) {
      let x = rightEdge;
      for (let i = WEAPONS.length - 2; i >= 0; i--) {
        const held = me.have[i] && me.ammo[i] > 0;
        const on = i === me.weapon;
        const boxW = 30 * s;
        x -= boxW + 5 * s;
        ctx.fillStyle = on ? 'rgba(255,220,140,0.9)' : held ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
        ctx.fillRect(x, bottom + 22 * s, boxW, 12 * s);
        ctx.fillStyle = on ? '#181510' : held ? '#dfe6ec' : '#4c545c';
        ctx.font = `${9 * s}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(WEAPONS[i].short, x + boxW / 2, bottom + 31 * s);
        ctx.textAlign = 'right';
      }
    }
  }

  drawScores(ctx, w, h, s, state, mode, me) {
    const pad = 18 * s;
    const rightPad = pad + (this.thumbs ? 58 * s : 0);
    ctx.textAlign = 'center';
    ctx.font = `${17 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#cdd5dd';
    ctx.fillText(clockText(state.clock), w / 2, pad + 16 * s);

    if (mode.teams) {
      const gap = 74 * s;
      for (let t = 0; t < 2; t++) {
        const x = w / 2 + (t === 0 ? -gap : gap);
        const team = TEAMS[t];
        ctx.font = `${30 * s}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = rgb(team.colour, me.team === t ? 1 : 0.72);
        ctx.fillText(String(state.teamScore[t]), x, pad + 26 * s);
        if (mode.flags) {
          const flag = state.flags.find((f) => f.team === t);
          const status = flag.status === 'home' ? '' : flag.status === 'carried' ? 'TAKEN' : 'DROPPED';
          ctx.font = `${10 * s}px ui-monospace, Menlo, monospace`;
          ctx.fillStyle = flag.status === 'home' ? '#5b646e' : '#ffd166';
          ctx.fillText(status, x, pad + 39 * s);
        }
      }
      return;
    }

    // Free for all: your score, and whoever is beating you.
    const table = standings(state);
    const leader = table[0];
    ctx.textAlign = 'right';
    ctx.font = `${26 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#eef2f5';
    ctx.fillText(String(me.score), w - rightPad, pad + 24 * s);
    ctx.font = `${11 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#c3ccd5';
    const place = table.indexOf(me) + 1;
    ctx.fillText(`${ordinal(place)} of ${table.length}  ·  leader ${leader.score}`,
      w - rightPad, pad + 38 * s);
  }

  drawFeed(ctx, w, h, s) {
    const pad = 18 * s;
    ctx.textAlign = 'left';
    ctx.font = `${12 * s}px ui-monospace, Menlo, monospace`;
    let y = pad + 14 * s;
    for (const row of this.feed) {
      const age = this.time - row.at;
      if (age > FEED_LIFE) continue;
      const alpha = Math.min(1, (FEED_LIFE - age) * 1.6);
      if (row.note) {
        ctx.fillStyle = `rgba(200,210,220,${alpha})`;
        ctx.fillText(row.note, pad, y);
      } else {
        const line = row.killer ? `${row.killer}  ▸  ${row.victim}` : `${row.victim}  ✕`;
        ctx.fillStyle = row.mine ? `rgba(255,214,102,${alpha})`
          : row.mineDeath ? `rgba(255,130,110,${alpha})` : `rgba(190,200,210,${alpha})`;
        ctx.fillText(line, pad, y);
      }
      y += 17 * s;
    }
  }

  drawShout(ctx, w, h, s) {
    if (!this.shout) return;
    const age = this.time - this.shout.at;
    if (age > SHOUT_LIFE) return;
    const alpha = Math.min(1, (SHOUT_LIFE - age) * 1.4);
    ctx.textAlign = 'center';
    ctx.font = `${22 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = rgb(this.shout.colour, alpha);
    ctx.fillText(this.shout.text, w / 2, h * 0.3);
  }

  /**
   * What the announcer said, in letters the size of the announcement.
   *
   * It grows for the first fifth of a second and then holds, which is the
   * cheapest way to make a word land rather than appear.
   */
  drawCall(ctx, w, h, s) {
    if (!this.call) return;
    const age = this.time - this.call.at;
    if (age > CALL_LIFE) return;
    const alpha = Math.min(1, (CALL_LIFE - age) * 2.2);
    const grow = Math.min(1, age / 0.16);
    const size = (26 + 10 * grow) * s;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${size}px ui-monospace, Menlo, monospace`;
    ctx.shadowColor = rgb(this.call.colour, 0.55 * alpha);
    ctx.shadowBlur = 18 * s;
    ctx.fillStyle = rgb(this.call.colour, alpha);
    // Letter-spaced by hand, because a canvas has no letterSpacing everywhere
    // yet and an announcement wants the room.
    const text = this.call.text.split('').join(' ');
    ctx.fillText(text, w / 2, h * 0.22);
    ctx.restore();
  }

  drawDead(ctx, w, h, s, me) {
    ctx.fillStyle = 'rgba(10,8,8,0.45)';
    ctx.fillRect(0, 0, w, h);
    const left = Math.max(0, Math.ceil(me.respawnIn / TICK_RATE));
    this.centre(ctx, w, h * 0.5, left > 0 ? `RESPAWN IN ${left}` : 'RESPAWNING', 26 * s, '#e8ecef');
  }

  drawOver(ctx, w, h, s, state, mode) {
    let line;
    if (mode.teams) {
      line = state.winner < 0 ? 'DRAWN'
        : `${TEAMS[state.winner].name.toUpperCase()} WINS`;
    } else {
      line = `${state.bodies[state.winner].name.toUpperCase()} WINS`;
    }
    this.centre(ctx, w, h * 0.2, line, 34 * s, '#ffd166');
  }

  drawBoard(ctx, w, h, s, state, mode, meIndex) {
    const rows = standings(state);
    const width = Math.min(w - 40 * s, 460 * s);
    const rowH = 22 * s;
    const height = (rows.length + 2) * rowH + 20 * s;
    const x = (w - width) / 2;
    const y = (h - height) / 2;
    ctx.fillStyle = 'rgba(12,13,16,0.86)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.textAlign = 'left';
    ctx.font = `${13 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#8f9aa6';
    ctx.fillText(`${state.map.name} · ${mode.name}${state.config.instagib ? ' · instagib' : ''}`,
      x + 16 * s, y + 22 * s);
    ctx.textAlign = 'right';
    ctx.fillText(clockText(state.clock), x + width - 16 * s, y + 22 * s);

    let ry = y + 46 * s;
    ctx.font = `${13 * s}px ui-monospace, Menlo, monospace`;
    for (const body of rows) {
      const mine = body.index === meIndex;
      if (mine) {
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.fillRect(x + 8 * s, ry - 14 * s, width - 16 * s, rowH);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = mode.teams && body.team >= 0 ? rgb(TEAMS[body.team].colour, 1)
        : (mine ? '#ffd166' : '#dfe6ec');
      ctx.fillText(body.name + (body.human ? '' : ' ·'), x + 16 * s, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#dfe6ec';
      ctx.fillText(String(body.score), x + width - 120 * s, ry);
      ctx.fillStyle = '#8f9aa6';
      ctx.fillText(String(body.kills), x + width - 72 * s, ry);
      ctx.fillText(String(body.deaths), x + width - 24 * s, ry);
      ry += rowH;
    }
    ctx.textAlign = 'right';
    ctx.font = `${10 * s}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = '#6b747d';
    ctx.fillText('SCORE   KILLS  DEATHS', x + width - 24 * s, y + 36 * s);
  }

  centre(ctx, w, y, text, size, colour) {
    ctx.textAlign = 'center';
    ctx.font = `${size}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = colour;
    ctx.fillText(text, w / 2, y);
  }
}

function rgb(colour, alpha = 1) {
  return `rgba(${Math.round(colour[0] * 255)},${Math.round(colour[1] * 255)},${Math.round(colour[2] * 255)},${alpha})`;
}

function ordinal(n) {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
