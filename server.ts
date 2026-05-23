import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Google GenAI client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  try {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    console.log("Gemini API Client initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Google GenAI:", error);
  }
} else {
  console.warn("GEMINI_API_KEY is not defined. AI analysis will run in mock mode.");
}

// REST Endpoint: Download Python Bot Backend script
app.get("/api/download/bot-backend", (req, res) => {
  const filePath = path.join(process.cwd(), "bot_backend.py");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=bot_backend.py");
    res.setHeader("Content-Type", "text/plain");
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).json({ error: "bot_backend.py file not found in workspace." });
  }
});

// REST Endpoint: Download Python Requirements
app.get("/api/download/requirements", (req, res) => {
  const filePath = path.join(process.cwd(), "requirements.txt");
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Disposition", "attachment; filename=requirements.txt");
    res.setHeader("Content-Type", "text/plain");
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).json({ error: "requirements.txt file not found in workspace." });
  }
});

// REST Endpoint: Log Viewer for local simulation
app.get("/api/logs", (req, res) => {
  const logPath = path.join(process.cwd(), "nexus_bot.log");
  if (fs.existsSync(logPath)) {
    const logs = fs.readFileSync(logPath, "utf-8");
    res.json({ logs: logs.split("\n").filter(Boolean).slice(-100) });
  } else {
    // Generate some mock log entries
    const now = new Date().toISOString();
    res.json({
      logs: [
        `${now} [INFO] [System] Nexus Express simulation active.`,
        `${now} [INFO] [System] Awaiting client connection to MT5...`
      ]
    });
  }
});

// REST Endpoint: Professional AI Trading Analysis using Gemini
app.post("/api/ai-analysis", async (req, res) => {
  const { metrics, signals, strategyMode, openPositions } = req.body;

  const prompt = `
  Anda adalah AI Trading Consultant Analyst. Analisis performa saat ini dari Nexus Trading Bot berbasis MT5.
  Strategi Aktif: ${strategyMode === "DAY" ? "📈 DAY TRADE (EMA-H4/H1 + Stochastic-M5)" : "⚡ SCALPER (EMA-M15 + Stochastic-M1)"}
  
  Metrics saat ini:
  - Balance: $${metrics?.balance || 10000}
  - Equity: $${metrics?.equity || 10000}
  - Unrealized PnL: $${metrics?.unrealized_pnl || 0}
  - Total Closed Trades: ${metrics?.total_trades || 0}
  - Win Rate: ${metrics?.win_rate || 0}%
  - Daily Profit/Loss: $${metrics?.daily_profit_usd || 0}

  Sinyal Saat Ini per Aset:
  ${JSON.stringify(signals || [], null, 2)}

  Posisi Terbuka saat ini:
  ${JSON.stringify(openPositions || [], null, 2)}

  Tugas Anda:
  1. Berikan rekomendasi taktis singkat (Buy/Sell/Hold) berdasarkan keselarasan multi-timeframe EMA dan Stochastic.
  2. Berikan estimasi apakah keuntungan saat ini cukup untuk biaya update AI bulanan & server PC hosting MT5.
  3. Berikan tips peningkatan kepercayaan sinyal.

  Tulis analisis dalam bahasa Indonesia yang sangat profesional, ramah, meyakinkan, format rapi dengan penomoran elegan, bebas dari istilah hiperbolis berlebihan.
  `;

  if (!ai) {
    // Mock simulation response if API key is not present
    return res.json({
      analysis: `### 📈 Laporan Konsultasi AI Real-time (Demo Mode)

1. **Evaluasi Sinyal & Bias Multi-Timeframe**
   Pada mode **${strategyMode === "DAY" ? "Day Trade" : "Scalper"}**, bot saat ini memantau sinyal per aset secara transparan. Dari target $${metrics?.balance || 10000}, win rate saat ini tercatat di angka **${metrics?.win_rate || "N/A"}%**. Posisi EMA selaras memberikan landasan bias yang cukup kokoh pada pair dominan.

2. **Perhitungan Biaya Operasional & Keuntungan**
   Proyeksi profit harian saat ini sebesar **$${metrics?.daily_profit_usd || "0"}** sangat menjanjikan. Dengan estimasi ini, keuntungan trading sangat mencukupi untuk membiayai sewa VPS Windows, lisensi API AI, dan upgrade infrastruktur bulanan tanpa mengurangi lot margin utama Anda secara signifikan.

3. **Rekomendasi Optimalisasi**
   * Disarankan untuk tetap mempertahankan strategi bias filter multi-timeframe terisolasi.
   * Hindari melakukan trade manual berlebih saat status timeframe terdeteksi **CONFLICT** guna menghindari kerugian drawdown berlebih.`
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Anda adalah analis trading elit handal yang berfokus pada manajemen risiko, indikator teknikal (EMA, Stochastic), dan kalkulasi pembiayaan infrastruktur robot trading.",
        temperature: 0.7,
      }
    });

    res.json({ analysis: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: "Gagal memproses analisis AI. Silakan coba sesaat lagi.", details: error.message });
  }
});

// Setup Vite development server or production static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express custom server running on http://localhost:${PORT}`);
  });
}

startServer();
