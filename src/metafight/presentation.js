import { YAW_UNITS } from '../constants.js';

// Tick-based cues freeze with the match. Bearing is captured once on a real hit.
export class CombatFeedback {
  constructor() { this.reset(); }
  reset() { this.hitUntil=0; this.killUntil=0; this.hurtUntil=0; this.bearing=null; this.victim=''; this.fireUntil=0; this.emptyHeld=false; this.headshot=false; this.damageAmount=0; this.lastVictim=-1; }
  consume(state, events, index=0) {
    const me=state.bodies[index], sounds=[];
    for(const e of events) {
      if(e.type==='fire' && e.body===index) this.fireUntil=state.tick+4;
      if(e.type==='hit' && e.body===index) { this.hitUntil=state.tick+18; this.headshot=!!e.head; this.lastVictim=e.victim; sounds.push(e.head?'headshot':'hit'); }
      if(e.type==='death' && e.killer===index && e.body!==index) {
        this.killUntil=state.tick+90; this.victim=state.bodies[e.body].name; sounds.push('kill');
      }
      if(e.type==='hurt' && e.body===index) {
        this.hurtUntil=state.tick+72; this.damageAmount=e.amount||0;
        const from=state.bodies[e.from];
        this.bearing=from ? Math.atan2(from.z-me.z,from.x-me.x) : null;
      }
      if(e.body===index && ['reload','reload-complete'].includes(e.type)) sounds.push(e.type);
      if(e.type==='spawn' && e.body===index) this.reset();
    }
    return sounds;
  }
  emptyTrigger(pressed, player) {
    const cue=pressed&&!this.emptyHeld&&player.alive&&!player.reloadUntil&&player.ammo[0]===0;
    this.emptyHeld=pressed; return cue;
  }
  view(state, yaw) {
    const me=state.bodies[0],tick=state.tick;
    const status=!me.alive?'respawn':me.reloadUntil?'reload':me.shield?'protected':!me.ammo[0]?'empty':me.health<=25?'danger':'ready';
    const angle=this.bearing===null?null:Math.atan2(Math.sin(this.bearing-yaw/YAW_UNITS*Math.PI*2),Math.cos(this.bearing-yaw/YAW_UNITS*Math.PI*2));
    const direction=angle===null?'':Math.abs(angle)<Math.PI/4?'前方':Math.abs(angle)>Math.PI*3/4?'后方':angle>0?'右侧':'左侧';
    return {status,headshot:this.headshot,damageAmount:this.damageAmount,direction,hit:tick<this.hitUntil,kill:tick<this.killUntil,victim:this.victim,
      hurt:me.alive&&tick<this.hurtUntil,angle,
      fire:tick<this.fireUntil,reloadProgress:me.reloadUntil?1-Math.max(0,me.reloadUntil-tick)/state.rules.reloadTicks:0};
  }
}

export const GUIDE_STEPS = [
  {title:'左手移动，右手瞄准',body:'左侧拖动控制移动；右侧空白区域滑动转向。用集装箱作掩体，看到敌人后再露出射击。',symbol:'↔',hint:'左侧移动区　│　右侧瞄准区'},
  {title:'按住开火，自动换弹',body:'按住开火连续射击，拖动开火键也能转向。弹匣30发，打空后自动换弹，耗时2秒；持续按住开火，换好后继续射击。也可点击换弹提前补满。跳跃键用于越过低矮障碍。',symbol:'◎',hint:'开火　·　自动换弹　·　跳跃'},
  {title:'认清队友，再上甲板',body:'红色菱形“友”是队友，蓝色三角“敌”是对手。先到50分获胜，限时5分钟；阵亡3秒后复活，开火会结束出生保护。',symbol:'◆　▼',hint:'友方红色　│　敌方蓝色'},
];
