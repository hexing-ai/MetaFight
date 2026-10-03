/**
 * The announcer.
 *
 * The synthesiser in speech.js is shared with websoccer, webtennis, webracing
 * and webtrack and knows nothing about any of them - it is given phonemes and it
 * says them. This is this game's half: about sixty words, and the rule about
 * when to use them.
 *
 * The rule is the one Unreal Tournament worked out and nobody has improved on:
 * the announcer speaks when something has happened that you would want somebody
 * to have seen. Two kills in four seconds is one of those. Twenty without dying
 * is another. Everything else - who is winning, how much ammunition you have,
 * where your flag is - is on the screen already, and a voice that read the
 * screen out would be a voice everybody turns off in the menu inside a minute.
 *
 * Spelled out in phonemes rather than letters because the synthesiser has no
 * pronunciation rules and is not getting any: "unstoppable" is eleven sounds and
 * writing them down is quicker than teaching a machine English.
 */

export const WORDS = {
  first: ['F', 'ER', 'S', 'T'],
  blood: ['B', 'L', 'AH', 'D'],
  double: ['D', 'AH', 'B', 'AH', 'L'],
  triple: ['T', 'R', 'IH', 'P', 'AH', 'L'],
  multi: ['M', 'AH', 'L', 'T', 'IY'],
  mega: ['M', 'EH', 'G', 'AH'],
  ultra: ['AH', 'L', 'T', 'R', 'AH'],
  monster: ['M', 'AA', 'N', 'S', 'T', 'ER'],
  ludicrous: ['L', 'UW', 'D', 'IH', 'K', 'R', 'AH', 'S'],
  kill: ['K', 'IH', 'L'],
  killing: ['K', 'IH', 'L', 'IH', 'N'],
  spree: ['S', 'P', 'R', 'IY'],
  rampage: ['R', 'AE', 'M', 'P', 'EY', 'JH'],
  dominating: ['D', 'AA', 'M', 'IH', 'N', 'EY', 'T', 'IH', 'N'],
  unstoppable: ['AH', 'N', 'S', 'T', 'AA', 'P', 'AH', 'B', 'AH', 'L'],
  godlike: ['G', 'AA', 'D', 'L', 'AY', 'K'],
  wicked: ['W', 'IH', 'K', 'IH', 'D'],
  sick: ['S', 'IH', 'K'],
  ended: ['EH', 'N', 'D', 'IH', 'D'],
  payback: ['P', 'EY', 'B', 'AE', 'K'],
  denied: ['D', 'IH', 'N', 'AY', 'D'],
  excellent: ['EH', 'K', 'S', 'AH', 'L', 'AH', 'N', 'T'],

  red: ['R', 'EH', 'D'],
  blue: ['B', 'L', 'UW'],
  flag: ['F', 'L', 'AE', 'G'],
  team: ['T', 'IY', 'M'],
  taken: ['T', 'EY', 'K', 'AH', 'N'],
  dropped: ['D', 'R', 'AA', 'P', 'T'],
  returned: ['R', 'IH', 'T', 'ER', 'N', 'D'],
  scores: ['S', 'K', 'AO', 'R', 'Z'],
  captured: ['K', 'AE', 'P', 'CH', 'ER', 'D'],

  fight: ['F', 'AY', 'T'],
  you: ['Y', 'UW'],
  win: ['W', 'IH', 'N'],
  victory: ['V', 'IH', 'K', 'T', 'ER', 'IY'],
  defeat: ['D', 'IH', 'F', 'IY', 'T'],
  match: ['M', 'AE', 'CH'],
  over: ['OW', 'V', 'ER'],
  is: ['IH', 'Z'],
  the: ['DH', 'AH'],
  last: ['L', 'AE', 'S', 'T'],
  one: ['W', 'AH', 'N'],
  two: ['T', 'UW'],
  three: ['TH', 'R', 'IY'],
  to: ['T', 'UW'],
  go: ['G', 'OW'],
  humiliation: ['HH', 'Y', 'UW', 'M', 'IH', 'L', 'IY', 'EY', 'SH', 'AH', 'N'],
};

/**
 * Lines per event, sometimes several.
 *
 * Taken in turn rather than at random by the synthesiser, so that three double
 * kills in a row are not the same two words three times - which is the thing
 * that makes a speaking game sound broken rather than sound like a game.
 *
 * The multi-kill ladder is the tournament one and the numbers are its numbers:
 * two in four seconds is a double, three is a multi, and it goes up from there
 * to a name that is plainly a joke, because by then so is the situation.
 */
export const LINES = {
  firstblood: ['first blood'],

  multi2: ['double kill'],
  multi3: ['multi kill'],
  multi4: ['mega kill'],
  multi5: ['ultra kill'],
  multi6: ['monster kill'],
  multi7: ['ludicrous kill'],

  spree5: ['killing spree'],
  spree10: ['rampage'],
  spree15: ['dominating'],
  spree20: ['unstoppable'],
  spree25: ['godlike'],
  spree30: ['wicked sick'],
  spreeend: ['spree ended'],

  revenge: ['payback'],
  excellent: ['excellent'],

  fight: ['fight'],
  takenRed: ['red flag taken'],
  takenBlue: ['blue flag taken'],
  returnRed: ['red flag returned'],
  returnBlue: ['blue flag returned'],
  dropRed: ['red flag dropped'],
  dropBlue: ['blue flag dropped'],
  scoreRed: ['red team scores'],
  scoreBlue: ['blue team scores'],
  denied: ['denied'],

  won: ['victory', 'you win'],
  lost: ['defeat'],
  over: ['match over'],
};

/** What each rung of the two ladders is called on screen, in the same order. */
export const MULTI_NAMES = [
  '', '', 'DOUBLE KILL', 'MULTI KILL', 'MEGA KILL', 'ULTRA KILL', 'MONSTER KILL', 'LUDICROUS KILL',
];

export const SPREE_NAMES = {
  5: 'KILLING SPREE',
  10: 'RAMPAGE',
  15: 'DOMINATING',
  20: 'UNSTOPPABLE',
  25: 'GODLIKE',
  30: 'WICKED SICK',
};

/** The same, in the third person, for the feed down the side of the screen. */
export const SPREE_FEED = {
  5: 'is on a killing spree',
  10: 'is on a rampage',
  15: 'is dominating',
  20: 'is unstoppable',
  25: 'is godlike',
  30: 'is wicked sick',
};
