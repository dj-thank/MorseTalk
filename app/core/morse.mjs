/** Morse character layer. Unsupported characters are never silently dropped. */
export const INTERNATIONAL = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', É: '..-..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '/': '-..-.',
  '(': '-.--.', ')': '-.--.-', ':': '---...', '"': '.-..-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '@': '.--.-.'
});
const DIGITS = Object.fromEntries(Object.entries(INTERNATIONAL).filter(([k]) => /^\d$/.test(k)));
export const WABUN = Object.freeze({
  'ア':'--.--', 'イ':'.-', 'ウ':'..-', 'エ':'-.---', 'オ':'.-...',
  'カ':'.-..', 'キ':'-.-..', 'ク':'...-', 'ケ':'-.--', 'コ':'----',
  'サ':'-.-.-', 'シ':'--.-.', 'ス':'---.-', 'セ':'.---.', 'ソ':'---.',
  'タ':'-.', 'チ':'..-.', 'ツ':'.--.', 'テ':'.-.--', 'ト':'..-..',
  'ナ':'.-.', 'ニ':'-.-.', 'ヌ':'....', 'ネ':'--.-', 'ノ':'..--',
  'ハ':'-...', 'ヒ':'--..-', 'フ':'--..', 'ヘ':'.', 'ホ':'-..',
  'マ':'-..-', 'ミ':'..-.-', 'ム':'-', 'メ':'-...-', 'モ':'-..-.',
  'ヤ':'.--', 'ユ':'-..--', 'ヨ':'--', 'ラ':'...', 'リ':'--.',
  'ル':'-.--.', 'レ':'---', 'ロ':'.-.-', 'ワ':'-.-', 'ヰ':'.-..-',
  'ヱ':'.--..', 'ヲ':'.---', 'ン':'.-.-.',
  '\u3099':'..', '\u309a':'..--.', 'ー':'.--.-', '、':'.-.-.-', '。':'.-.-..',
  '（':'-.--.-', '）':'.-..-.', ...DIGITS
});
const SMALL = Object.freeze({ァ:'ア',ィ:'イ',ゥ:'ウ',ェ:'エ',ォ:'オ',ッ:'ツ',ャ:'ヤ',ュ:'ユ',ョ:'ヨ',ヮ:'ワ',ヵ:'カ',ヶ:'ケ'});
const REVERSE = {
  international: new Map(Object.entries(INTERNATIONAL).map(([k,v]) => [v,k])),
  wabun: new Map(Object.entries(WABUN).map(([k,v]) => [v,k]))
};
export function tableFor(mode) {
  if (mode === 'international') return INTERNATIONAL;
  if (mode === 'wabun') return WABUN;
  throw new Error('文字方式が不正です。');
}
export function normalizeText(text, mode = 'international') {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('入力が長すぎます（最大4096文字）。');
  let s = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (mode === 'international') return s.toUpperCase().replace(/[’‘]/gu, "'").replace(/[“”]/gu, '"').replace(/[‐‑–—]/gu, '-');
  tableFor(mode);
  s = s.replace(/[ぁ-ゖ]/gu, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  s = [...s].map(ch => SMALL[ch] || ch).join('');
  s = s.replace(/\(/g, '（').replace(/\)/g, '）').replace(/,/g,'、').replace(/\./g, '。');
  return s.normalize('NFD');
}
export function encodeText(text, mode = 'international') {
  const normalized = normalizeText(text, mode), table = tableFor(mode);
  const unknown = [...new Set([...normalized].filter(c => c !== ' ' && !Object.hasOwn(table, c)))];
  if (unknown.length) throw new Error(mode === 'wabun'
    ? `和文に変換できません：${unknown.join(' ')}。漢字・英字は読みのかなに直すか「端末間」を選んでください。`
    : `欧文に変換できません：${unknown.join(' ')}。「端末間」は日本語・絵文字にも対応します。`);
  const code = [...normalized].map(c => c === ' ' ? '/' : table[c]).join(' ');
  return { code, normalized: normalized.normalize('NFC'), lossy: normalized.normalize('NFC') !== text };
}
export function normalizeCode(code) {
  if (typeof code !== 'string' || code.length > 32768) throw new Error('符号が長すぎます。');
  const s = code.replace(/[・·•]/gu,'.').replace(/[－−—ー]/gu,'-').replace(/\s+/gu, ' ').trim();
  if (/[^.\-/ ]/.test(s)) throw new Error('符号には「.」「-」、文字間の空白、単語間の「/」だけを使います。');
  if (s.split(/[ /]+/).some(t => t.length > 12)) throw new Error('1文字の符号が長すぎます。');
  return s.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}
export function decodeCode(code, mode = 'international', { strict = true } = {}) {
  tableFor(mode);
  const normalized = normalizeCode(code);
  if (!normalized) return { text: '', unknown: [] };
  const unknown = [];
  const text = normalized.split(' ').map(token => {
    if (token === '/') return ' ';
    const ch = REVERSE[mode].get(token);
    if (ch === undefined) { unknown.push(token); return '�'; }
    return ch;
  }).join('').normalize('NFC').trim();
  if (strict && unknown.length) throw new Error(`不明な符号：${[...new Set(unknown)].join(' ')}。方式と文字の区切りを確認してください。`);
  return { text, unknown };
}
export function validateTiming({wpm = 40, frequency = 700, volume = 0.25, experimental = false} = {}) {
  if (!Number.isFinite(wpm) || wpm <= 0 || !Number.isFinite(1.2/wpm) || (!experimental && (wpm < 8 || wpm > 60))) throw new Error(experimental?'速度は0より大きい有限のWPMにしてください。':'速度は8〜60 WPMにしてください。');
  if (!Number.isFinite(frequency) || frequency < 400 || frequency > (experimental?4000:1200)) throw new Error(experimental?'周波数は400〜4000 Hzにしてください。':'周波数は400〜1200 Hzにしてください。');
  if (!Number.isFinite(volume) || volume < 0 || volume > 0.8) throw new Error('音量は0〜0.8の範囲です。');
  return {wpm, frequency, volume, unit: 1.2 / wpm};
}
/** ITU 1/3/7 unit timing. Silence is emitted once, not added twice. */
export function codeToSegments(code, wpm = 40, { leadUnits = 7, tailUnits = 18, experimental = false } = {}) {
  const {unit} = validateTiming({wpm,experimental});
  if (!Number.isFinite(leadUnits) || !Number.isFinite(tailUnits) || leadUnits < 0 || tailUnits < 0 || leadUnits > 100 || tailUnits > 100) throw new Error('無音長が不正です。');
  const s = normalizeCode(code);
  if (!s) return [];
  const words = s.split(/\s*\/\s*/).filter(Boolean).map(w => w.trim().split(/\s+/));
  const result = [];
  const add = (on, units) => { if (units > 0) result.push({on, seconds: units * unit}); };
  add(false, leadUnits);
  words.forEach((word, wi) => {
    if (wi) add(false, 7);
    word.forEach((letter, ci) => {
      if (ci) add(false, 3);
      [...letter].forEach((mark, mi) => {
        if (mi) add(false, 1);
        add(true, mark === '.' ? 1 : 3);
      });
    });
  });
  add(false, Math.max(tailUnits, 1.1 / unit)); // enough for the streaming idle delimiter
  return result;
}
export function durationOf(segments) { return segments.reduce((n,s) => n+s.seconds,0); }
/** Bounded PCM generator for tests and WAV export. Playback itself is streamed. */
export function synthesize(segments, { sampleRate = 16000, frequency = 700, volume = 0.25, maxSeconds = 600, experimental = false } = {}) {
  validateTiming({ frequency, volume, experimental });
  const duration = durationOf(segments);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || duration > maxSeconds) throw new Error('音声データが大きすぎるか、サンプルレートが不正です。');
  const pcm = new Float32Array(Math.ceil(duration * sampleRate));
  let elapsed = 0;
  for (const s of segments) {
    const start = Math.round(elapsed * sampleRate); elapsed += s.seconds;
    const end = Math.min(pcm.length, Math.round(elapsed * sampleRate));
    if (!s.on) continue;
    const ramp = Math.max(1, Math.min(Math.round(0.003 * sampleRate), Math.floor((end-start)/4)));
    for (let i=start; i<end; i++) {
      const env = Math.min(1, (i-start)/ramp, (end-1-i)/ramp);
      pcm[i] = volume * Math.max(0, env) * Math.sin(2 * Math.PI * frequency * i / sampleRate);
    }
  }
  return pcm;
}
export function pcmToWav(samples, sampleRate = 16000) {
  if (!(samples instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('PCM入力が不正です。');
  const bytes = new Uint8Array(44 + samples.length * 2), v = new DataView(bytes.buffer);
  const text = (offset,s) => [...s].forEach((c,i) => v.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF'); v.setUint32(4,36+samples.length*2,true); text(8,'WAVE'); text(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sampleRate,true);
  v.setUint32(28,sampleRate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); text(36,'data');
  v.setUint32(40,samples.length*2,true);
  for (let i=0;i<samples.length;i++) { const x=Math.max(-1,Math.min(1,samples[i]||0)); v.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true); }
  return bytes;
}
