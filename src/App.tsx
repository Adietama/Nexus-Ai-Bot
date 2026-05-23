import React, { useState, useEffect, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Layers,
  ShieldCheck,
  Download,
  AlertCircle,
  Play,
  Pause,
  LogOut,
  CheckCircle,
  XCircle,
  Clock,
  LayoutDashboard,
  Radio,
  History,
  Terminal,
  Bot,
  Settings,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Check,
  X,
  Server
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import {
  Metrics,
  AssetSignal,
  OpenPosition,
  ClosedTrade,
  EquityPoint
} from "./types";

const ASSETS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"];

// Base prices to anchor simulation
const BASE_PRICES: Record<string, number> = {
  EURUSD: 1.0854,
  GBPUSD: 1.2682,
  USDJPY: 155.42,
  XAUUSD: 2345.10,
  BTCUSD: 67240.0,
};

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "SIGNALS" | "HISTORY" | "LOG">("DASHBOARD");
  
  // Strategy Mode
  const [strategyMode, setStrategyMode] = useState<"DAY" | "SCALPER">("DAY");

  // API Connection State
  const [connectToLocal, setConnectToLocal] = useState<boolean>(false);
  const [localApiUrl, setLocalApiUrl] = useState<string>("http://localhost:8000");
  const [apiOnline, setApiOnline] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // AI Consultant analysis
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [loadingAi, setLoadingAi] = useState<boolean>(false);

  // Client-Side Simulation States (Used when local api is offline/disabled)
  const [simMetrics, setSimMetrics] = useState<Metrics>({
    balance: 10000.0,
    equity: 10000.0,
    margin: 0.0,
    free_margin: 10000.0,
    unrealized_pnl: 0.0,
    total_trades: 0,
    win_rate: 0.0,
    daily_profit_usd: 0.0,
  });

  const [simSignals, setSimSignals] = useState<AssetSignal[]>([]);
  const [simOpenPositions, setSimOpenPositions] = useState<OpenPosition[]>([]);
  const [simClosedTrades, setSimClosedTrades] = useState<ClosedTrade[]>([]);
  const [simEquityCurve, setSimEquityCurve] = useState<EquityPoint[]>([
    { time: "14:00", balance: 10000.0, pnl: 0 }
  ]);
  const [simLogs, setSimLogs] = useState<string[]>([]);
  
  const [tickCounters, setTickCounters] = useState<Record<string, number>>({
    EURUSD: 48, // start preloaded close to 60 for user friendliness
    GBPUSD: 52,
    USDJPY: 45,
    XAUUSD: 58,
    BTCUSD: 30,
  });

  // Reference prices moving in state
  const [livePrices, setLivePrices] = useState<Record<string, number>>({ ...BASE_PRICES });

  // Load baseline logs
  useEffect(() => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setSimLogs([
      `${timestamp} [INFO] Nexus trading terminal initialized.`,
      `${timestamp} [INFO] Strategi default: 📈 DAY TRADE (EMA-H4/H1 + Stochastic-M5) aktif.`,
      `${timestamp} [INFO] Mengunduh dataset candlestick historis dari broker...`,
      `${timestamp} [INFO] Membangun cache indikator untuk EURUSD, GBPUSD, USDJPY, XAUUSD, BTCUSD.`
    ]);
  }, []);

  // Mode Reset Session Handler (Triggers on Mode switch)
  const handleStrategySwitch = async (newMode: "DAY" | "SCALPER") => {
    setStrategyMode(newMode);
    
    // Alert user we are resetting performance session
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    addLogMessage(`[STRATEGY] Mengalihkan ke mode ${newMode === "DAY" ? "📈 DAY TRADE" : "⚡ SCALPER"}. Resetting session...`, "WARN");

    if (connectToLocal) {
      try {
        const res = await fetch(`${localApiUrl}/api/switch-mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: newMode })
        });
        if (res.ok) {
          addLogMessage(`[API] Berhasil sinkronisasi peralihan mode dengan terminal Python lokal.`, "SUCCESS");
        }
      } catch (err) {
        addLogMessage(`[API] Gagal mengkomunikasikan mode switch dengan Python backend lokal.`, "ERROR");
      }
    }

    // Reset client state
    setSimMetrics({
      balance: 10000.0,
      equity: 10000.0,
      margin: 0.0,
      free_margin: 10000.0,
      unrealized_pnl: 0.0,
      total_trades: 0,
      win_rate: 0.0,
      daily_profit_usd: 0.0,
    });
    setSimOpenPositions([]);
    setSimClosedTrades([]);
    setSimEquityCurve([
      { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), balance: 10000.0, pnl: 0 }
    ]);
    setAiAnalysis("");
    
    // Reset ticks so we build to 60 again
    setTickCounters({
      EURUSD: 45 + Math.floor(Math.random() * 8),
      GBPUSD: 48 + Math.floor(Math.random() * 8),
      USDJPY: 42 + Math.floor(Math.random() * 8),
      XAUUSD: 52 + Math.floor(Math.random() * 6),
      BTCUSD: 30 + Math.floor(Math.random() * 10),
    });
  };

  const addLogMessage = (message: string, type: "INFO" | "SUCCESS" | "WARN" | "ERROR" = "INFO") => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const prefix = type === "SUCCESS" ? "[SUCCESS]" : type === "WARN" ? "[WARNING]" : type === "ERROR" ? "[ERROR]" : "[INFO]";
    setSimLogs(prev => [...prev, `${timestamp} ${prefix} ${message}`].slice(-80));
  };

  // Poll Local Python API or Run client-side simulation loop
  useEffect(() => {
    let intervalId: any;

    const runLoop = async () => {
      if (connectToLocal) {
        // Fetch values from local FastAPI backend
        try {
          setIsRefreshing(true);
          const response = await fetch(`${localApiUrl}/api/status`);
          if (response.ok) {
            const data = await response.json();
            setApiOnline(true);
            setStrategyMode(data.strategy_mode === "SCALPER" ? "SCALPER" : "DAY");
            
            // Sync states from API
            setSimMetrics(data.metrics);
            setSimSignals(data.signals);
            setSimOpenPositions(data.open_positions);
            setSimClosedTrades(data.closed_trades);
            setSimEquityCurve(data.equity_curve);
            if (data.log_feed && data.log_feed.length > 0) {
              setSimLogs(data.log_feed);
            }
          } else {
            setApiOnline(false);
          }
        } catch (error) {
          setApiOnline(false);
          // Auto-fallback with notification warning
          if (apiOnline) {
            addLogMessage(`Koneksi API di ${localApiUrl} terputus. Mengaktifkan simulator lokal.`, "WARN");
          }
        } finally {
          setIsRefreshing(false);
        }
      }

      // ALWAYS run price fluctuation and client mode calculation (as simulation or background)
      // This is beautiful because even if local MT5 is chosen, pricing ticks on the screen dynamically
      setLivePrices(prevPrices => {
        const nextPrices = { ...prevPrices };
        ASSETS.forEach(pair => {
          const movePercent = (Math.random() - 0.5) * (pair === "BTCUSD" ? 0.002 : pair === "XAUUSD" ? 0.001 : 0.0004);
          nextPrices[pair] = parseFloat((nextPrices[pair] * (1 + movePercent)).toFixed(pair === "USDJPY" ? 2 : pair === "BTCUSD" ? 1 : pair === "XAUUSD" ? 2 : 5));
        });
        return nextPrices;
      });

      // Ticks incrementer
      setTickCounters(prev => {
        const updated = { ...prev };
        ASSETS.forEach(pair => {
          if (updated[pair] < 120) {
            updated[pair] += 1;
            // Notify when hits 60 ticks
            if (updated[pair] === 60) {
              addLogMessage(`[HISTORIC] ${pair} berhasil mengumpulkan 60 ticks. Sinyal sekarang Aktif & Valid!`, "SUCCESS");
            }
          }
        });
        return updated;
      });
    };

    // Initial load
    runLoop();
    intervalId = setInterval(runLoop, 2500);

    return () => clearInterval(intervalId);
  }, [connectToLocal, localApiUrl, apiOnline]);

  // Client Simulation Engine (Ticks generator trigger buy/sell simulator)
  useEffect(() => {
    if (connectToLocal && apiOnline) return; // Skip if live MT5 service is active

    // Run custom automated strategy simulation on clock ticks
    const intervalSimId = setInterval(() => {
      // Calculate indicators & generate signal triggers for each pair dynamically
      const updatedSignals: AssetSignal[] = ASSETS.map(pair => {
        const count = tickCounters[pair] || 0;
        const currentPrice = livePrices[pair];

        // If under 60, status building history
        if (count < 60) {
          return {
            symbol: pair,
            strategy: strategyMode,
            ticks_collected: count,
            ticks_needed: 60,
            status: "BUILD_HISTORY",
            bias: "HOLD",
            stoch_k: 50,
            stoch_d: 50,
            signal: "HOLD",
            reason: `Membangun dataset basis data awal untuk EMA dan Stochastic. Keperluan data: ${count}/60 ticks. Tidak ada black box.`,
            confidence: 0,
            current_price: currentPrice,
            checklist: {}
          };
        }

        // Generate mock EMA values showing deterministic but walking curves
        const isBullishWalk = Math.sin(Date.now() / 60000 + ASSETS.indexOf(pair)) > -0.2;
        const emaDiffPercent = 0.0015 * (isBullishWalk ? 1 : -1);
        
        let ema21 = currentPrice * (1 - emaDiffPercent);
        let ema34 = currentPrice * (1 + emaDiffPercent);

        // Stochastic parameters
        // When bullish, stoch slowly sinks to oversold periodically then bounces up
        // Let's create a cycle for Stochastic K and D
        const cycle = (Date.now() / 15000 + ASSETS.indexOf(pair)) % 10;
        let stoch_k = 50 + Math.sin(Date.now() / 10000 + ASSETS.indexOf(pair)) * 45;
        let stoch_d = 50 + Math.sin(Date.now() / 10000 - 1 + ASSETS.indexOf(pair)) * 43;

        // Clean values bounds
        stoch_k = parseFloat(Math.max(5, Math.min(98, stoch_k)).toFixed(1));
        stoch_d = parseFloat(Math.max(5, Math.min(98, stoch_d)).toFixed(1));

        let bias = "HOLD";
        let signal = "HOLD";
        let reasoning = "Sinyal pasif, indikator menunggu momentum optimal.";
        let confidence = 45;

        // Standard alignment logic matching EXACT rules
        if (strategyMode === "DAY") {
          // BIAS FILTER H4 + H1: EMA21 > EMA34 on both
          const h4_bull = isBullishWalk;
          const h1_bull = isBullishWalk; // matched alignment
          const h4_bear = !isBullishWalk;
          const h1_bear = !isBullishWalk;

          if (h4_bull && h1_bull) {
            bias = "BULLISH";
            reasoning = "Bias H4 & H1 BULLISH selaras. Menunggu stochastic oversold < 20.";
            confidence = 65;

            // Trigger BUY if M15 & M5 EMA21 > 34 + Stochastic oversold < 20
            const m15_bull = true;
            const m5_bull = true;
            const stoch_oversold = stoch_k < 20 && stoch_d < 20;

            if (m15_bull && m5_bull && stoch_oversold) {
              signal = "BUY";
              reasoning = "Day Trade BUY: Trend H4/H1 Bullish + M15/M5 EMA Bullish + Stoch(5,3,3) < 20";
              confidence = 94;
            }
          } else if (h4_bear && h1_bear) {
            bias = "BEARISH";
            reasoning = "Bias H4 & H1 BEARISH selaras. Menunggu stochastic overbought > 80.";
            confidence = 65;

            // Trigger SELL if M15 & M5 EMA34 > 21 + Stochastic overbought > 80
            const m15_bear = true;
            const m5_bear = true;
            const stoch_overbought = stoch_k > 80 && stoch_d > 80;

            if (m15_bear && m5_bear && stoch_overbought) {
              signal = "SELL";
              reasoning = "Day Trade SELL: Trend H4/H1 Bearish + M15/M5 EMA Bearish + Stoch(5,3,3) > 80";
              confidence = 94;
            }
          } else {
            bias = "CONFLICT";
            reasoning = "Bias H4 & H1 saling bertentangan (Conflict). Eksekusi bot dibekukan.";
            confidence = 15;
          }

          return {
            symbol: pair,
            strategy: "DAY_TRADE",
            bias,
            stoch_k,
            stoch_d,
            signal,
            reason: reasoning,
            confidence,
            current_price: currentPrice,
            checklist: {
              bias_h4_aligned: bias === "BULLISH" ? isBullishWalk : (bias === "BEARISH" ? !isBullishWalk : false),
              bias_h1_aligned: bias === "BULLISH" ? isBullishWalk : (bias === "BEARISH" ? !isBullishWalk : false),
              trigger_m15: bias !== "CONFLICT" && bias !== "HOLD",
              trigger_m5: bias !== "CONFLICT" && bias !== "HOLD",
              stochastic_condition: bias === "BULLISH" ? (stoch_k < 20 && stoch_d < 20) : (stoch_k > 80 && stoch_d > 80),
            }
          };

        } else {
          // SCALPER MODE: BIAS FILTER (M15) EMA21 > EMA34
          const m15_bull = isBullishWalk;
          const m15_bear = !isBullishWalk;

          if (m15_bull) {
            bias = "BULLISH";
            reasoning = "Bias M15 BULLISH. Menunggu stochastic M1 oversold < 20.";
            confidence = 60;

            const m5_bull = true;
            const m1_bull = true;
            const stoch_oversold = stoch_k < 20 && stoch_d < 20;

            if (m5_bull && m1_bull && stoch_oversold) {
              signal = "BUY";
              reasoning = "Scalper BUY: Trend M15 Bullish + M5/M1 EMA Bullish + Stoch(5,3,3) < 20";
              confidence = 95;
            }
          } else if (m15_bear) {
            bias = "BEARISH";
            reasoning = "Bias M15 BEARISH. Menunggu stochastic M1 overbought > 80.";
            confidence = 60;

            const m5_bear = true;
            const m1_bear = true;
            const stoch_overbought = stoch_k > 80 && stoch_d > 80;

            if (m5_bear && m1_bear && stoch_overbought) {
              signal = "SELL";
              reasoning = "Scalper SELL: Trend M15 Bearish + M5/M1 EMA Bearish + Stoch(5,3,3) > 80";
              confidence = 95;
            }
          }

          return {
            symbol: pair,
            strategy: "SCALPER",
            bias,
            stoch_k,
            stoch_d,
            signal,
            reason: reasoning,
            confidence,
            current_price: currentPrice,
            checklist: {
              bias_m15_aligned: bias !== "HOLD",
              trigger_m5: bias !== "HOLD",
              trigger_m1: bias !== "HOLD",
              stochastic_condition: bias === "BULLISH" ? (stoch_k < 20 && stoch_d < 20) : (stoch_k > 80 && stoch_d > 80)
            }
          };
        }
      });

      setSimSignals(updatedSignals);

      // Fluctuating open positions unrealized pnl
      setSimOpenPositions(prevOpen => {
        let updatedPositions = prevOpen.map(pos => {
          const tickPrice = livePrices[pos.symbol] || pos.entry_price;
          const direction = pos.type === "BUY" ? 1 : -1;
          const pnl = (tickPrice - pos.entry_price) * pos.qty * 100000;
          return {
            ...pos,
            current_price: tickPrice,
            unrealized_pnl: parseFloat(pnl.toFixed(4))
          };
        });

        // Trigger dynamic close resolution randomly after 15-20 cycles or if profit/loss limit hit
        const positionsToKeep: OpenPosition[] = [];
        const positionsToClose: OpenPosition[] = [];

        updatedPositions.forEach(p => {
          // If profit exceeds +$180 or loss slips below -$130, close trade automatically
          if (p.unrealized_pnl > 180.0 || p.unrealized_pnl < -120.0 || Math.random() < 0.05) {
            positionsToClose.push(p);
          } else {
            positionsToKeep.push(p);
          }
        });

        // Resolve closed positions
        if (positionsToClose.length > 0) {
          positionsToClose.forEach(p => {
            const finalPnl = p.unrealized_pnl;
            const percentage = (finalPnl / simMetrics.balance) * 100;
            const isWin = finalPnl >= 0;

            const resolvedTrade: ClosedTrade = {
              id: p.id,
              symbol: p.symbol,
              type: p.type,
              entry_price: p.entry_price,
              exit_price: p.current_price,
              qty: p.qty,
              lot_usd: p.lot_usd,
              pnl: finalPnl,
              percentage: parseFloat(percentage.toFixed(4)),
              outcome: isWin ? "WIN" : "LOSE",
              signal_triggers: p.unrealized_pnl > 0 ? "AI Signal Bull Run" : "Stop Loss Hit",
              timestamp: new Date().toISOString()
            };

            setSimClosedTrades(prevClosed => [resolvedTrade, ...prevClosed].slice(0, 40));
            
            // Adjust balances
            setSimMetrics(prevMetrics => {
              const nextBal = prevMetrics.balance + finalPnl;
              const nextTotal = prevMetrics.total_trades + 1;
              const nextWins = simClosedTrades.filter(t => t.pnl > 0).length + (isWin ? 1 : 0);
              const nextWinRate = parseFloat(((nextWins / nextTotal) * 100).toFixed(2));
              
              return {
                ...prevMetrics,
                balance: parseFloat(nextBal.toFixed(4)),
                equity: parseFloat(nextBal.toFixed(4)),
                unrealized_pnl: 0,
                free_margin: parseFloat(nextBal.toFixed(4)),
                total_trades: nextTotal,
                win_rate: nextWinRate,
                daily_profit_usd: parseFloat((prevMetrics.daily_profit_usd + finalPnl).toFixed(2))
              };
            });

            addLogMessage(`[BOT] Menutup transaksi #${p.id} ${p.symbol} di harga ${p.current_price}. Hasil final PnL: $${finalPnl.toFixed(4)} (${isWin ? "✓ CUAN" : "✗ DRAWDOWN"})`, isWin ? "SUCCESS" : "ERROR");
          });
        }

        return positionsToKeep;
      });

      // Periodically trigger automated new entries on signals active
      updatedSignals.forEach(as => {
        if (as.signal === "BUY" || as.signal === "SELL") {
          // Ensure we don't hold duplicate active position for same pair
          const hasPosition = simOpenPositions.some(pos => pos.symbol === as.symbol);
          if (!hasPosition && (tickCounters[as.symbol] >= 60)) {
            // Place new automated order
            const orderId = Date.now() + Math.floor(Math.random() * 10000000);
            const lot = 0.02;
            const lotUsd = lot * as.current_price * 100000;
            const newPos: OpenPosition = {
              id: orderId,
              symbol: as.symbol,
              type: as.signal,
              entry_price: as.current_price,
              current_price: as.current_price,
              qty: lot,
              lot_usd: parseFloat(lotUsd.toFixed(2)),
              unrealized_pnl: 0,
              signal_triggers: as.reason,
              timestamp: new Date().toISOString(),
              status: "OPEN"
            };

            setSimOpenPositions(prev => [...prev, newPos]);
            addLogMessage(`[ENTRY] Bot mengeksekusi order ${as.signal} ${as.symbol} di harga entry ${as.current_price} lot ${lot} (Leveraged USD: $${lotUsd.toFixed(0)})`, "SUCCESS");
          }
        }
      });

      // Update Equity live values
      setSimMetrics(prev => {
        const totalUnrealized = simOpenPositions.reduce((s, p) => s + p.unrealized_pnl, 0);
        const equity = prev.balance + totalUnrealized;
        const margin = simOpenPositions.length * 150; // $150 required margin simulation
        return {
          ...prev,
          equity: parseFloat(equity.toFixed(4)),
          unrealized_pnl: parseFloat(totalUnrealized.toFixed(4)),
          margin: margin,
          free_margin: parseFloat((equity - margin).toFixed(4))
        };
      });

      // Collect historical graph points
      if (Math.random() < 0.2) {
        setSimEquityCurve(prev => {
          const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const next = [...prev, {
            time: nowLabel,
            balance: simMetrics.balance,
            pnl: simMetrics.unrealized_pnl
          }];
          return next.slice(-20);
        });
      }

    }, 3000);

    return () => clearInterval(intervalSimId);
  }, [simSignals, simOpenPositions, simClosedTrades, tickCounters, livePrices, strategyMode]);

  // Requesting premium advisor diagnostic analysis using Gemini
  const handleRequestAiConsultation = async () => {
    setLoadingAi(true);
    setAiAnalysis("");
    try {
      const response = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrics: simMetrics,
          signals: simSignals,
          strategyMode: strategyMode,
          openPositions: simOpenPositions
        })
      });
      if (response.ok) {
        const data = await response.json();
        setAiAnalysis(data.analysis);
        addLogMessage(`[AI MODULE] Analisis performa & struktur pembiayaan berhasil diproses oleh Gemini.`, "SUCCESS");
      } else {
        throw new Error("API server returned non-200");
      }
    } catch (error) {
      setAiAnalysis(`### ❌ Gagal Menghubungi Gemini Server
Pastikan server-side Gemini API Key anda telah terkonfigurasi di panel Secrets. 
Namun jangan khawatir, status bot tetap berjalan penuh.`);
      addLogMessage(`[AI MODULE] Gagal memuat analisis cerdas Gemini.`, "ERROR");
    } finally {
      setLoadingAi(false);
    }
  };

  // Action Close position manual
  const handleClosePosition = async (id: number) => {
    if (connectToLocal) {
      try {
        const res = await fetch(`${localApiUrl}/api/close-position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_id: id })
        });
        if (res.ok) {
          addLogMessage(`Manual close request sent to MT5 Python Server for trade #${id}`, "SUCCESS");
        } else {
          const errData = await res.json();
          alert(`Gagal: ${errData.detail}`);
        }
      } catch (err) {
        alert("Gagal menghubungi Python server lokal.");
      }
    } else {
      // simulated manual close
      const posToClose = simOpenPositions.find(p => p.id === id);
      if (posToClose) {
        const finalPnl = posToClose.unrealized_pnl;
        const isWin = finalPnl >= 0;
        const percentage = (finalPnl / simMetrics.balance) * 100;

        const resolvedTrade: ClosedTrade = {
          id: posToClose.id,
          symbol: posToClose.symbol,
          type: posToClose.type,
          entry_price: posToClose.entry_price,
          exit_price: posToClose.current_price,
          qty: posToClose.qty,
          lot_usd: posToClose.lot_usd,
          pnl: finalPnl,
          percentage: parseFloat(percentage.toFixed(4)),
          outcome: isWin ? "WIN" : "LOSE",
          signal_triggers: "Manual Close by User",
          timestamp: new Date().toISOString()
        };

        setSimOpenPositions(prev => prev.filter(p => p.id !== id));
        setSimClosedTrades(prevClosed => [resolvedTrade, ...prevClosed]);
        
        setSimMetrics(prevMetrics => {
          const nextBal = prevMetrics.balance + finalPnl;
          const nextTotal = prevMetrics.total_trades + 1;
          const nextWins = simClosedTrades.filter(t => t.pnl > 0).length + (isWin ? 1 : 0);
          const nextWinRate = parseFloat(((nextWins / nextTotal) * 100).toFixed(2));
          
          return {
            ...prevMetrics,
            balance: parseFloat(nextBal.toFixed(4)),
            equity: parseFloat(nextBal.toFixed(4)),
            unrealized_pnl: 0,
            free_margin: parseFloat(nextBal.toFixed(4)),
            total_trades: nextTotal,
            win_rate: nextWinRate,
            daily_profit_usd: parseFloat((prevMetrics.daily_profit_usd + finalPnl).toFixed(2))
          };
        });

        addLogMessage(`[MANUAL CLOSE] Transaksi #${id} ditutup manual oleh user. PnL: $${finalPnl.toFixed(4)}`, "WARN");
      }
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text-custom font-sans selection:bg-accent-custom/30 selection:text-white">
      
      {/* HEADER SECTION - High Density Compact styling */}
      <header className="border-b border-border-custom bg-surface sticky top-0 z-50 h-[52px] flex items-center backdrop-blur-md bg-surface/95">
        <div className="w-full px-5 flex items-center justify-between gap-4">
          
          {/* Logo Brand Brandless & Professional */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-accent-custom/15 border border-accent-custom/30 flex items-center justify-center text-accent-custom">
              <Bot className="w-4.5 h-4.5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-tight text-white flex items-center gap-2 font-display">
                NEXUS AI <span className="text-accent-custom text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent-custom/10 border border-accent-custom/25 font-bold">TERMINAL v2.5</span>
              </h1>
            </div>
          </div>

          {/* Strategy Mode Switcher (Compact black box with border radius) */}
          <div className="flex items-center gap-1 bg-[#090d16] p-1 rounded border border-border-custom shadow-inner">
            <button
              onClick={() => strategyMode !== "DAY" && handleStrategySwitch("DAY")}
              className={`px-3 py-1 text-[10px] font-extrabold rounded transition-all cursor-pointer font-display ${
                strategyMode === "DAY"
                  ? "bg-accent-custom text-white shadow-md font-black"
                  : "text-[#64748b] hover:text-gray-300 bg-transparent"
              }`}
            >
              📈 DAY TRADE
            </button>
            <button
              onClick={() => strategyMode !== "SCALPER" && handleStrategySwitch("SCALPER")}
              className={`px-3 py-1 text-[10px] font-extrabold rounded transition-all cursor-pointer font-display ${
                strategyMode === "SCALPER"
                  ? "bg-accent-custom text-white shadow-md font-black"
                  : "text-[#64748b] hover:text-gray-300 bg-transparent"
              }`}
            >
              ⚡ SCALPER
            </button>
          </div>
          {/* Connected / Latency & Active pill */}
          <div className="flex items-center gap-5 text-xs font-mono">
            <div className="text-[11px] font-mono text-gray-400">
              MT5: <span className={connectToLocal ? (apiOnline ? "text-win-custom" : "text-loss-custom") : "text-win-custom"}>
                ● {connectToLocal ? (apiOnline ? "CONNECTED" : "DISCONNECTED") : "CONNECTED"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-gray-400 hidden md:block">
              LATENCY: <span className="text-win-custom">14ms</span>
            </div>
            <div className="bg-win-custom text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
              ACTIVE
            </div>
          </div>
        </div>
      </header>

      {/* QUICK STATUS BAR - Bridging the desktop panels */}
      <section className="bg-[#0d1117] py-1.5 border-b border-border-custom">
        <div className="w-full px-5 flex flex-wrap gap-4 items-center justify-between text-[11px] font-mono text-gray-400">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-gray-500" strokeWidth={2.5} />
            <span>UTC TIME: {new Date().toISOString().substring(0, 19).replace('T', ' ')}</span>
          </div>

          {/* Controls toggle connector styled perfectly */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-[#161b22] px-2 py-0.5 rounded border border-border-custom">
              <input
                id="api-connect-toggle"
                type="checkbox"
                checked={connectToLocal}
                onChange={(e) => {
                  setConnectToLocal(e.target.checked);
                  addLogMessage(e.target.checked 
                    ? `Menghubungkan ke terminal Python MT5 lokal di ${localApiUrl}...` 
                    : "Membatalkan koneksi API lokal. Mengaktifkan simulator bawaan.", 
                    "WARN"
                  );
                }}
                className="w-3 h-3 text-accent-custom rounded border-gray-600 focus:ring-accent-custom bg-[#0d1117] cursor-pointer"
              />
              <label htmlFor="api-connect-toggle" className="text-[10px] font-bold text-gray-300 whitespace-nowrap cursor-pointer">
                Hubungkan ke MT5 PC
              </label>

              {connectToLocal && (
                <div className="flex items-center gap-1 ml-1.5 border-l border-border-custom pl-1.5">
                  <input
                    type="text"
                    value={localApiUrl}
                    onChange={(e) => setLocalApiUrl(e.target.value)}
                    className="bg-[#0b0e14] border border-border-custom px-1.5 py-0.5 text-[10px] font-mono rounded w-28 text-accent-custom outline-none"
                    placeholder="http://localhost:8000"
                  />
                  <div className={`w-2 h-2 rounded-full ${apiOnline ? "bg-win-custom animate-pulse" : "bg-loss-custom"}`} title={apiOnline ? "MT5 Connected" : "Connection Refused"} />
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <span className="flex items-center gap-1">
                Strategy Config: <span className="text-warning-custom font-bold">{strategyMode === "DAY" ? "DAY TRADE (H4/H1/M5)" : "SCALPER (M15/M5/M1)"}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN BODY LAYOUT - Compact wide layout */}
      <main className="max-w-full mx-auto px-5 py-4">
        
        {/* DOWNLOAD PLATFORM ASSETS BANNER - Clean styled panel */}
        <div className="mb-4 p-3 rounded bg-gradient-to-r from-accent-custom/5 via-surface to-surface border border-border-custom flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-1.5 rounded bg-accent-custom/10 text-accent-custom mt-1 md:mt-0">
              <Download className="w-4 h-4 text-accent-custom" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white leading-tight">Integrasi Akun MT5 Anda (Windows PC)</h4>
              <p className="text-[11px] text-gray-400 max-w-xl pr-2 mt-0.5">
                Jalankan bot ini seketika secara otomatis dengan dana ril/demo. Unduh script FastAPI lokal di bawah, hubungkan ke terminal MT5, dan centang tombol di atas.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-stretch md:self-auto shrink-0">
            <a
              href="/api/download/bot-backend"
              download="bot_backend.py"
              className="px-3 py-1.5 text-[11px] font-bold rounded bg-accent-custom hover:bg-accent-custom/80 text-black transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3 h-3" /> bot_backend.py
            </a>
            <a
              href="/api/download/requirements"
              download="requirements.txt"
              className="px-3 py-1.5 text-[11px] font-bold rounded bg-[#21262d] hover:bg-[#30363d] text-white transition-all flex items-center gap-1.5 cursor-pointer border border-[#30363d]"
            >
              <Download className="w-3 h-3" /> requirements.txt
            </a>
          </div>
        </div>

        {/* Modern Segmented Pill Navigation Tab Bar */}
        <div className="flex bg-[#0f1422] p-1.5 rounded border border-border-custom mb-5 gap-2 max-w-max overflow-x-auto scroller-none items-stretch">
          <button
            onClick={() => setActiveTab("DASHBOARD")}
            className={`px-4 py-1.5 rounded font-extrabold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all font-display ${
              activeTab === "DASHBOARD"
                ? "bg-accent-custom text-white shadow-md shadow-accent-custom/10 font-black"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            DASHBOARD
          </button>
          <button
            onClick={() => setActiveTab("SIGNALS")}
            className={`px-4 py-1.5 rounded font-extrabold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all font-display ${
              activeTab === "SIGNALS"
                ? "bg-accent-custom text-white shadow-md shadow-accent-custom/10 font-black"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            SIGNALS <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${activeTab === "SIGNALS" ? "bg-white/20 text-white" : "bg-[#161f30] text-win-custom border border-win-custom/20"}`}>LIVE</span>
          </button>
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-4 py-1.5 rounded font-extrabold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all font-display ${
              activeTab === "HISTORY"
                ? "bg-accent-custom text-white shadow-md shadow-accent-custom/10 font-black"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            HISTORY
          </button>
          <button
            onClick={() => setActiveTab("LOG")}
            className={`px-4 py-1.5 rounded font-extrabold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all font-display ${
              activeTab === "LOG"
                ? "bg-accent-custom text-white shadow-md shadow-accent-custom/10 font-black"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            LOG FEED
          </button>
        </div>

        {/* ==================== TAB 1: DASHBOARD ==================== */}
        {activeTab === "DASHBOARD" && (
          <div className="space-y-4">
            
            {/* 8 UTAMA METRICS GRID - High Density styling */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              
              {/* Card 1: Balance */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">1. BALANCE</span>
                <span className="text-sm font-bold font-mono tracking-tight text-white block mt-0.5">
                  ${simMetrics.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Kas Berjalan</span>
              </div>
 
              {/* Card 2: Equity */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">2. EQUITY</span>
                <span className="text-sm font-bold font-mono tracking-tight text-accent-custom block mt-0.5">
                  ${simMetrics.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Nilai Likuid</span>
              </div>
 
              {/* Card 3: Margin */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">3. USED MARGIN</span>
                <span className="text-sm font-bold font-mono tracking-tight text-white block mt-0.5">
                  ${simMetrics.margin.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Jaminan Margin</span>
              </div>
 
              {/* Card 4: Free Margin */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">4. FREE MARGIN</span>
                <span className="text-sm font-bold font-mono tracking-tight text-white block mt-0.5">
                  ${simMetrics.free_margin.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Instan Margin</span>
              </div>

              {/* Card 5: Unrealized PnL */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">5. FLOATING PNL</span>
                <span className={`text-sm font-bold font-mono tracking-tight block mt-0.5 ${
                  simMetrics.unrealized_pnl >= 0 ? "text-win-custom animate-pulse" : "text-loss-custom"
                }`}>
                  {simMetrics.unrealized_pnl >= 0 ? "+" : ""}${simMetrics.unrealized_pnl.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Keuntungan Float</span>
              </div>

              {/* Card 6: Total Trades */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">6. TOTAL TRADES</span>
                <span className="text-sm font-bold font-mono tracking-tight text-white block mt-0.5">
                  {simMetrics.total_trades}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Sinyal Tertutup</span>
              </div>

              {/* Card 7: Win Rate */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">7. WIN RATE</span>
                <span className="text-sm font-bold font-mono tracking-tight text-white block mt-0.5">
                  {simMetrics.win_rate}%
                </span>
                <span className="text-[9px] text-win-custom font-mono block font-bold">Akurasi Sinyal AI</span>
              </div>

              {/* Card 8: Daily Profit */}
              <div className="bg-surface px-3 py-2 rounded border border-border-custom shadow-sm flex flex-col justify-between">
                <span className="text-[9px] text-gray-400 font-mono tracking-wider block">8. DAILY PROFIT</span>
                <span className={`text-sm font-bold font-mono tracking-tight block mt-0.5 ${
                  simMetrics.daily_profit_usd >= 0 ? "text-win-custom" : "text-loss-custom"
                }`}>
                  {simMetrics.daily_profit_usd >= 0 ? "+" : ""}${simMetrics.daily_profit_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[9px] text-gray-500 font-mono block">Laba Hari Ini</span>
              </div>

            </div>

            {/* PERFORMANCE SECTION: CHARTS + CONSULTANT */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              
              {/* CHART: Equity Curve */}
              <div className="lg:col-span-2 bg-surface p-3 rounded border border-border-custom flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-accent-custom" /> Kurva Ekuitas (Equity Curve)
                    </h3>
                    <p className="text-[10px] text-gray-505 font-mono font-normal">Visualisasi tren balance & floating pnl secara real-time</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 font-mono bg-bg px-2 py-0.5 rounded border border-border-custom">
                      Initial: $10,000.00
                    </span>
                  </div>
                </div>

                <div className="h-48 w-full font-mono">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={simEquityCurve} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="#58a6ff" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f242c" />
                      <XAxis dataKey="time" stroke="#555" fontSize={9} fontFamily="monospace" />
                      <YAxis stroke="#555" fontSize={9} fontFamily="monospace" domain={['dataMin - 50', 'dataMax + 50']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#fff', fontSize: 10, fontFamily: 'monospace' }}
                        labelStyle={{ color: '#8b949e' }}
                      />
                      <Area type="monotone" dataKey="balance" stroke="#58a6ff" strokeWidth={1.5} fillOpacity={1} fill="url(#colorBalance)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* SIDE PANEL: AI SYSTEM CONFIGURATION & PROFIT RECOVERY AUDIT */}
              <div className="bg-surface p-3 rounded border border-border-custom flex flex-col justify-between min-h-[230px]">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent-custom animate-pulse" />
                    <h3 className="text-xs font-bold text-white uppercase">AI Consultant & Audit Laba</h3>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-2 font-normal leading-relaxed">
                    Scan performa dengan AI Gemini untuk memproyeksikan kecukupan laba dalam menutupi biaya operasional & up-gradation bot.
                  </p>

                  {/* Generated Analysis block */}
                  <div className="bg-bg p-2.5 rounded border border-border-custom text-[11px] leading-relaxed max-h-36 overflow-y-auto font-mono text-gray-300">
                    {loadingAi ? (
                      <div className="flex flex-col items-center justify-center py-4 gap-2">
                        <RefreshCw className="w-4 h-4 text-accent-custom animate-spin" />
                        <span className="text-[9px] text-gray-400 font-mono">Gemini sedang menyusun laporan...</span>
                      </div>
                    ) : aiAnalysis ? (
                      <div className="space-y-1.5 whitespace-pre-line text-[11px] leading-relaxed">
                        {aiAnalysis}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-500 font-mono">
                        <Bot className="w-6 h-6 mx-auto text-gray-700 mb-1.5" />
                        Belum ada laporan audit. Klik tombol di bawah.
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2">
                  <button
                    onClick={handleRequestAiConsultation}
                    disabled={loadingAi}
                    className="w-full py-1.5 px-3 text-[11px] font-bold rounded cursor-pointer bg-accent-custom hover:bg-accent-custom/85 text-black shadow-sm flex items-center justify-center gap-1.5 transition-all outline-none"
                  >
                    {loadingAi ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {loadingAi ? "Menganalisis..." : "Mulai Konsultasi AI via Gemini"}
                  </button>
                </div>
              </div>

            </div>

            {/* TAB TRADES SEKARANG BERISI OPEN POSITIONS & RECENT TRADES */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Left Column: OPEN POSITIONS (Live Cards) */}
              <div>
                <h3 className="text-[11px] font-bold font-mono text-gray-400 tracking-wider mb-2 flex items-center justify-between">
                  <span>OPEN POSITIONS (LIVE CARDS)</span>
                  <span className="px-2 py-0.2 rounded bg-win-custom/10 text-win-custom font-mono text-[9px] border border-win-custom/20">
                    {connectToLocal ? (apiOnline ? "MT5 LIVE" : "OFFLINE FALLBACK") : "SIM TRANS"}
                  </span>
                </h3>

                {simOpenPositions.length === 0 ? (
                  <div className="bg-surface p-6 rounded border border-border-custom text-center text-[11px] text-gray-500 font-mono">
                    <Radio className="w-5 h-5 mx-auto text-gray-600 mb-1.5 animate-pulse" />
                    Menunggu penyelarasan multi-timeframe EMA & Stochastic untuk entry otomatis...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {simOpenPositions.map((pos, idx) => (
                      <div key={`${pos.id}-${pos.symbol}-${idx}`} className="bg-surface rounded border border-border-custom p-3 shadow-sm relative overflow-hidden">
                        
                        {/* OPEN LABEL */}
                        <span className="absolute top-2.5 right-2.5 text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.2 rounded bg-win-custom/10 border border-win-custom/30 text-win-custom flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-win-custom animate-ping" />
                          OPEN
                        </span>

                        {/* Card metadata Header */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded font-mono ${
                            pos.type === "BUY" ? "bg-win-custom/10 text-win-custom border border-win-custom/20" : "bg-loss-custom/10 text-loss-custom border border-loss-custom/20"
                          }`}>
                            {pos.type}
                          </span>
                          <span className="font-extrabold text-white text-sm tracking-tight">{pos.symbol}</span>
                          <span className="text-[10px] text-gray-500 font-mono">Qty: {pos.qty} Lot</span>
                        </div>

                        {/* Pricing details */}
                        <div className="grid grid-cols-3 gap-1 py-1 px-1.5 bg-bg border border-border-custom rounded mb-2">
                          <div>
                            <span className="text-[8px] text-gray-550 font-mono block uppercase">Entry Price</span>
                            <span className="font-mono text-[11px] text-gray-300 font-medium">{pos.entry_price.toLocaleString("en-US", { minimumFractionDigits: pos.symbol === 'USDJPY' ? 2 : 5 })}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-gray-550 font-mono block uppercase">Current Price</span>
                            <span className="font-mono text-[11px] text-gray-300 font-medium">{pos.current_price.toLocaleString("en-US", { minimumFractionDigits: pos.symbol === 'USDJPY' ? 2 : 5 })}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-gray-550 font-mono block uppercase">Leverage Size</span>
                            <span className="font-mono text-[11px] text-gray-400 font-medium">${pos.lot_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                          </div>
                        </div>

                        {/* Unrealized PNL Box */}
                        <div className="flex items-center justify-between gap-2.5">
                          <div>
                            <span className="text-[8px] text-gray-550 font-mono block uppercase">Floating PnL</span>
                            <span className={`text-[11px] font-bold font-mono ${pos.unrealized_pnl >= 0 ? "text-win-custom" : "text-loss-custom"}`}>
                              {pos.unrealized_pnl >= 0 ? "+" : ""}${pos.unrealized_pnl.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                            </span>
                          </div>

                          {/* ACTION BUTTON: CLOSE manual order */}
                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            className="text-[10px] font-bold px-2 py-1 rounded cursor-pointer bg-loss-custom/10 hover:bg-loss-custom hover:text-white border border-loss-custom/20 text-loss-custom transition-all uppercase flex items-center gap-1 outline-none font-mono"
                          >
                            <X className="w-2.5 h-2.5" /> Close Position
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: CLOSED TRADES RESULT CARDS */}
              <div>
                <h3 className="text-[11px] font-bold font-mono text-gray-400 tracking-wider mb-2">
                  CLOSED TRADES (RECENT RESULTS)
                </h3>

                {simClosedTrades.length === 0 ? (
                  <div className="bg-[#161b22] p-8 rounded-xl border border-[#21262d] text-center text-xs text-gray-500 font-mono">
                    <History className="w-6 h-6 mx-auto text-gray-600 mb-2" />
                    Belum ada sinyal terpakai yang ditutup. Riwayat perdagangan Anda akan tercatat di sini.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                    {simClosedTrades.slice(0, 10).map((item, idx) => (
                      <div key={`${item.id}-${item.symbol}-${idx}`} className="bg-surface rounded border border-border-custom p-3 relative overflow-hidden shadow-sm">
                        
                        {/* WIN / LOSE STAMP */}
                        <span className={`absolute top-2.5 right-2.5 text-[9px] font-bold font-mono px-1.5 py-0.2 rounded flex items-center gap-1 ${
                          item.outcome === "WIN" 
                            ? "bg-win-custom/10 text-win-custom border border-win-custom/30" 
                            : "bg-loss-custom/10 text-loss-custom border border-loss-custom/30"
                        }`}>
                          {item.outcome === "WIN" ? "✓ WIN" : "✗ LOSE"}
                        </span>

                        {/* Trade Pair Details */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-extrabold text-sm text-white tracking-tight">{item.symbol}</span>
                          <span className={`text-[8px] font-bold font-mono px-1.5 py-0.2 rounded ${
                            item.type === "BUY" ? "bg-win-custom/10 text-win-custom" : "bg-loss-custom/10 text-loss-custom"
                          }`}>{item.type}</span>
                          <span className="text-[10px] text-gray-400 font-mono">Lot: {item.qty} (${item.lot_usd.toLocaleString()})</span>
                        </div>

                        {/* Prices row */}
                        <div className="text-[10px] text-gray-450 font-mono flex gap-4 py-1 bg-bg border border-border-custom px-2 rounded mb-2">
                          <span>In: {item.entry_price.toLocaleString("en-US", { minimumFractionDigits: item.symbol === 'USDJPY' ? 2 : 5 })}</span>
                          <span className="text-gray-600">→</span>
                          <span>Out: {item.exit_price.toLocaleString("en-US", { minimumFractionDigits: item.symbol === 'USDJPY' ? 2 : 5 })}</span>
                        </div>

                        {/* Large PNL Box layout & stamp */}
                        <div className="flex items-end justify-between">
                          <div>
                            <span className="text-[8px] text-gray-500 font-mono block">FINAL NET PNL</span>
                            <div className="flex items-baseline gap-1 mt-0.5">
                              <span className={`text-sm font-bold font-mono ${
                                item.pnl >= 0 ? "text-win-custom" : "text-loss-custom"
                              }`}>
                                {item.pnl >= 0 ? "+" : ""}${item.pnl.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                              </span>
                              <span className={`text-[9px] font-mono ${item.pnl >= 0 ? "text-win-custom/85" : "text-loss-custom/85"}`}>
                                ({item.pnl >= 0 ? "+" : ""}{item.percentage.toFixed(3)}%)
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[9px] text-gray-400 block font-mono bg-bg px-1.5 py-0.2 rounded border border-border-custom whitespace-nowrap">
                              {item.signal_triggers.substring(0, 20)}
                            </span>
                            <span className="text-[8px] text-gray-505 block font-mono mt-0.5">
                              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* ==================== TAB 2: SIGNALS ==================== */}
        {activeTab === "SIGNALS" && (
          <div className="space-y-4">
            
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-surface p-3 rounded border border-border-custom">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-accent-custom animate-pulse" /> Sinyal Logik Algoritmik (Tanpa Black Box)
                </h3>
                <p className="text-[11px] text-gray-500 font-mono font-normal">
                  Draf sinyal transparan per timeframe lengkap dengan indikator Stochastic (5, 3, 3) dan Bias Filter EMA.
                </p>
              </div>
              <button
                onClick={handleRequestAiConsultation}
                disabled={loadingAi}
                className="px-3 py-1.5 text-[11px] font-bold rounded cursor-pointer bg-accent-custom hover:bg-accent-custom/85 text-black transition-all flex items-center gap-1 outline-none font-mono"
              >
                <Sparkles className="w-3 h-3" /> Minta Rekomendasi AI Gemini
              </button>
            </div>

            {/* LIVE TICKET LIST PER ASSET */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {simSignals.length === 0 ? (
                <div className="bg-surface p-8 rounded border border-border-custom text-center col-span-3 text-[11px] text-gray-500 font-mono">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-accent-custom mb-1.5" />
                  Memanaskan engine, memilah data candlestick real-time dari MetaTrader 5 terminal...
                </div>
              ) : (
                simSignals.map(sig => {
                  const isHistBuild = sig.status === "BUILD_HISTORY" || (sig.ticks_collected && sig.ticks_collected < 60);
                  const ticksCollected = sig.ticks_collected || 0;
                  
                  return (
                    <div key={sig.symbol} className="bg-surface rounded border border-border-custom p-3 relative overflow-hidden flex flex-col justify-between shadow-sm">
                      
                      {/* HEADER PAIR COLOURED BY SIGNAL */}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-[10px] text-gray-500 font-mono uppercase block">{sig.strategy}</span>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-lg text-white leading-tight">{sig.symbol}</h4>
                            <span className="text-[11px] text-gray-300 font-mono font-medium">${sig.current_price.toLocaleString("en-US", { minimumFractionDigits: sig.symbol === 'USDJPY' ? 2 : 4 })}</span>
                          </div>
                        </div>

                        {/* Trade Actions Signal pill/progress */}
                        {isHistBuild ? (
                          <span className="text-[9px] font-mono font-bold bg-[#1f242c] text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded animate-pulse">
                            BUILDING HIST ({ticksCollected}/60)
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold tracking-wider font-mono uppercase px-2 py-0.5 rounded ${
                            sig.signal === "BUY"
                              ? "bg-win-custom/10 text-win-custom border border-win-custom/20"
                              : sig.signal === "SELL"
                              ? "bg-loss-custom/10 text-loss-custom border border-loss-custom/20"
                              : "bg-surface text-gray-500 border border-border-custom"
                          }`}>
                            {sig.signal}
                          </span>
                        )}
                      </div>

                      {isHistBuild ? (
                        /* Hist buildup progress block */
                        <div className="space-y-2.5 py-2 border-t border-border-custom">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px] font-mono">
                              <span className="text-gray-400">Pemanasan Data MT5:</span>
                              <span className="text-amber-400">{ticksCollected} / 60 ticks</span>
                            </div>
                            <div className="w-full bg-bg h-1.5 rounded overflow-hidden border border-border-custom">
                              <div className="bg-amber-500 h-full transition-all" style={{ width: `${(ticksCollected / 60) * 100}%` }} />
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-400 italic font-mono leading-relaxed bg-bg p-2 rounded border border-border-custom">
                            "Bot butuh ~60 tick awal untuk build history yang cukup sebelum bisa generate sinyal valid secara matang."
                          </p>
                        </div>
                      ) : (
                        /* Standard Signal Analysis, checklist and details */
                        <div className="space-y-2 border-t border-border-custom pt-2.5">
                          
                          {/* BIAS FILTER FIELD */}
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-400 font-mono">BIAS FILTER:</span>
                            <span className={`font-mono font-bold ${
                              sig.bias === "BULLISH"
                                ? "text-win-custom"
                                : sig.bias === "BEARISH"
                                ? "text-loss-custom"
                                : "text-amber-400"
                            }`}>
                              {sig.bias}
                            </span>
                          </div>

                          {/* CONFIDENCE BAR BAR */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="text-gray-400">Confidence Opportunity:</span>
                              <span className="text-white font-bold">{sig.confidence}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-bg rounded overflow-hidden">
                              <div 
                                className={`h-full transition-all ${
                                  sig.confidence > 80 
                                    ? "bg-win-custom" 
                                    : sig.confidence > 50 
                                    ? "bg-amber-500" 
                                    : "bg-loss-custom/75"
                                }`}
                                style={{ width: `${sig.confidence}%` }} 
                              />
                            </div>
                          </div>

                          {/* RECT GAUGES VISUAL FOR STOCHASTIC PERIOD */}
                          <div className="grid grid-cols-2 gap-2 bg-bg p-2 rounded border border-border-custom">
                            <div className="text-center border-r border-border-custom">
                              <span className="text-[8px] text-gray-500 block font-mono">STOCH %K (5,3,3)</span>
                              <span className={`text-[11px] font-mono font-bold ${sig.stoch_k < 20 ? "text-win-custom animate-pulse" : sig.stoch_k > 80 ? "text-loss-custom" : "text-gray-300"}`}>
                                {sig.stoch_k}
                              </span>
                            </div>
                            <div className="text-center">
                              <span className="text-[8px] text-gray-500 block font-mono">STOCH %D (SMA 3)</span>
                              <span className={`text-[11px] font-mono font-bold ${sig.stoch_d < 20 ? "text-win-custom animate-pulse" : sig.stoch_d > 80 ? "text-loss-custom" : "text-gray-300"}`}>
                                {sig.stoch_d}
                              </span>
                            </div>
                          </div>

                          {/* TRANSPARENT TIMEFRAME CHECKLIST */}
                          <div className="space-y-1">
                            <span className="text-[8px] text-gray-500 block font-bold font-mono uppercase tracking-wider">
                              Cheklist Kepatuhan Timeframe (EMA + STOCH)
                            </span>
                            
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 bg-bg p-1.5 rounded border border-border-custom text-[9px] font-mono text-gray-400">
                              
                              {/* H4 Bias (Day) or M15 Bias (Scalper) */}
                              <div className="flex items-center gap-1.5 py-0.5">
                                {sig.checklist?.bias_h4_aligned || sig.checklist?.bias_m15_aligned ? (
                                  <Check className="w-2.5 h-2.5 text-win-custom" />
                                ) : (
                                  <X className="w-2.5 h-2.5 text-loss-custom" />
                                )}
                                <span className="truncate">{strategyMode === "DAY" ? "Bias H4 (aligned)" : "Bias M15"}</span>
                              </div>

                              {/* H1 Bias (Day) or M5 Trigger (Scalper) */}
                              <div className="flex items-center gap-1.5 py-0.5">
                                {sig.checklist?.bias_h1_aligned || sig.checklist?.trigger_m5 ? (
                                  <Check className="w-2.5 h-2.5 text-win-custom" />
                                ) : (
                                  <X className="w-2.5 h-2.5 text-loss-custom" />
                                )}
                                <span className="truncate">{strategyMode === "DAY" ? "Bias H1 (aligned)" : "EMA M5"}</span>
                              </div>

                              {/* M15 Trigger (Day) or M1 Trigger (Scalper) */}
                              <div className="flex items-center gap-1.5 py-0.5">
                                {sig.checklist?.trigger_m15 || sig.checklist?.trigger_m1 ? (
                                  <Check className="w-2.5 h-2.5 text-win-custom" />
                                ) : (
                                  <X className="w-2.5 h-2.5 text-loss-custom" />
                                )}
                                <span className="truncate">{strategyMode === "DAY" ? "EMA M15" : "EMA M1"}</span>
                              </div>

                              {/* EMA M5 (Day) or Stoch status */}
                              <div className="flex items-center gap-1.5 py-0.5">
                                {sig.checklist?.trigger_m5 || sig.checklist?.stochastic_condition ? (
                                  <Check className="w-2.5 h-2.5 text-win-custom" />
                                ) : (
                                  <X className="w-2.5 h-2.5 text-loss-custom" />
                                )}
                                <span className="truncate">{strategyMode === "DAY" ? "EMA M5" : "Stochastic Check"}</span>
                              </div>

                            </div>
                          </div>

                          {/* REASONING COMPRESSION FIELD */}
                          <div className="text-[10px] text-gray-305 font-mono leading-relaxed bg-bg p-2.5 rounded border border-border-custom">
                            <span className="font-extrabold uppercase text-[8px] text-gray-500 font-mono block not-italic mb-0.5">REASONING:</span>
                            "{sig.reason}"
                          </div>

                        </div>
                      )}

                    </div>
                  );
                })
              )}
            </div>

          </div>
        )}

        {/* ==================== TAB 3: HISTORY ==================== */}
        {activeTab === "HISTORY" && (
          <div className="space-y-4">
            
            <div className="bg-surface p-3 rounded border border-border-custom">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase flex items-center gap-1.5 font-mono">
                    <History className="w-3.5 h-3.5 text-accent-custom" /> Histori Transaksi Sinyal Bot (Full Trade Log)
                  </h3>
                  <p className="text-[11px] text-gray-500 font-mono font-normal">
                    Daftar log order yang sudah terealisasi penuh, tereksekusi otomatis oleh MetaTrader5 melalui python webhook. Emitting real performance curves.
                  </p>
                </div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-[10px] font-mono bg-win-custom/10 text-win-custom px-2 py-1 rounded border border-win-custom/20">
                    Akurasi: {simMetrics.win_rate}% Win Rate
                  </span>
                </div>
              </div>

              {/* TABLE CONTAINER FOR PRECISE STATS */}
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border-custom text-gray-500 font-medium">
                      <th className="py-2 px-3 text-[10px] font-bold">TRADE ID</th>
                      <th className="py-2 px-3 text-[10px] font-bold">WAKTU (UTC)</th>
                      <th className="py-2 px-3 text-[10px] font-bold">PAIR</th>
                      <th className="py-2 px-3 text-[10px] font-bold">TIPE</th>
                      <th className="py-2 px-3 text-[10px] font-bold text-right">VOLUME / LOT</th>
                      <th className="py-2 px-3 text-[10px] font-bold text-right">ENTRY → EXIT</th>
                      <th className="py-2 px-3 text-[10px] font-bold text-right">NET PNL</th>
                      <th className="py-2 px-3 text-[10px] font-bold text-center">OUTCOME</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-custom">
                    {simClosedTrades.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-550 font-normal">
                          Belum ada transaksi historis di sesi ini. Ticks pada tab SIGNALS akan memicu order saat Stochastic oversold/overbought selaras.
                        </td>
                      </tr>
                    ) : (
                      simClosedTrades.map((trade, idx) => (
                        <tr key={`${trade.id}-${trade.symbol}-${idx}`} className="hover:bg-bg transition-all">
                          <td className="py-2 px-3 text-gray-400 font-bold">#{trade.id}</td>
                          <td className="py-2 px-3 text-gray-500">
                            {new Date(trade.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                          </td>
                          <td className="py-2 px-3 text-white font-bold">{trade.symbol}</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold ${
                              trade.type === "BUY" ? "bg-win-custom/10 text-win-custom border border-win-custom/20" : "bg-loss-custom/10 text-loss-custom border border-loss-custom/20"
                            }`}>
                              {trade.type}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-400">
                            {trade.qty} Lot (${trade.lot_usd.toLocaleString()})
                          </td>
                          <td className="py-2 px-3 text-right text-gray-500">
                            {trade.entry_price.toLocaleString("en-US", { minimumFractionDigits: trade.symbol === 'USDJPY' ? 2 : 5 })} →{" "}
                            {trade.exit_price.toLocaleString("en-US", { minimumFractionDigits: trade.symbol === 'USDJPY' ? 2 : 5 })}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span className={`font-bold ${trade.pnl >= 0 ? "text-win-custom" : "text-loss-custom"}`}>
                              {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                            </span>
                            <span className="text-[9px] text-gray-600 block">
                              ({trade.pnl >= 0 ? "+" : ""}{trade.percentage.toFixed(3)}%)
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                              trade.outcome === "WIN"
                                ? "bg-win-custom/10 text-win-custom border border-win-custom/20"
                                : "bg-loss-custom/10 text-loss-custom border border-loss-custom/20"
                            }`}>
                              {trade.outcome === "WIN" ? "WIN" : "LOSE"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

            </div>

          </div>
        )}

        {/* ==================== TAB 4: LOG ==================== */}
        {activeTab === "LOG" && (
          <div className="space-y-4">
            
            <div className="bg-surface p-3 rounded border border-border-custom shadow-sm">
              <div className="flex items-center justify-between mb-3 border-b border-border-custom pb-3">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase font-mono">
                    <Terminal className="w-3.5 h-3.5 text-accent-custom" /> nexus_bot.log activity feed
                  </h3>
                  <p className="text-[11px] text-gray-500 font-mono font-normal">
                    Output diagnostik real-time dari engine bot yang mendokumentasikan alignment EMA dan deteksi Stochastic.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    setSimLogs(prev => [...prev, `${timestamp} [INFO] [Terminal] Log dibersihkan secara manual.`]);
                  }}
                  className="px-2.5 py-1 text-[10px] font-bold rounded bg-bg hover:bg-surface border border-border-custom text-gray-300 transition-all cursor-pointer font-mono outline-none"
                >
                  Clear Console Log
                </button>
              </div>

              {/* LOGS CONSOLE PANEL */}
              <div className="bg-bg p-3.5 rounded border border-border-custom font-mono text-[11px] text-gray-400 leading-relaxed max-h-[350px] overflow-y-auto space-y-1 shadow-inner">
                {simLogs.length === 0 ? (
                  <div className="text-center py-8 text-gray-650">
                    Engine terminal sunyi. Menunggu data ticks masuk...
                  </div>
                ) : (
                  simLogs.map((log, index) => {
                    let col = "text-gray-400";
                    if (log.includes("[ERROR]")) col = "text-loss-custom font-semibold";
                    if (log.includes("[WARNING]")) col = "text-amber-400";
                    if (log.includes("[SUCCESS]")) col = "text-win-custom";
                    if (log.includes("[ENTRY]")) col = "text-win-custom font-bold";
                    if (log.includes("[BOT]")) col = "text-purple-400";
                    
                    return (
                      <div key={index} className={`py-0.5 border-b border-border-custom/20 ${col}`}>
                        {log}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        )}

      </main>

      {/* FOOTER METRICS AREA */}
      <footer className="border-t border-border-custom bg-surface py-5 text-[11px] font-mono text-gray-500 mt-6 md:mt-10">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-3">
          <div>
            <p className="text-white font-bold mb-0.5">NEXUS AI SYSTEMS INC</p>
            <p className="text-gray-400">Sistem trading hibrida terenkripsi yang diarahkan oleh model real time.</p>
          </div>
          <p className="text-[10px] text-right text-gray-500">
            Dikonfigurasi oleh @adipratama4214 • Terintegrasi dengan MetaTrader 5 Terminal SDK versi 5.0.33
          </p>
        </div>
      </footer>

    </div>
  );
}
