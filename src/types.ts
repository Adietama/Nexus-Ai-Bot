export interface Metrics {
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  unrealized_pnl: number;
  total_trades: number;
  win_rate: number;
  daily_profit_usd: number;
}

export interface DayChecklist {
  bias_h4_aligned: boolean;
  bias_h1_aligned: boolean;
  trigger_m15: boolean;
  trigger_m5: boolean;
  stochastic_condition: boolean;
}

export interface ScalperChecklist {
  bias_m15_aligned: boolean;
  trigger_m5: boolean;
  trigger_m1: boolean;
  stochastic_condition: boolean;
}

export interface AssetSignal {
  symbol: string;
  strategy: string;
  ticks_collected?: number;
  ticks_needed?: number;
  status?: string; // "BUILD_HISTORY" or "ACTIVE"
  bias: string; // "BULLISH", "BEARISH", "CONFLICT", "HOLD"
  h4_ema21?: number;
  h4_ema34?: number;
  h1_ema21?: number;
  h1_ema34?: number;
  m15_ema21?: number;
  m15_ema34?: number;
  m5_ema21?: number;
  m5_ema34?: number;
  m1_ema21?: number;
  m1_ema34?: number;
  stoch_k: number;
  stoch_d: number;
  signal: string; // "BUY", "SELL", "HOLD"
  reason: string;
  confidence: number;
  current_price: number;
  checklist: DayChecklist | ScalperChecklist | any;
}

export interface OpenPosition {
  id: number;
  symbol: string;
  type: string; // "BUY" or "SELL"
  entry_price: number;
  current_price: number;
  qty: number;
  lot_usd: number;
  unrealized_pnl: number;
  signal_triggers: string;
  timestamp: string;
  status: string; // "OPEN"
}

export interface ClosedTrade {
  id: number;
  symbol: string;
  type: string; // "BUY" or "SELL"
  entry_price: number;
  exit_price: number;
  qty: number;
  lot_usd: number;
  pnl: number;
  percentage: number;
  outcome: "WIN" | "LOSE";
  signal_triggers: string;
  timestamp: string;
}

export interface EquityPoint {
  time: string;
  balance: number;
  pnl: number;
}

export interface BotStatusResponse {
  strategy_mode: "DAY" | "SCALPER";
  is_simulated: boolean;
  metrics: Metrics;
  signals: AssetSignal[];
  open_positions: OpenPosition[];
  closed_trades: ClosedTrade[];
  equity_curve: EquityPoint[];
  log_feed: string[];
}
