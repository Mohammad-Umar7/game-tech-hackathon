// Pack evolved brains into a URL so you can send your nemesis to a friend.
import { GENOME_LEN } from './nn.js';

const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export function encodeHunters(genomes, generation, wave) {
  const n = Math.min(4, genomes.length);
  const out = new Uint8Array(4 + n * GENOME_LEN);
  out[0] = 1; out[1] = n; out[2] = Math.min(255, generation >> 2); out[3] = Math.min(255, wave);
  for (let j = 0; j < n; j++) for (let k = 0; k < GENOME_LEN; k++) {
    const q = Math.max(-127, Math.min(127, Math.round(genomes[j].genes[k] / 4 * 127)));
    out[4 + j * GENOME_LEN + k] = q & 255;
  }
  return b64u(out);
}

export function decodeHunters(str) {
  try {
    const b = unb64u(str);
    if (b[0] !== 1) return null;
    const n = b[1], genes = [];
    if (b.length !== 4 + n * GENOME_LEN) return null;
    for (let j = 0; j < n; j++) {
      const g = new Float32Array(GENOME_LEN);
      for (let k = 0; k < GENOME_LEN; k++) { let v = b[4 + j * GENOME_LEN + k]; if (v > 127) v -= 256; g[k] = v / 127 * 4; }
      genes.push(g);
    }
    return { genes, generation: b[2] << 2, wave: b[3] };
  } catch (e) { return null; }
}
