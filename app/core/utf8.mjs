/** Strict, lossless UTF-8 for Window AND AudioWorkletGlobalScope.
 * AudioWorklets do not guarantee TextEncoder/TextDecoder. No global polyfills.
 * Preserve U+FEFF (BOM) as payload rather than silently deleting a character.
 */
export function utf8Encode(text) {
  if (typeof text !== 'string') throw new TypeError('UTF-8 input must be text');
  const out=[];
  for (let i=0;i<text.length;i++) {
    let c=text.charCodeAt(i);
    if (c>=0xd800&&c<=0xdbff) {
      const low=text.charCodeAt(++i);
      if (!(low>=0xdc00&&low<=0xdfff)) throw new Error('Invalid Unicode surrogate');
      c=0x10000+((c-0xd800)<<10)+(low-0xdc00);
    } else if (c>=0xdc00&&c<=0xdfff) throw new Error('Invalid Unicode surrogate');
    if (c<0x80) out.push(c);
    else if (c<0x800) out.push(0xc0|(c>>6),0x80|(c&63));
    else if (c<0x10000) out.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));
  }
  return Uint8Array.from(out);
}
export function utf8Decode(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('UTF-8 input must be bytes');
  let out='';
  for (let i=0;i<bytes.length;) {
    const lead=bytes[i++]; let c,n,min;
    if (lead<0x80) { c=lead;n=0;min=0; }
    else if (lead>=0xc2&&lead<=0xdf) { c=lead&31;n=1;min=0x80; }
    else if (lead>=0xe0&&lead<=0xef) { c=lead&15;n=2;min=0x800; }
    else if (lead>=0xf0&&lead<=0xf4) { c=lead&7;n=3;min=0x10000; }
    else throw new Error('Invalid UTF-8 leading byte');
    if (i+n>bytes.length) throw new Error('Truncated UTF-8');
    for (let j=0;j<n;j++) { const b=bytes[i++];if ((b&0xc0)!==0x80) throw new Error('Invalid UTF-8 continuation');c=(c<<6)|(b&63); }
    if (c<min||c>0x10ffff||(c>=0xd800&&c<=0xdfff)) throw new Error('Invalid UTF-8 code point');
    out+=String.fromCodePoint(c);
  }
  return out;
}
