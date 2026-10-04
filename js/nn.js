// Tiny neural net + genetic algorithm. No libraries.
import { NN, GA, gauss } from './config.js';

const I = NN.inputs, Hn = NN.hidden, O = NN.outputs;
export const GENOME_LEN = Hn * (I + 1) + O * (Hn + 1);
export const W2_OFFSET = Hn * (I + 1);

let nextId = 1;

export function randomGenes(rng = Math.random) {
  const g = new Float32Array(GENOME_LEN);
  for (let i = 0; i < GENOME_LEN; i++) g[i] = gauss(rng) * 0.85;
  return g;
}

export const w1 = (g, j, i) => g[j * (I + 1) + i];
export const w2 = (g, j, i) => g[W2_OFFSET + j * (Hn + 1) + i];

export class Brain {
  constructor(genes) {
    this.g = genes;
    this.in = new Float32Array(I);
    this.h = new Float32Array(Hn);
    this.o = new Float32Array(O);
  }
  forward() {
    const g = this.g, x = this.in, h = this.h, o = this.o;
    let k = 0;
    for (let j = 0; j < Hn; j++) {
      let s = 0;
      for (let i = 0; i < I; i++) s += g[k++] * x[i];
      s += g[k++];
      h[j] = Math.tanh(s);
    }
    for (let j = 0; j < O; j++) {
      let s = 0;
      for (let i = 0; i < Hn; i++) s += g[k++] * h[i];
      s += g[k++];
      o[j] = Math.tanh(s);
    }
    return o;
  }
}

// Visible phenotype: offspring look like their parents, so you can SEE evolution.
const HUE_VEC = Array.from({ length: 24 }, (_, i) => Math.sin(i * 12.9898) * 1.7);
export function phenotype(genes) {
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < 24; i++) {
    a += genes[i] * HUE_VEC[i];
    b += genes[W2_OFFSET + i] * HUE_VEC[23 - i];
    c += genes[40 + i] * HUE_VEC[(i * 7) % 24];
  }
  const t = Math.tanh(a / 7), u = Math.tanh(b / 7), v = Math.tanh(c / 7);
  return {
    hue: (275 + 115 * (t + 1) / 2) % 360, // violet -> magenta -> red -> orange
    spikes: 3 + Math.round(2.5 * (u + 1)), // 3..8
    inner: 0.38 + 0.22 * (v + 1) / 2,
  };
}

export function makeGenome(genes, gen = 0, parent = null) {
  return { id: nextId++, genes, fitness: 0, gen, lineage: parent ? parent.lineage : nextId, pheno: phenotype(genes) };
}

function tournament(pop, rng, k = 3) {
  let best = null;
  for (let i = 0; i < k; i++) {
    const c = pop[(rng() * pop.length) | 0];
    if (!best || c.fitness > best.fitness) best = c;
  }
  return best;
}

export class Population {
  constructor(size = GA.pop, rng = Math.random) {
    this.rng = rng;
    this.generation = 0;
    this.genomes = Array.from({ length: size }, () => makeGenome(randomGenes(rng), 0));
    this.history = []; // {gen, best, avg}
    this.champion = this.genomes[0];
  }
  evolve() {
    const rng = this.rng;
    const pop = this.genomes.slice().sort((a, b) => b.fitness - a.fitness);
    const avg = pop.reduce((s, g) => s + g.fitness, 0) / pop.length;
    this.history.push({ gen: this.generation, best: pop[0].fitness, avg });
    this.champion = pop[0];
    this.generation++;
    const next = [];
    for (let i = 0; i < GA.elite; i++) {
      const e = makeGenome(pop[i].genes, pop[i].gen, pop[i]);
      e.prevFitness = pop[i].fitness;
      next.push(e);
    }
    while (next.length < pop.length) {
      const a = tournament(pop, rng), b = tournament(pop, rng);
      const child = new Float32Array(GENOME_LEN);
      // neuron-block crossover keeps useful neurons intact
      let k = 0;
      for (let j = 0; j < NN.hidden; j++) {
        const src = rng() < 0.5 ? a.genes : b.genes;
        for (let i = 0; i <= NN.inputs; i++, k++) child[k] = src[k];
      }
      for (let j = 0; j < NN.outputs; j++) {
        const src = rng() < 0.5 ? a.genes : b.genes;
        for (let i = 0; i <= NN.hidden; i++, k++) child[k] = src[k];
      }
      for (let i = 0; i < GENOME_LEN; i++) {
        if (rng() < GA.mutRate) child[i] += gauss(rng) * GA.mutSigma;
        else if (rng() < 0.004) child[i] = gauss(rng) * 0.85;
      }
      next.push(makeGenome(child, this.generation, a.fitness >= b.fitness ? a : b));
    }
    this.genomes = next;
  }
  // pick genomes for a real wave: champion first, then elites, then diverse picks
  sample(n) {
    const pop = this.genomes.slice().sort((a, b) => (b.prevFitness ?? b.fitness) - (a.prevFitness ?? a.fitness));
    const out = [];
    for (let i = 0; i < n; i++) out.push(i < 3 ? pop[i % pop.length] : pop[(Math.random() * Math.min(pop.length, 14)) | 0]);
    return out;
  }
}
