import { Chess } from 'chess.js';
import { computeStaticMaterialEval } from './analyzers';

export interface EngineLine {
  from: string;
  to: string;
  cp: number; // theo góc nhìn Trắng (pawn * 100)
}

export interface EngineAnalysis {
  lines: EngineLine[];
  evalPawns: number; // theo góc nhìn Trắng
}

class StockfishService {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Web Worker unavailable'));
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        const base = import.meta.env?.BASE_URL ?? './';
        const url = `${base.endsWith('/') ? base : `${base}/`}stockfish/stockfish.js`;
        const w = new Worker(url);
        this.worker = w;

        const timer = setTimeout(() => {
          reject(new Error('Stockfish init timeout'));
        }, 12000);

        const onMsg = (e: MessageEvent<string>) => {
          const line = String(e.data || '');
          if (line.includes('readyok')) {
            clearTimeout(timer);
            w.removeEventListener('message', onMsg);
            resolve();
          }
        };
        w.addEventListener('message', onMsg);
        w.addEventListener('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        w.postMessage('uci');
        w.postMessage('isready');
      } catch (err) {
        reject(err);
      }
    });

    return this.readyPromise;
  }

  private runQueued<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  async analyze(
    fen: string,
    depth: number,
    multiPv: number = 1,
    movetimeMs: number = 1500
  ): Promise<EngineAnalysis> {
    try {
      await this.init();
      return await this.runQueued(() => this.runUciSearch(fen, depth, multiPv, movetimeMs));
    } catch {
      return this.fallbackAnalyze(fen, multiPv);
    }
  }

  private runUciSearch(
    fen: string,
    depth: number,
    multiPv: number,
    movetimeMs: number
  ): Promise<EngineAnalysis> {
    return new Promise<EngineAnalysis>((resolve) => {
      const w = this.worker;
      if (!w) {
        resolve(this.fallbackAnalyze(fen, multiPv));
        return;
      }

      const turn = new Chess(fen).turn();
      const sign = turn === 'w' ? 1 : -1;
      const pvMap = new Map<number, EngineLine>();
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        w.removeEventListener('message', onMsg);
        const sorted = Array.from(pvMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => v);
        if (sorted.length === 0) {
          resolve(this.fallbackAnalyze(fen, multiPv));
          return;
        }
        resolve({
          lines: sorted,
          evalPawns: Math.round((sorted[0].cp / 100) * 10) / 10,
        });
      };

      const hardTimer = setTimeout(() => {
        try {
          w.postMessage('stop');
        } catch {
          // ignore
        }
        setTimeout(finish, 120);
      }, movetimeMs + 300);

      const onMsg = (e: MessageEvent<string>) => {
        const line = String(e.data || '');
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
          const pvNum = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;
          const pvMatch = line.match(/\bpv\s+([a-h][1-8])([a-h][1-8])/);
          if (!pvMatch) return;

          let cp = 0;
          const cpMatch = line.match(/\bscore cp\s+(-?\d+)/);
          const mateMatch = line.match(/\bscore mate\s+(-?\d+)/);
          if (cpMatch) {
            cp = parseInt(cpMatch[1], 10) * sign;
          } else if (mateMatch) {
            const m = parseInt(mateMatch[1], 10);
            cp = (m > 0 ? 3000 : -3000) * sign;
          }

          pvMap.set(pvNum, {
            from: pvMatch[1],
            to: pvMatch[2],
            cp,
          });
        } else if (line.startsWith('bestmove ')) {
          const bm = line.match(/^bestmove\s+([a-h][1-8])([a-h][1-8])/);
          if (bm && !pvMap.has(1)) {
            pvMap.set(1, { from: bm[1], to: bm[2], cp: 0 });
          }
          finish();
        }
      };

      w.addEventListener('message', onMsg);
      w.postMessage(`setoption name MultiPV value ${multiPv}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${depth} movetime ${movetimeMs}`);
    });
  }

  private fallbackAnalyze(fen: string, multiPv: number): EngineAnalysis {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    const lines: EngineLine[] = moves.slice(0, multiPv).map((m) => {
      const copy = new Chess(fen);
      copy.move(m);
      return {
        from: m.from,
        to: m.to,
        cp: Math.round(computeStaticMaterialEval(copy.fen()) * 100),
      };
    });
    return {
      lines,
      evalPawns: Math.round(computeStaticMaterialEval(fen) * 10) / 10,
    };
  }
}

export const stockfishService = new StockfishService();
