#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nexus AI MT5 Trading Bot Backend
Arsitektur: FastAPI + MetaTrader5 Python Library
Deskripsi: Script backend ini berjalan di PC lokal untuk memproses data tick/maupun candle harian,
           menghitung indikator multi-timeframe secara real-time, menyelaraskan Bias Filter dan Trigger,
           serta mengeksekusi order BUY/SELL langsung di MT5.
"""

import os
import sys
import time
import logging
import datetime
import threading
import math
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np

# Coba import module MetaTrader5, berikan warning/fallback jika dijalankan di luar Windows
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("WARNING: MetaTrader5 library tidak terdeteksi atau Anda tidak menggunakan OS Windows.")
    print("Aplikasi akan berjalan dalam SIMULATION MODE (Fallback otomatis).")

# Setup Logging
LOG_FILE = "nexus_bot.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("NexusBot")

app = FastAPI(
    title="Nexus AI MT5 Bot API",
    description="Backend API untuk sinkronisasi React Dashboard dengan MetaTrader 5 Terminal",
    version="1.0.0"
)

# Enable CORS agar React Frontend bisa mengakses backend lokal ini
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- CONFIG & KREDENSIAL MT5 -----------------
MT5_LOGIN = 123456789
MT5_PASSWORD = "password_kamu"
MT5_SERVER = "NamaBroker-Demo"
DEFAULT_VOLUME = 0.01  # Lot size default
SLIPPAGE = 3           # Slippage toleransi pips

# State internal trading bot
class BotState:
    def __init__(self):
        self.strategy_mode = "DAY"  # "DAY" atau "SCALPER"
        self.balance = 10000.0
        self.equity = 10000.0
        self.margin = 0.0
        self.free_margin = 10000.0
        self.pnl_history = [{"time": datetime.datetime.now().strftime("%H:%M:%S"), "balance": 10000.0, "pnl": 0.0}]
        self.open_positions = []
        self.closed_trades = []
        self.simulated_mode = not MT5_AVAILABLE
        self.tick_counters = {}  # hitung tick tiap pair
        self.log_buffer = []     # cash log terbaru
        self.is_running = True

bot_state = BotState()

# Log Helper
def add_log(message: str, level: str = "INFO"):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"{timestamp} [{level}] {message}"
    bot_state.log_buffer.append(log_entry)
    if len(bot_state.log_buffer) > 100:
        bot_state.log_buffer.pop(0)
    
    if level == "INFO":
        logger.info(message)
    elif level == "WARNING":
        logger.warning(message)
    elif level == "ERROR":
        logger.error(message)

# ----------------- MT5 MANAGEMENT OR SIMULATOR -----------------
def initialize_mt5():
    if bot_state.simulated_mode:
        add_log("Sistem berjalan dalam mode simulasi. MT5 di-bypass.", "INFO")
        return True
    
    # Inisialisasi koneksi terminal MT5
    if not mt5.initialize():
        add_log(f"Inisialisasi MT5 gagal. Error: {mt5.last_error()}", "ERROR")
        add_log("Mengaktifkan Fallback Simulation Mode...", "WARNING")
        bot_state.simulated_mode = True
        return False
    
    # Login ke broker
    authorized = mt5.login(MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER)
    if not authorized:
        add_log(f"Gagal login ke Akun MT5 #{MT5_LOGIN} di Server {MT5_SERVER}. Error: {mt5.last_error()}", "ERROR")
        add_log("Mengaktifkan Fallback Simulation Mode...", "WARNING")
        bot_state.simulated_mode = True
        return False
    
    add_log(f"Berhasil login ke Akun MT5 #{MT5_LOGIN} di Server {MT5_SERVER}", "INFO")
    account_info = mt5.account_info()
    if account_info is not None:
        bot_state.balance = account_info.balance
        bot_state.equity = account_info.equity
        bot_state.margin = account_info.margin
        bot_state.free_margin = account_info.free_margin
    return True

# ----------------- STRATEGY ENGINE & CALCULATORS -----------------
def calculate_ema(prices: pd.Series, period: int) -> pd.Series:
    return prices.ewm(span=period, adjust=False).mean()

def calculate_stochastic(df: pd.DataFrame, k_period: int = 5, smooth_k: int = 3, smooth_d: int = 3) -> tuple:
    """
    Menghitung Stochastic Oscillator (5,3,3)
    K Period = 5, Smooth K = SMA 3, Smooth D = SMA 3
    """
    if len(df) < k_period:
        return pd.Series([50.0] * len(df)), pd.Series([50.0] * len(df))
    
    low_min = df['low'].rolling(window=k_period).min()
    high_max = df['high'].rolling(window=k_period).max()
    
    # Fast %K
    fast_k = 100 * ((df['close'] - low_min) / (high_max - low_min + 1e-9))
    
    # Smooth %K (SMA 3)
    k_line = fast_k.rolling(window=smooth_k).mean()
    # Smooth %D (SMA 3 dari K)
    d_line = k_line.rolling(window=smooth_d).mean()
    
    # Ganti NaN dengan 50.0
    k_line = k_line.fillna(50.0)
    d_line = d_line.fillna(50.0)
    
    return k_line, d_line

def fetch_history_data(symbol: str, timeframe: str, count: int = 100) -> pd.DataFrame:
    """
    Mengambil data candlestick dari MT5 atau membuat data dummy jika simulasi
    """
    if bot_state.simulated_mode:
        # Buat candle dummy berbasis random walk
        now = time.time()
        times = [now - i * 60 for i in range(count, 0, -1)]
        prices = [1.1200]
        for _ in range(count - 1):
            prices.append(prices[-1] + np.random.normal(0, 0.0005))
        
        df = pd.DataFrame(index=range(count))
        highs = [p + abs(np.random.normal(0, 0.0003)) for p in prices]
        lows = [p - abs(np.random.normal(0, 0.0003)) for p in prices]
        opens = [prices[i] + np.random.normal(0, 0.0001) for i in range(count)]
        
        df['time'] = times
        df['open'] = opens
        df['high'] = highs
        df['low'] = lows
        df['close'] = prices
        df['volume'] = np.random.randint(10, 200, count)
        return df

    # MT5 candle fetch
    timeframe_mapping = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4
    }
    
    mt5_tf = timeframe_mapping.get(timeframe, mt5.TIMEFRAME_M5)
    rates = mt5.copy_rates_from_now(symbol, mt5_tf, count)
    if rates is None or len(rates) == 0:
        return pd.DataFrame()
        
    df = pd.DataFrame(rates)
    df['time'] = pd.to_datetime(df['time'], unit='s')
    return df

# ----------------- MAIN MULTI-TIMEFRAME LOGIC -----------------
ASSETS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD"]

def check_day_trade_conditions(symbol: str) -> dict:
    """
    Analisis mode DAY TRADE:
    BIAS FILTER (H4 + H1):
      - Bullish: H4 EMA21 > EMA34 DAN H1 EMA21 > EMA34
      - Bearish: H4 EMA34 > EMA21 DAN H1 EMA34 > EMA21
      - Conflict: Jika bias tidak selaras.
    ENTRY TRIGGER (M15 + M5):
      - BUY: M15 EMA21>34 + M5 EMA21>34 + Stoch(5,3,3) K & D keduanya < 20
      - SELL: M15 EMA34>21 + M5 EMA34>21 + Stoch(5,3,3) K & D keduanya > 80
    """
    df_h4 = fetch_history_data(symbol, "H4", 100)
    df_h1 = fetch_history_data(symbol, "H1", 100)
    df_m15 = fetch_history_data(symbol, "M15", 100)
    df_m5 = fetch_history_data(symbol, "M5", 100)
    
    # Check minimum history (60 ticks / bars)
    if min(len(df_h4), len(df_h1), len(df_m15), len(df_m5)) < 60:
        return {"status": "BUILD_HISTORY", "reason": "Menunggu history candle terisi (~60)"}
    
    # Calculate EMA21 & EMA34
    h4_ema21 = calculate_ema(df_h4['close'], 21).iloc[-1]
    h4_ema34 = calculate_ema(df_h4['close'], 34).iloc[-1]
    h1_ema21 = calculate_ema(df_h1['close'], 21).iloc[-1]
    h1_ema34 = calculate_ema(df_h1['close'], 34).iloc[-1]
    
    m15_ema21 = calculate_ema(df_m15['close'], 21).iloc[-1]
    m15_ema34 = calculate_ema(df_m15['close'], 34).iloc[-1]
    m5_ema21 = calculate_ema(df_m5['close'], 21).iloc[-1]
    m5_ema34 = calculate_ema(df_m5['close'], 34).iloc[-1]
    
    # Stochastic (5, 3, 3) di M5/M15 (biasanya di timeline entry)
    m5_k, m5_d = calculate_stochastic(df_m5)
    stoch_k = m5_k.iloc[-1]
    stoch_d = m5_d.iloc[-1]
    
    # Bias Filter
    has_h4_bull = h4_ema21 > h4_ema34
    has_h1_bull = h1_ema21 > h1_ema34
    has_h4_bear = h4_ema34 > h4_ema21
    has_h1_bear = h1_ema34 > h1_ema21
    
    bias = "HOLD"
    if has_h4_bull and has_h1_bull:
        bias = "BULLISH"
    elif has_h4_bear and has_h1_bear:
        bias = "BEARISH"
    else:
        bias = "CONFLICT"

    # Entry evaluation
    signal = "HOLD"
    reason = "Filter bias netral / konflik"
    confidence = 50
    stoch_align_buy = stoch_k < 20 and stoch_d < 20
    stoch_align_sell = stoch_k > 80 and stoch_d > 80
    
    if bias == "BULLISH":
        confidence = 65
        m15_bull = m15_ema21 > m15_ema34
        m5_bull = m5_ema21 > m5_ema34
        if m15_bull and m5_bull:
            confidence = 80
            if stoch_align_buy:
                signal = "BUY"
                reason = "Trend Bullish alignment multi-timeframe + Stochastic Oversold"
                confidence = 95
            else:
                reason = "Arah Bullish selaras, menunggu Stochastic K & D < 20"
        else:
            reason = "Bias bullish terpantau, M15/M5 EMA belum selaras"
            
    elif bias == "BEARISH":
        confidence = 65
        m15_bear = m15_ema34 > m15_ema21
        m5_bear = m5_ema34 > m5_ema21
        if m15_bear and m5_bear:
            confidence = 80
            if stoch_align_sell:
                signal = "SELL"
                reason = "Trend Bearish alignment multi-timeframe + Stochastic Overbought"
                confidence = 95
            else:
                reason = "Arah Bearish selaras, menunggu Stochastic K & D > 80"
        else:
            reason = "Bias bearish terpantau, M15/M5 EMA belum selaras"
            
    elif bias == "CONFLICT":
        reason = "H4 dan H1 Bias bertolak belakang. Menghindari trade."
        confidence = 20

    return {
        "symbol": symbol,
        "strategy": "DAY_TRADE",
        "bias": bias,
        "h4_ema21": float(h4_ema21),
        "h4_ema34": float(h4_ema34),
        "h1_ema21": float(h1_ema21),
        "h1_ema34": float(h1_ema34),
        "m15_ema21": float(m15_ema21),
        "m15_ema34": float(m15_ema34),
        "m5_ema21": float(m5_ema21),
        "m5_ema34": float(m5_ema34),
        "stoch_k": float(stoch_k),
        "stoch_d": float(stoch_d),
        "signal": signal,
        "reason": reason,
        "confidence": confidence,
        "current_price": float(df_m5['close'].iloc[-1]),
        "checklist": {
            "bias_h4_aligned": has_h4_bull if bias == "BULLISH" else (has_h4_bear if bias == "BEARISH" else False),
            "bias_h1_aligned": has_h1_bull if bias == "BULLISH" else (has_h1_bear if bias == "BEARISH" else False),
            "trigger_m15": (m15_ema21 > m15_ema34) if bias == "BULLISH" else ((m15_ema34 > m15_ema21) if bias == "BEARISH" else False),
            "trigger_m5": (m5_ema21 > m5_ema34) if bias == "BULLISH" else ((m5_ema34 > m5_ema21) if bias == "BEARISH" else False),
            "stochastic_condition": stoch_align_buy if bias == "BULLISH" else (stoch_align_sell if bias == "BEARISH" else False)
        }
    }

def check_scalper_conditions(symbol: str) -> dict:
    """
    Analisis mode SCALPER:
    BIAS FILTER (M15):
      - Bullish: M15 EMA21 > EMA34
      - Bearish: M15 EMA34 > EMA21
    ENTRY TRIGGER (M5 + M1):
      - BUY: M5 EMA21>34 + M1 EMA21>34 + Stoch(5,3,3) K & D keduanya < 20
      - SELL: M5 EMA34>21 + M1 EMA34>21 + Stoch(5,3,3) K & D keduanya > 80
    """
    df_m15 = fetch_history_data(symbol, "M15", 100)
    df_m5 = fetch_history_data(symbol, "M5", 100)
    df_m1 = fetch_history_data(symbol, "M1", 100)
    
    # Check minimum history (60 ticks / bars)
    if min(len(df_m15), len(df_m5), len(df_m1)) < 60:
        return {"status": "BUILD_HISTORY", "reason": "Menunggu history candle terisi (~60)"}
    
    # EMA21 & EMA34
    m15_ema21 = calculate_ema(df_m15['close'], 21).iloc[-1]
    m15_ema34 = calculate_ema(df_m15['close'], 34).iloc[-1]
    
    m5_ema21 = calculate_ema(df_m5['close'], 21).iloc[-1]
    m5_ema34 = calculate_ema(df_m5['close'], 34).iloc[-1]
    
    m1_ema21 = calculate_ema(df_m1['close'], 21).iloc[-1]
    m1_ema34 = calculate_ema(df_m1['close'], 34).iloc[-1]
    
    # Stochastic (5, 3, 3) di M1
    m1_k, m1_d = calculate_stochastic(df_m1)
    stoch_k = m1_k.iloc[-1]
    stoch_d = m1_d.iloc[-1]
    
    # Bias Filter
    has_m15_bull = m15_ema21 > m15_ema34
    has_m15_bear = m15_ema34 > m15_ema21
    
    bias = "HOLD"
    if has_m15_bull:
        bias = "BULLISH"
    elif has_m15_bear:
        bias = "BEARISH"
        
    signal = "HOLD"
    reason = "Filter bias netral"
    confidence = 50
    stoch_align_buy = stoch_k < 20 and stoch_d < 20
    stoch_align_sell = stoch_k > 80 and stoch_d > 80
    
    if bias == "BULLISH":
        confidence = 65
        m5_bull = m5_ema21 > m5_ema34
        m1_bull = m1_ema21 > m1_ema34
        if m5_bull and m1_bull:
            confidence = 80
            if stoch_align_buy:
                signal = "BUY"
                reason = "Scalper Bullish M15 + Trigger M5 & M1 + Stochastic Oversold"
                confidence = 95
            else:
                reason = "Trend bullish, menunggu Stochastic M1 K & D < 20"
        else:
            reason = "Trend bullish M15, namun entry trigger M5/M1 belum lurus"
            
    elif bias == "BEARISH":
        confidence = 65
        m5_bear = m5_ema34 > m5_ema21
        m1_bear = m1_ema34 > m1_ema21
        if m5_bear and m1_bear:
            confidence = 80
            if stoch_align_sell:
                signal = "SELL"
                reason = "Scalper Bearish M15 + Trigger M5 & M1 + Stochastic Overbought"
                confidence = 95
            else:
                reason = "Trend bearish, menunggu Stochastic M1 K & D > 80"
        else:
            reason = "Trend bearish M15, namun entry trigger M5/M1 belum lurus"

    return {
        "symbol": symbol,
        "strategy": "SCALPER",
        "bias": bias,
        "m15_ema21": float(m15_ema21),
        "m15_ema34": float(m15_ema34),
        "m5_ema21": float(m5_ema21),
        "m5_ema34": float(m5_ema34),
        "m1_ema21": float(m1_ema21),
        "m1_ema34": float(m1_ema34),
        "stoch_k": float(stoch_k),
        "stoch_d": float(stoch_d),
        "signal": signal,
        "reason": reason,
        "confidence": confidence,
        "current_price": float(df_m1['close'].iloc[-1]),
        "checklist": {
            "bias_m15_aligned": has_m15_bull if bias == "BULLISH" else (has_m15_bear if bias == "BEARISH" else False),
            "trigger_m5": (m5_ema21 > m5_ema34) if bias == "BULLISH" else ((m5_ema34 > m5_ema21) if bias == "BEARISH" else False),
            "trigger_m1": (m1_ema21 > m1_ema34) if bias == "BULLISH" else ((m1_ema34 > m1_ema21) if bias == "BEARISH" else False),
            "stochastic_condition": stoch_align_buy if bias == "BULLISH" else (stoch_align_sell if bias == "BEARISH" else False)
        }
    }

# ----------------- EXECUTION ENGINE (MT5 ORDER PLACEMENT) -----------------
def execute_order(symbol: str, signal: str, reason: str):
    """
    Kirim order BUY/SELL ke MT5 atau buat order simulasi jika tidak terhubung
    """
    lot_size = DEFAULT_VOLUME
    timestamp = datetime.datetime.now().isoformat()
    trade_id = int(time.time() * 1000)
    
    # Ambil harga terkini
    temp_df = fetch_history_data(symbol, "M5", 2)
    entry_price = float(temp_df['close'].iloc[-1]) if not temp_df.empty else 1.1250
    
    add_log(f"Mengevaluasi Trigger: Mengirim order {signal} untuk {symbol} pada harga {entry_price} lot {lot_size}...", "INFO")
    
    if bot_state.simulated_mode:
        # Simulasi Open Position
        new_pos = {
            "id": trade_id,
            "symbol": symbol,
            "type": signal,
            "entry_price": entry_price,
            "current_price": entry_price,
            "qty": lot_size,
            "lot_usd": lot_size * entry_price * 100000, # Perkiraan lot leverage USD
            "unrealized_pnl": 0.0,
            "signal_triggers": f"Simulated-{signal} EMA+Stoch",
            "timestamp": timestamp,
            "status": "OPEN"
        }
        bot_state.open_positions.append(new_pos)
        add_log(f"[SIMULATOR] Trade berhasil terbuka: {signal} {symbol} di {entry_price}", "INFO")
        return True
        
    # Real MT5 Trade Request
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        add_log(f"Simbol {symbol} tidak ditemukan di MT5", "ERROR")
        return False
        
    if not symbol_info.visible:
        mt5.symbol_select(symbol, True)
        
    price = mt5.symbol_info_tick(symbol).ask if signal == "BUY" else mt5.symbol_info_tick(symbol).bid
    order_type = mt5.ORDER_TYPE_BUY if signal == "BUY" else mt5.ORDER_TYPE_SELL
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot_size,
        "type": order_type,
        "price": price,
        "deviation": SLIPPAGE,
        "magic": 2026521,
        "comment": f"Nexus AI {bot_state.strategy_mode}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILL_FOK,
    }
    
    result = mt5.order_send(request)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        add_log(f"Layanan MT5 menolak transaksi: {result.comment} (Retcode: {result.retcode})", "ERROR")
        return False
        
    add_log(f"[MT5] Order berhasil tereksekusi! Tiket: {result.order}. Harga: {result.price}", "INFO")
    
    # Sync status instan
    sync_positions_with_mt5()
    return True

def close_position_mt5(pos_id: int):
    """
    Menutup trade manual / otomatis di MT5 atau dalam simulasi
    """
    closed_pos = None
    
    # Cari posisi di state internal
    for pos in bot_state.open_positions:
        if pos["id"] == pos_id:
            closed_pos = pos
            break
            
    if not closed_pos:
        return {"status": "error", "message": "Position ID tidak ditemukan"}

    symbol = closed_pos["symbol"]
    entry_price = closed_pos["entry_price"]
    qty = closed_pos["qty"]
    pos_type = closed_pos["type"]
    
    # Simpan harga penutupan dan pnl final
    temp_df = fetch_history_data(symbol, "M5", 2)
    exit_price = float(temp_df['close'].iloc[-1]) if not temp_df.empty else entry_price
    
    # Ambil PnL final
    if pos_type == "BUY":
        pnl = (exit_price - entry_price) * qty * 100000
    else:
        pnl = (entry_price - exit_price) * qty * 100000
        
    percentage = (pnl / bot_state.balance) * 100

    if bot_state.simulated_mode:
        bot_state.open_positions = [p for p in bot_state.open_positions if p["id"] != pos_id]
        
        # Tambahkan ke history tertutup
        new_history = {
            "id": pos_id,
            "symbol": symbol,
            "type": pos_type,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "qty": qty,
            "lot_usd": closed_pos["lot_usd"],
            "pnl": pnl,
            "percentage": percentage,
            "outcome": "WIN" if pnl >= 0 else "LOSE",
            "signal_triggers": closed_pos.get("signal_triggers", "AI Signal"),
            "timestamp": datetime.datetime.now().isoformat()
        }
        bot_state.closed_trades.append(new_history)
        bot_state.balance += pnl
        bot_state.free_margin = bot_state.balance
        bot_state.equity = bot_state.balance
        
        # Simpan grafik pnl
        bot_state.pnl_history.append({
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "balance": bot_state.balance,
            "pnl": pnl
        })
        
        add_log(f"[SIMULATOR] Manual close trade #{pos_id}: {symbol} final PnL: ${pnl:.4f}", "INFO")
        return {"status": "success", "message": "Posisi simulasi berhasil ditutup"}

    # Real MT5 Order Close
    position_mt5_ticket = pos_id # Tiket order sbg ID
    price = mt5.symbol_info_tick(symbol).bid if pos_type == "BUY" else mt5.symbol_info_tick(symbol).ask
    inverse_type = mt5.ORDER_TYPE_SELL if pos_type == "BUY" else mt5.ORDER_TYPE_BUY
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": qty,
        "type": inverse_type,
        "position": position_mt5_ticket,
        "price": price,
        "deviation": SLIPPAGE,
        "magic": 2026521,
        "comment": "Nexus AI Close Order",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILL_FOK,
    }
    
    result = mt5.order_send(request)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        add_log(f"Gagal menutup posisi MT5 #{pos_id}. Error: {result.comment}", "ERROR")
        return {"status": "error", "message": f"MT5 Error: {result.comment}"}
        
    add_log(f"[MT5] Posisi #{pos_id} sukses ditutup pada harga {exit_price}!", "INFO")
    sync_positions_with_mt5()
    return {"status": "success", "message": "Posisi MT5 berhasil ditutup"}


def sync_positions_with_mt5():
    """Import posisi terbuka real dari MetaTrader5"""
    if bot_state.simulated_mode:
        return
        
    positions = mt5.positions_get()
    if positions is None:
        bot_state.open_positions = []
        return
        
    new_open_positions = []
    total_unrealized = 0.0
    
    for pos in positions:
        pos_type_str = "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL"
        qty = pos.volume
        pnl = pos.profit
        total_unrealized += pnl
        
        new_open_positions.append({
            "id": pos.ticket,
            "symbol": pos.symbol,
            "type": pos_type_str,
            "entry_price": pos.price_open,
            "current_price": pos.price_current,
            "qty": qty,
            "lot_usd": qty * pos.price_open * 100000,
            "unrealized_pnl": pnl,
            "signal_triggers": f"MT5-{pos_type_str}",
            "timestamp": datetime.datetime.fromtimestamp(pos.time).isoformat(),
            "status": "OPEN"
        })
        
    bot_state.open_positions = new_open_positions
    account_info = mt5.account_info()
    if account_info is not None:
        bot_state.balance = account_info.balance
        bot_state.equity = account_info.equity
        bot_state.margin = account_info.margin
        bot_state.free_margin = account_info.free_margin


# ----------------- BACKGROUND BOT LOOP -----------------
def bot_background_loop():
    """
    Loop utama background: tick iterator harian untuk kalkulasi EMA, Stochastic, 
    dan eksekusi order otomatis.
    """
    add_log("Background Bot Logic Thread dimulai.", "INFO")
    tick_counter = 0
    
    while bot_state.is_running:
        try:
            strategy = bot_state.strategy_mode
            
            # Simulasi harga bergerak di background dan update unrealized PnL
            for sym in ASSETS:
                # Update tick counter per asset
                bot_state.tick_counters[sym] = bot_state.tick_counters.get(sym, 0) + 1
                
                # Check metrics & update values
                if bot_state.simulated_mode:
                    # Setiap ~30 detik atau 15 ticks ada peluang trade terpicu secara acak dari signal
                    # Update unrealized pnl untuk trade yang sedang terbuka
                    for pos in bot_state.open_positions:
                        if pos["symbol"] == sym:
                            # Random swing kecil
                            swing = np.random.normal(0, 0.0002)
                            direction = 1 if pos["type"] == "BUY" else -1
                            pos["current_price"] += swing
                            pos["unrealized_pnl"] += swing * direction * pos["qty"] * 100000
                    
                    # Hitung equity
                    tot_unrealized = sum(p["unrealized_pnl"] for p in bot_state.open_positions)
                    bot_state.equity = bot_state.balance + tot_unrealized
                    bot_state.free_margin = bot_state.equity - (len(bot_state.open_positions) * 100) # margin hold
                    bot_state.margin = len(bot_state.open_positions) * 100
                else:
                    sync_positions_with_mt5()
                
                # Evaluasi Signal & Kemungkinan Auto-Trade
                # Ambil status kondisi signal terkini
                if strategy == "DAY":
                    cond = check_day_trade_conditions(sym)
                else:
                    cond = check_scalper_conditions(sym)
                
                # Jika signal BUY / SELL dan belum ada posisi pada aset tsb, coba buy/sell
                if "signal" in cond and cond["signal"] in ["BUY", "SELL"]:
                    # check apakah sudah ada open posisi untuk symbol & type tsb
                    already_opened = any(p["symbol"] == sym and p["status"] == "OPEN" for p in bot_state.open_positions)
                    if not already_opened and bot_state.tick_counters[sym] >= 60:
                        execute_order(sym, cond["signal"], cond["reason"])
                        
                # Auto close simulator trades after some random profit/loss to keep history active
                if bot_state.simulated_mode:
                    for pos in list(bot_state.open_positions):
                        # Close jika profit > $150 atau loss < -$100 (atau probabilitas random)
                        if pos["unrealized_pnl"] > 180.0 or pos["unrealized_pnl"] < -120.0 or np.random.rand() < 0.03:
                            close_position_mt5(pos["id"])

            temp_unrealized = sum(p["unrealized_pnl"] for p in bot_state.open_positions)
            
            # Record Equity Curve berkala
            if tick_counter % 10 == 0:
                bot_state.pnl_history.append({
                    "time": datetime.datetime.now().strftime("%H:%M:%S"),
                    "balance": float(bot_state.balance),
                    "pnl": float(temp_unrealized)
                })
                if len(bot_state.pnl_history) > 30:
                    bot_state.pnl_history.pop(0)
            
            tick_counter += 1
            time.sleep(3) # Cek kondisi setiap 3 detik
            
        except Exception as e:
            logger.error(f"Error di loop background bot: {str(e)}")
            time.sleep(5)

# Start background thread
bot_thread = threading.Thread(target=bot_background_loop, daemon=True)
bot_thread.start()


# ----------------- FastAPI ENDPOINTS -----------------

class ModeSwitchRequest(BaseModel):
    mode: str # "DAY" or "SCALPER"

class ManualCloseRequest(BaseModel):
    position_id: int

@app.get("/api/status")
def get_bot_status():
    """
    Kembalikan status live bot, balance, open positions, metrics, checklist
    """
    # Ambil data per-aset
    live_signals = []
    
    for sym in ASSETS:
        cnt = bot_state.tick_counters.get(sym, 0)
        
        # Berikan status "BUILDING_HISTORY" if ticks < 60
        if cnt < 60:
            live_signals.append({
                "symbol": sym,
                "strategy": bot_state.strategy_mode,
                "ticks_collected": cnt,
                "ticks_needed": 60,
                "status": "BUILD_HISTORY",
                "signal": "HOLD",
                "reason": f"Membangun base data history awal. Progress: {cnt}/60 ticks.",
                "confidence": 0,
                "checklist": {
                    "bias_h4_aligned": False,
                    "bias_h1_aligned": False,
                    "trigger_m15": False,
                    "trigger_m5": False,
                    "stochastic_condition": False
                } if bot_state.strategy_mode == "DAY" else {
                    "bias_m15_aligned": False,
                    "trigger_m5": False,
                    "trigger_m1": False,
                    "stochastic_condition": False
                }
            })
        else:
            if bot_state.strategy_mode == "DAY":
                live_signals.append(check_day_trade_conditions(sym))
            else:
                live_signals.append(check_scalper_conditions(sym))
                
    # Hitung metrics
    tot_trades = len(bot_state.closed_trades)
    wins = len([t for t in bot_state.closed_trades if t["pnl"] > 0])
    win_rate = (wins / tot_trades * 100) if tot_trades > 0 else 0.0
    tot_pnl = sum(t["pnl"] for t in bot_state.closed_trades)
    
    return {
        "strategy_mode": bot_state.strategy_mode,
        "is_simulated": bot_state.simulated_mode,
        "metrics": {
            "balance": bot_state.balance,
            "equity": bot_state.equity,
            "margin": bot_state.margin,
            "free_margin": bot_state.free_margin,
            "unrealized_pnl": sum(p["unrealized_pnl"] for p in bot_state.open_positions),
            "total_trades": tot_trades,
            "win_rate": float(f"{win_rate:.2f}"),
            "daily_profit_usd": tot_pnl
        },
        "signals": live_signals,
        "open_positions": bot_state.open_positions,
        "closed_trades": sorted(bot_state.closed_trades, key=lambda x: x["timestamp"], reverse=True),
        "equity_curve": bot_state.pnl_history,
        "log_feed": bot_state.log_buffer[-30:] # return 30 log terakhir
    }

@app.post("/api/switch-mode")
def switch_strategy_mode(req: ModeSwitchRequest):
    """
    Switch mode DAY TRADE <-> SCALPER. Supaya performa terisolasi,
    reset session balance, trades, dan history.
    """
    mode_str = req.mode.upper()
    if mode_str not in ["DAY", "SCALPER"]:
        raise HTTPException(status_code=400, detail="Mode tidak valid. Harus 'DAY' atau 'SCALPER'")
        
    bot_state.strategy_mode = mode_str
    
    # RESET SESSION
    bot_state.balance = 10000.0
    bot_state.equity = 10000.0
    bot_state.margin = 0.0
    bot_state.free_margin = 10000.0
    bot_state.open_positions = []
    bot_state.closed_trades = []
    bot_state.pnl_history = [{"time": datetime.datetime.now().strftime("%H:%M:%S"), "balance": 10000.0, "pnl": 0.0}]
    bot_state.tick_counters = {sym: 0 for sym in ASSETS} # reset status ticks
    
    add_log(f"Mode bot berhasil dialihkan ke: {mode_str}. Melakukan reset state session dan history trading.", "WARNING")
    return {"status": "success", "message": f"Berhasil dialihkan ke {mode_str}, state dan log dibersihkan."}

@app.post("/api/close-position")
def close_trade_position(req: ManualCloseRequest):
    """
    Tutup order terpilih di MT5 atau dlm simulator
    """
    res = close_position_mt5(req.position_id)
    if res.get("status") == "error":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

if __name__ == "__main__":
    import uvicorn
    # Inisialisasi koneksi MT5 pas startup
    initialize_mt5()
    print("---------------------------------------------------------")
    print("Nexus AI Trading Bot API Server Aktif!")
    print("Silakan jalankan di PC local dengan: python bot_backend.py")
    print("---------------------------------------------------------")
    uvicorn.run(app, host="0.0.0.0", port=8000)
