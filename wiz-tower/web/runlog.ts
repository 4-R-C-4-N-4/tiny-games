/**
 * Run recorder — Phase 6 Slice 3b. Captures the human's play, wave by wave, as a reusable
 * training log. The best player sets a higher bar than the heuristic Archmage, so their real
 * boards are premium teacher data. Everything is client-side: play, then download a JSON.
 *
 * Per wave it snapshots the committed defense (the training board), the telegraphed opener +
 * reserve the attacker actually fired, and the outcome — so a log is both a board dataset and
 * a full replay of what beat (or didn't beat) that board.
 */
import { fxToFloat } from '../src/fx.ts';
import type { Game } from '../src/game.ts';
import { snapshotBoard, type BoardSnapshot } from '../src/board-io.ts';
import { featurize } from '../src/model.ts';
import type { Opener, Commit } from '../src/wave.ts';

interface GroupSnap { t?: number; x: number; element: number; trait: number; count: number; }

export interface WaveRecord {
  wave: number;
  diff: number;
  opponent: string;
  board: BoardSnapshot; //  the defense committed for this wave (the training board)
  features: number[]; //    featurize(obs) — the 10-dim vector the net reads
  telegraph: GroupSnap[]; //the opener the attacker showed
  committed: GroupSnap[][];//the reserve it fired at decision points
  intent?: string; //       the Mind's stated plan
  coreHpBefore: number;
  coreHpAfter: number;
  leakedHp: number;
  currencyDelta: number; //  bounty income this wave
  breaches: number;
}

export interface RunLog {
  version: number;
  seed: string;
  difficulty: number;
  opponent: string;
  result: 'in-progress' | 'gameover';
  wavesReached: number;
  records: WaveRecord[];
}

const serSpawn = (s: Opener[number]): GroupSnap => ({ t: s.t, x: s.x, element: s.group.element, trait: s.group.trait, count: s.group.count });
const serCommit = (c: Commit): GroupSnap => ({ x: c.x, element: c.group.element, trait: c.group.trait, count: c.group.count });

export class RunRecorder {
  private records: WaveRecord[] = [];
  private pending: WaveRecord | null = null;

  get count(): number { return this.records.length; }

  /** Call right before startWave(): snapshot the board + context the player committed. */
  onWaveStart(g: Game): void {
    this.pending = {
      wave: g.wave, diff: g.diff, opponent: g.opponent,
      board: snapshotBoard(g.sim),
      features: featurize(g.sim.observe()),
      telegraph: (g.telegraph ?? []).map(serSpawn),
      committed: [],
      intent: g.attackerIntent || undefined,
      coreHpBefore: fxToFloat(g.coreHp()),
      coreHpAfter: 0, leakedHp: 0, currencyDelta: 0, breaches: 0,
    };
  }

  /** Call once the wave leaves the 'wave' state: record the outcome + what the reserve fired. */
  onWaveEnd(g: Game): void {
    if (!this.pending) return;
    const m = g.lastRecap?.metrics;
    this.pending.coreHpAfter = fxToFloat(g.coreHp());
    this.pending.committed = (g.attacker.committed ?? []).map((cs) => cs.map(serCommit));
    if (m) { this.pending.leakedHp = fxToFloat(m.leakedHp); this.pending.currencyDelta = m.currencyDelta; this.pending.breaches = m.breaches; }
    this.records.push(this.pending);
    this.pending = null;
  }

  reset(): void { this.records = []; this.pending = null; }

  build(g: Game): RunLog {
    const seed = (g as unknown as { seed?: bigint }).seed;
    return {
      version: 1,
      seed: seed !== undefined ? String(seed) : '',
      difficulty: g.diff,
      opponent: g.opponent,
      result: g.state === 'gameover' ? 'gameover' : 'in-progress',
      wavesReached: g.highestWave,
      records: this.records.slice(),
    };
  }
}

/** Trigger a browser download of the run log as JSON. */
export function downloadRunLog(log: RunLog): void {
  const blob = new Blob([JSON.stringify(log)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wiz-tower-run-${log.records.length}w-r${log.difficulty}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
