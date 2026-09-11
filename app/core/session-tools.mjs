/** UI/session helpers; this code never sends audio, calls AI, or persists content. */
const SPEEDS = [120, 300, 600, 1200];
export function connectionCode(options) {
  const {room, session, wpm, maxTurns, maxReplyBytes} = options;
  if (!/^[0-9]{4}$/.test(room) || !Number.isInteger(session) || session <= 0 || session > 0xffffffff ||
      !SPEEDS.includes(wpm) || !Number.isInteger(maxTurns) || maxTurns < 2 || maxTurns > 32 ||
      !Number.isInteger(maxReplyBytes) || maxReplyBytes < 32 || maxReplyBytes > 512) {
    throw new Error('通信コード・セッション・速度・会話上限を確認してください。');
  }
  return `MT2|${room}|${session.toString(16).toUpperCase().padStart(8, '0')}|${wpm}|${maxTurns}|${maxReplyBytes}`;
}
export function parseConnectionCode(text) {
  if (typeof text !== 'string' || text.length > 100) throw new Error('接続コードが長すぎます。');
  const match = /^MT2\|([0-9]{4})\|([0-9a-fA-F]{8})\|(120|300|600|1200)\|([1-9][0-9]?)\|([1-9][0-9]{1,2})$/.exec(text.trim());
  if (!match) throw new Error('接続コードは「MT2|…」の形式です。相手のコードをそのまま貼り付けてください。');
  const result = {room:match[1], session:parseInt(match[2],16), wpm:Number(match[3]), maxTurns:Number(match[4]), maxReplyBytes:Number(match[5])};
  connectionCode(result); // All fields validate before the UI changes even one of them.
  return result;
}
export function newSessionId(random = globalThis.crypto) {
  if (typeof random?.getRandomValues !== 'function') throw new Error('安全な乱数を利用できません。両端に同じ新しいセッションを入力してください。');
  const value = new Uint32Array(1);
  for (let attempt=0; attempt<8; attempt++) { random.getRandomValues(value); if (value[0]) return value[0]; }
  throw new Error('セッションを生成できませんでした。もう一度操作してください。');
}
export function importProgress(state) {
  const valid = n => Number.isSafeInteger(n) && n >= 0;
  const bytes = valid(state?.copiedBytes) ? state.copiedBytes : 0;
  const total = valid(state?.totalBytes) && state.totalBytes > 0 ? state.totalBytes : null;
  return {bytes, total, fraction: total ? Math.min(1, bytes / total) : null};
}
/** Bounded, in-memory diagnostics. Redacted export is the default. */
export class SessionJournal {
  constructor(clock=()=>performance.now(), limit=400) {
    if (!Number.isInteger(limit) || limit < 4 || limit > 2000) throw new Error('Invalid journal capacity');
    this.clock=clock; this.limit=limit; this.reset('idle');
  }
  reset(mode) { this.mode=mode; this.started=this.clock(); this.ended=null; this.events=[]; this.dropped=0; this.delivered=new Set(); this.received=new Set(); this.retries=0; }
  record(event) {
    const item={kind:String(event.kind||'event').slice(0,48),ms:Math.max(0,this.clock()-this.started)};
    for (const key of ['seq','sender','attempt','bytes','inferenceMs','signalSeconds']) {
      if (Number.isFinite(event[key]) && event[key]>=0) item[key]=event[key];
    }
    for (const key of ['text','message']) if (typeof event[key]==='string') item[key]=event[key].slice(0,8192);
    if (item.kind==='delivered' && Number.isInteger(item.seq)) this.delivered.add(item.seq);
    if (item.kind==='peer' && Number.isInteger(item.seq)) this.received.add(item.seq);
    if (item.kind==='transmit' && item.attempt>0) this.retries++;
    if (this.events.length===this.limit) { this.events.shift(); this.dropped++; }
    this.events.push(item);
  }
  finish() { if (this.ended===null) this.ended=this.clock(); }
  get elapsedMs() { return Math.max(0,(this.ended??this.clock())-this.started); }
  get turns() { return new Set([...this.delivered,...this.received]).size; }
  export(includeText=false) {
    return {schema:'morsetalk-session-1', appVersion:'0.3.1', mode:this.mode, elapsedMs:this.elapsedMs,
      completedTurns:this.turns, retries:this.retries, droppedEvents:this.dropped,
      containsConversation:includeText===true, physicalLinkVerified:false,
      note:'Execution log, not proof of physical acoustics. Endpoint configuration, consent, room and authentication token fields are not exported. Explicitly included conversation may contain private data.',
      events:this.events.map(e=>{
        const result={...e}; delete result.message;if(includeText!==true)delete result.text; return result;
      })};
  }
}
