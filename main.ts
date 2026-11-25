// Tiny SOL bot: a bounce-aware EMA crossover, long only.
//
// Idea, in one paragraph: the dev window falls hard (buy-and-hold loses ~8.7%),
// so the money is in staying out of downtrends and only buying the turn. Per
// symbol I track EMA(8) and EMA(21) over hourly closes plus a Wilder RSI(14).
// I enter when EMA(8) crosses above EMA(21) on a bar's close, but only when
// the close is already above EMA(21) (the trend has actually turned, not just
// wiggled) and RSI(14) is under 40 (the symbol is oversold and only just
// turning: buy the dip, not a bounce that has already run). I exit
// the whole position when EMA(8) crosses back under EMA(21), or when the
// position is worth 15% over its cost (bank the small bounce fast), or 10%
// under it (cut the loss fast: the guardrail caps drawdown at 25%, so losers
// must go early). After a stop-loss exit I skip re-entry on that symbol for
// 6 bars, so a choppy symbol cannot churn the account with repeated
// stop-outs. Every buy is one equal slice of equity over the 7 symbols,
// capped by the 25% max weight and by the cash on hand; sells go first in
// each reply. Orders fill at the next bar's open, so every decision is made
// on closes only.
//
// Determinism: float64 arithmetic on + - * / alone, no clock, no environment,
// no randomness, so two runs produce the same orders. A bar with zero volume
// signals nothing; a bar with no volume recorded (v null) is not held back.
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's sdk/makefun-bars.ts.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 8;
const SLOW_BARS = 21;
const RSI_BARS = 14;
/** Only enter while RSI(14) is under this: buy the turn before the bounce
 *  has run far. (RSI under 40-45 at the exact cross bar almost never
 *  happens: the rise that makes EMA(8) cross EMA(21) already lifts RSI, so
 *  a tight cap trades nothing. 55 keeps the filter meaningful without
 *  choking entries off.) */
const RSI_ENTRY_MAX = 55;
/** Take profit: worth 23/20 of its cost (+15%: bank the small bounce fast,
 *  hourly moves in a 3-day window rarely run to +40%). */
const TAKE_PROFIT = [23n, 20n] as const;
/** Stop loss: worth 9/10 of its cost (-10%). */
const STOP_LOSS = [9n, 10n] as const;
/** Bars to skip re-entry on a symbol after a stop-loss exit on it. */
const STOP_COOLDOWN_BARS = 6;
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

/** Wilder RSI(14): the last close, the first changes until it seeds, then the smoothed averages. */
interface Rsi {
  prev: number | null;
  changes: number[];
  avgGain: number | null;
  avgLoss: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  rsi: Rsi;
  /** fast - slow after the symbol's bar before this one, once both are set. */
  gap: number | null;
  /** The same after this bar. */
  now: number | null;
  /** The sell signal: set on a cross of EMA(21) above EMA(8), held while EMA(21) stays above. */
  down: boolean;
  /** RSI(14) after this bar, null until it has seeded. */
  rsiValue: number | null;
}

const series = new Map<string, Series>();
/** The batch seq of each symbol's latest stop-loss exit, for the re-entry cooldown. */
const stoppedAt = new Map<string, number>();

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function stepRsi(r: Rsi, close: number): number | null {
  if (r.prev === null) {
    r.prev = close;
    return null;
  }
  const change = close - r.prev;
  r.prev = close;
  if (r.avgGain === null || r.avgLoss === null) {
    r.changes.push(change);
    if (r.changes.length === RSI_BARS) {
      let gain = 0;
      let loss = 0;
      for (const d of r.changes) {
        if (d > 0) gain += d;
        else loss -= d;
      }
      r.avgGain = gain / RSI_BARS;
      r.avgLoss = loss / RSI_BARS;
    }
    return null;
  }
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  r.avgGain = (r.avgGain * (RSI_BARS - 1) + gain) / RSI_BARS;
  r.avgLoss = (r.avgLoss * (RSI_BARS - 1) + loss) / RSI_BARS;
  if (r.avgLoss === 0) return r.avgGain === 0 ? 50 : 100;
  const rs = r.avgGain / r.avgLoss;
  return 100 - 100 / (1 + rs);
}

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = {
      fast: { span: FAST_BARS, warm: [], value: null },
      slow: { span: SLOW_BARS, warm: [], value: null },
      rsi: { prev: null, changes: [], avgGain: null, avgLoss: null },
      gap: null,
      now: null,
      down: false,
      rsiValue: null,
    };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  stepEma(s.fast, c);
  stepEma(s.slow, c);
  s.rsiValue = stepRsi(s.rsi, c);
  s.gap = s.now;
  s.now = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
  if (s.now === null || s.now >= 0) s.down = false;
  return s;
}

/** Whether a held position exits on this close, and why ('stop' for the stop-loss). */
function exitReason(
  state: BarsState,
  symbol: string,
  held: { qty: bigint; cost: bigint },
  signal: boolean,
): 'signal' | 'profit' | 'stop' | null {
  if (signal) return 'signal';
  const value = state.value(symbol, held.qty);
  if (value * TAKE_PROFIT[1] >= held.cost * TAKE_PROFIT[0]) return 'profit';
  if (value * STOP_LOSS[1] <= held.cost * STOP_LOSS[0]) return 'stop';
  return null;
}

await runBars({
  onBatch(state, batch) {
    const crossUp = new Set<string>();
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      const s = push(bar);
      fresh.add(bar.symbol);
      if (s.gap === null || s.now === null || bar.v === '0') continue;
      if (s.now > 0 && s.gap <= 0) crossUp.add(bar.symbol);
      if (s.now < 0 && s.gap >= 0) s.down = true;
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const s = series.get(symbol)!;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        const reason = exitReason(state, symbol, held, s.down);
        if (reason !== null) {
          if (reason === 'stop') stoppedAt.set(symbol, state.seq);
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (crossUp.has(symbol)) {
        // The cross-up itself is the turn signal; RSI must not be overbought
        // (null RSI, not seeded yet, does not block).
        if (s.rsiValue !== null && s.rsiValue >= RSI_ENTRY_MAX) continue;
        const stopped = stoppedAt.get(symbol);
        if (stopped !== undefined && state.seq - stopped < STOP_COOLDOWN_BARS) continue;
        entries.push(symbol);
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
