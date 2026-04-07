#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { stdin as input } from "node:process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { Trie, solveWorgle } from "../src/solver.js";

import { mouse, screen, straightTo, Point, Region, saveImage, Button } from "@nut-tree-fork/nut-js";
import { createWorker } from "tesseract.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkFailSafeCorner(stopFn) {
  // If the user slams the mouse into top-left corner, stop.
  // This works even when the game window is focused.
  const p = await mouse.getPosition();
  if (p.x <= 2 && p.y <= 2) {
    stopFn("failsafe corner (move mouse to top-left)");
    return true;
  }
  return false;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function bilinear(tl, tr, bl, br, u, v) {
  const x =
    (1 - u) * (1 - v) * tl.x +
    u * (1 - v) * tr.x +
    (1 - u) * v * bl.x +
    u * v * br.x;
  const y =
    (1 - u) * (1 - v) * tl.y +
    u * (1 - v) * tr.y +
    (1 - u) * v * bl.y +
    u * v * br.y;
  return { x, y };
}

function toCornerPoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function toRgb(value) {
  if (!value || typeof value !== "object") return null;
  const r = Number(value.r);
  const g = Number(value.g);
  const b = Number(value.b);
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function colorDistanceRgb(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function sampleRgbAt(point) {
  const c = await screen.colorAt(new Point(point.x, point.y));
  return { r: Number(c.R), g: Number(c.G), b: Number(c.B) };
}

function normalizeTileText(raw) {
  // Preserve case from OCR so we can distinguish "l" vs "L".
  const s = String(raw ?? "").trim().replace(/\s+/g, "");

  // Keep letters incl. umlauts in both cases.
  const cleaned = s.replace(/[^a-zA-ZäöüßÄÖÜ]/g, "");
  if (!cleaned) return "";

  // Only keep the first OCR character.
  const ch = cleaned[0];

  // Case-aware fix for common confusion:
  // - lowercase "l" is often actually uppercase "I" in the UI -> treat as "i"
  // - uppercase "L" should remain an actual "l"
  if (ch === "l") return "i";
  if (ch === "I") return "i";
  if (ch === "L") return "l";

  return ch.toLowerCase();
}

function parseLanguage(lang) {
  const lower = String(lang || "de").toLowerCase();
  if (lower.startsWith("de")) return "deu";
  if (lower.startsWith("en")) return "eng";
  return "eng";
}

function parseModel(model) {
  // Kept for config compatibility; tesseract.js doesn't map 1:1.
  return String(model || "FAST").toUpperCase();
}

async function promptEnter(rl, message) {
  return new Promise((resolve) => rl.question(message, () => resolve()));
}

async function calibrateOrangeIndicatorInteractively(rl) {
  await promptEnter(
    rl,
    "Orange indicator: move mouse over an ORANGE pixel near the score and press Enter... "
  );
  const pos = await mouse.getPosition();
  const point = { x: Math.round(pos.x), y: Math.round(pos.y) };
  const rgb = await sampleRgbAt(point);
  console.log(`  -> orangeIndicator.point: (${point.x}, ${point.y})`);
  console.log(`  -> orangeIndicator.rgb: (${rgb.r}, ${rgb.g}, ${rgb.b})`);
  return { point, rgb };
}

async function isOrangeIndicatorActive(indicator, tolerance) {
  if (!indicator?.point || !indicator?.rgb) return false;
  const current = await sampleRgbAt(indicator.point);
  return colorDistanceRgb(current, indicator.rgb) <= tolerance;
}

function startOrangeIndicatorMonitor({ indicator, tolerance, pollMs, streak, shouldStop }) {
  // Polls independently of play loop and flips "confirmedActive" only after a streak.
  // The play loop can read getConfirmedActive() without ever waiting.
  let stopped = false;
  let confirmedActive = null; // null until first confirmation
  let activeStreak = 0;
  let inactiveStreak = 0;

  const loop = async () => {
    while (!stopped) {
      if (shouldStop?.()) return;
      try {
        const active = await isOrangeIndicatorActive(indicator, tolerance);
        if (active) {
          activeStreak++;
          inactiveStreak = 0;
          if (activeStreak >= streak) confirmedActive = true;
        } else {
          inactiveStreak++;
          activeStreak = 0;
          if (inactiveStreak >= streak) confirmedActive = false;
        }
      } catch {
        // Ignore transient read errors; keep last confirmed state.
      }
      await sleep(pollMs);
    }
  };

  void loop();

  return {
    stop() {
      stopped = true;
    },
    getConfirmedActive() {
      return confirmedActive;
    },
  };
}

async function calibrateCornersInteractively(rl) {
  const corners = {};
  const order = [
    ["topLeft", "Top-left tile center"],
    ["topRight", "Top-right tile center"],
    ["bottomLeft", "Bottom-left tile center"],
    ["bottomRight", "Bottom-right tile center"],
  ];

  for (const [key, label] of order) {
    await promptEnter(
      rl,
      `${label}: move mouse over it and press Enter... `
    );
    const pos = await mouse.getPosition();
    corners[key] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    console.log(`  -> ${key}: (${corners[key].x}, ${corners[key].y})`);
    await sleep(150);
  }
  return corners;
}

function computeTileCenters(corners) {
  const tl = corners.topLeft;
  const tr = corners.topRight;
  const bl = corners.bottomLeft;
  const br = corners.bottomRight;

  const centers = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const u = c / 3;
      const v = r / 3;
      const p = bilinear(tl, tr, bl, br, u, v);
      centers.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
  return centers;
}

function estimateTileRegionSize(corners) {
  const w = dist(corners.topLeft, corners.topRight) / 3;
  const h = dist(corners.topLeft, corners.bottomLeft) / 3;
  const base = Math.max(18, Math.floor(Math.min(w, h) * 0.72));
  return { width: base, height: base };
}

async function readTileWithOcr(worker, center, regionSize, ocrLang) {
  const halfW = Math.floor(regionSize.width / 2);
  const halfH = Math.floor(regionSize.height / 2);
  const region = new Region(
    Math.round(center.x - halfW),
    Math.round(center.y - halfH),
    regionSize.width,
    regionSize.height
  );

  const img = await screen.grabRegion(region);
  const tmpDir = path.resolve(process.cwd(), ".worgle-bot-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `tile-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  await saveImage({ image: img, path: tmpPath });

  try {
    // Restrict recognition to letters (incl. umlauts) to reduce noise.
    await worker.setParameters({
      tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ",
      preserve_interword_spaces: "0",
    });
    const { data } = await worker.recognize(tmpPath, ocrLang);
    return normalizeTileText(data?.text ?? "");
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function loadDictionary(dictPath) {
  const content = fs.readFileSync(dictPath, "utf8");
  const words = content.split(/\r?\n/);
  const trie = new Trie();
  for (let w of words) {
    w = String(w).trim().toLowerCase();
    if (w.length >= 3 && w.length <= 16) trie.insert(w);
  }
  return trie;
}

async function dragPath(tileCenters, pathIdxs, betweenTilesMs, settleOnStartMs = 0) {
  if (!pathIdxs || pathIdxs.length === 0) return;
  const first = tileCenters[pathIdxs[0]];
  await mouse.move(straightTo(new Point(first.x, first.y)));
  if (settleOnStartMs > 0) await sleep(settleOnStartMs);
  await mouse.pressButton(Button.LEFT);
  try {
    for (let i = 1; i < pathIdxs.length; i++) {
      const p = tileCenters[pathIdxs[i]];
      await mouse.move(straightTo(new Point(p.x, p.y)));
      if (betweenTilesMs > 0) await sleep(betweenTilesMs);
    }
  } finally {
    await mouse.releaseButton(Button.LEFT);
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("worgle-bot")
    .option("config", {
      type: "string",
      default: "./worgle-bot.config.json",
      describe: "Path to bot config JSON (corners, OCR settings, timing)",
    })
    .option("minLength", {
      type: "number",
      default: 3,
      describe: "Minimum word length",
    })
    .option("dryRun", {
      type: "boolean",
      default: false,
      describe: "Do everything except dragging words",
    })
    .option("limit", {
      type: "number",
      default: 0,
      describe: "Max words to try (0 = no limit)",
    })
    .option("sort", {
      type: "string",
      default: "length",
      choices: ["length", "alpha"],
      describe: "Sort words before trying them",
    })
    .help()
    .strict().argv;

  const configPath = path.resolve(process.cwd(), argv.config);
  const dictPath = path.resolve(process.cwd(), "public", "dictionary_de.txt");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let stopRequested = false;
  const requestStop = (reason) => {
    if (stopRequested) return;
    stopRequested = true;
    if (reason) console.log(`\nStopping (${reason})...`);
  };

  // Global "q" quit (works even when terminal isn't focused)
  // Best-effort: if hook can't start (permissions/AV), we keep other stop methods.
  let uiohook = null;
  try {
    const mod = await import("uiohook-napi");
    uiohook = mod.uIOhook ?? mod.default?.uIOhook ?? mod.default ?? null;
    const keycodes = mod.UiohookKeycode ?? mod.default?.UiohookKeycode ?? null;
    const VC_Q = keycodes?.VC_Q ?? 16; // libuiohook uses VC_Q = 16
    if (uiohook?.on && uiohook?.start) {
      uiohook.on("keydown", (e) => {
        if (e?.keycode === VC_Q) requestStop("global q");
      });
      uiohook.start();
      console.log("Global quit enabled: press Q to stop (works without terminal focus).");
    }
  } catch {
    // ignore
  }

  // Ctrl+C handling
  const sigintHandler = () => requestStop("Ctrl+C");
  process.on("SIGINT", sigintHandler);

  // Optional: press "q" to stop (only works if terminal has focus)
  try {
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.on("keypress", (str, key) => {
      if (key?.name === "q") requestStop("q");
      if (key?.name === "escape") requestStop("Esc");
    });
  } catch {
    // Ignore if raw mode isn't available
  }
  console.log("Failsafe stop: move mouse to top-left corner (0,0) to stop.");

  let config = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      config = null;
    }
  }

  const corners = {
    topLeft: toCornerPoint(config?.corners?.topLeft),
    topRight: toCornerPoint(config?.corners?.topRight),
    bottomLeft: toCornerPoint(config?.corners?.bottomLeft),
    bottomRight: toCornerPoint(config?.corners?.bottomRight),
  };

  const missingCorner =
    !corners.topLeft || !corners.topRight || !corners.bottomLeft || !corners.bottomRight;

  // Round indicator (orange pixel near score)
  const roundOrangePoint = toCornerPoint(config?.round?.orangeIndicator?.point);
  const roundOrangeRgb = toRgb(config?.round?.orangeIndicator?.rgb);
  const hasRoundIndicator = !!(roundOrangePoint && roundOrangeRgb);

  if (missingCorner) {
    console.log(`No (valid) corners found in ${argv.config}. Starting calibration...`);
    const calibrated = await calibrateCornersInteractively(rl);
    corners.topLeft = calibrated.topLeft;
    corners.topRight = calibrated.topRight;
    corners.bottomLeft = calibrated.bottomLeft;
    corners.bottomRight = calibrated.bottomRight;

    const out = {
      version: 1,
      corners,
      ocr: config?.ocr ?? {
        dataPath: "./ocr-data",
        language: "de",
        model: "FAST",
      },
      round: config?.round ?? { orangeIndicator: null, tolerance: 35, pollMs: 200 },
      timing: config?.timing ?? { betweenWordsMs: 150, betweenTilesMs: 80, settleOnWordStartMs: 50 },
    };
    fs.writeFileSync(configPath, JSON.stringify(out, null, 2), "utf8");
    console.log(`Saved calibration to ${argv.config}`);

    // Keep in-memory config in sync for this run
    config = out;
  }

  // If not configured yet, offer to calibrate the round indicator now (only relevant for non-dry runs).
  if (!argv.dryRun && !hasRoundIndicator) {
    console.log(`No orange round indicator found in ${argv.config}. Calibrating...`);
    const orangeIndicator = await calibrateOrangeIndicatorInteractively(rl);
    const nextConfig = {
      ...(config ?? { version: 1 }),
      corners: config?.corners ?? corners,
      ocr: config?.ocr ?? { dataPath: "./ocr-data", language: "de", model: "FAST" },
      round: {
        orangeIndicator,
        tolerance: Number(config?.round?.tolerance ?? 35),
        pollMs: Number(config?.round?.pollMs ?? 200),
      },
      timing: config?.timing ?? { betweenWordsMs: 150, betweenTilesMs: 80, settleOnWordStartMs: 50 },
    };
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
    console.log(`Saved round indicator to ${argv.config}`);
    config = nextConfig;
  }

  const ocrDataPath = String(config?.ocr?.dataPath ?? "./ocr-data");
  const ocrLanguage = String(config?.ocr?.language ?? "de");
  const ocrModel = String(config?.ocr?.model ?? "FAST");

  const ocrLang = parseLanguage(ocrLanguage);
  // tesseract.js stores language data in its own cache; we keep ocrDataPath for future extensibility.
  void ocrDataPath;
  void ocrModel;
  let worker = null;
  try {
    worker = await createWorker();
    await worker.reinitialize(ocrLang);

    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = 2500;

    const tileCenters = computeTileCenters(corners);
    const regionSize = estimateTileRegionSize(corners);

    const betweenWordsMs = Number(config?.timing?.betweenWordsMs ?? 150);
    const betweenTilesMs = Number(config?.timing?.betweenTilesMs ?? 80);
    const settleOnWordStartMs = Number(config?.timing?.settleOnWordStartMs ?? 50);

    const roundTolerance = Number(config?.round?.tolerance ?? 35);
    const roundPollMs = Number(config?.round?.pollMs ?? 200);
    const roundStreak = Number(config?.round?.streak ?? 5);
    const roundIndicator = config?.round?.orangeIndicator
      ? { point: toCornerPoint(config.round.orangeIndicator.point), rgb: toRgb(config.round.orangeIndicator.rgb) }
      : null;

    let roundMonitor = null;
    const playOneRound = async () => {
      console.log("Reading tiles via OCR...");
      console.log("Press Ctrl+C (or 'q') to stop. Or use the failsafe corner.");
      const grid = [];
      for (let i = 0; i < 16; i++) {
        await checkFailSafeCorner(requestStop);
        if (stopRequested) throw new Error("Stopped by user");
        const text = await readTileWithOcr(worker, tileCenters[i], regionSize, ocrLang);
        grid.push(text);
        process.stdout.write(`  tile ${i + 1}/16: ${text || "·"}\n`);
      }

      console.log("Grid:");
      for (let r = 0; r < 4; r++) {
        console.log(
          grid
            .slice(r * 4, r * 4 + 4)
            .map((s) => (s || "·").padEnd(2, " "))
            .join(" ")
        );
      }

      console.log("Loading dictionary & solving...");
      if (!fs.existsSync(dictPath)) {
        throw new Error(
          `German dictionary not found at ${dictPath}. Add a dictionary file there (one word per line).`
        );
      }
      const trie = await loadDictionary(dictPath);
      const results = solveWorgle(grid, trie, argv.minLength);

      let words = Array.from(results.entries()).map(([word, path]) => ({ word, path }));
      if (argv.sort === "length") {
        words.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
      } else {
        words.sort((a, b) => a.word.localeCompare(b.word));
      }
      if (argv.limit > 0) words = words.slice(0, argv.limit);

      console.log(`Found ${results.size} words. Trying ${words.length}...`);
      if (argv.dryRun) {
        console.log("(dryRun enabled: not dragging)");
        return;
      }

      for (const { word, path: p } of words) {
        await checkFailSafeCorner(requestStop);
        if (stopRequested) throw new Error("Stopped by user");

        if (roundIndicator?.point && roundIndicator?.rgb) {
          const active = roundMonitor?.getConfirmedActive();
          if (active === false) {
            console.log("Round ended (orange indicator changed). Stopping this round.");
            return;
          }
        }

        try {
          console.log(`Trying: ${word} (${p.join("-")})`);
          await dragPath(tileCenters, p, betweenTilesMs, settleOnWordStartMs);
          if (betweenWordsMs > 0) await sleep(betweenWordsMs);
        } catch (e) {
          console.error(`Failed on word \"${word}\":`, e?.message ?? e);
        }
      }
    };

    if (argv.dryRun || !roundIndicator?.point || !roundIndicator?.rgb) {
      await playOneRound();
      return;
    }

    console.log("Round auto-detect enabled.");
    roundMonitor = startOrangeIndicatorMonitor({
      indicator: roundIndicator,
      tolerance: roundTolerance,
      pollMs: roundPollMs,
      streak: roundStreak,
      shouldStop: () => stopRequested,
    });

    try {
      console.log("Waiting for round to start (orange indicator matches)...");
      while (roundMonitor.getConfirmedActive() !== true) {
        await checkFailSafeCorner(requestStop);
        if (stopRequested) throw new Error("Stopped by user");
        await sleep(roundPollMs);
      }
      console.log("Round started. Playing...");

      while (true) {
        await playOneRound();
        console.log("Waiting for next round...");
        while (roundMonitor.getConfirmedActive() !== true) {
          await checkFailSafeCorner(requestStop);
          if (stopRequested) throw new Error("Stopped by user");
          await sleep(roundPollMs);
        }
        console.log("New round detected. Playing...");
      }
    } finally {
      roundMonitor.stop();
    }
  } finally {
    try {
      if (worker) await worker.terminate();
    } catch {}
    try {
      if (uiohook?.stop) uiohook.stop();
    } catch {}
    try {
      process.off("SIGINT", sigintHandler);
    } catch {}
    try {
      if (input.isTTY) input.setRawMode(false);
    } catch {}
    rl.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

