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

function normalizeTileText(raw) {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");

  // Keep letters incl. umlauts. Allow 2 chars (e.g. "qu").
  const cleaned = s.replace(/[^a-zäöüß]/g, "");
  if (!cleaned) return "";

  // Prefer "qu" if present; otherwise just take first 1-2 chars.
  if (cleaned.startsWith("qu")) return "qu";
  return cleaned.slice(0, 2);
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

async function dragPath(tileCenters, pathIdxs, betweenTilesMs) {
  if (!pathIdxs || pathIdxs.length === 0) return;
  const first = tileCenters[pathIdxs[0]];
  await mouse.move(straightTo(new Point(first.x, first.y)));
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
      timing: config?.timing ?? { betweenWordsMs: 150, betweenTilesMs: 80 },
    };
    fs.writeFileSync(configPath, JSON.stringify(out, null, 2), "utf8");
    console.log(`Saved calibration to ${argv.config}`);
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

    const betweenWordsMs = Number(config?.timing?.betweenWordsMs ?? 150);
    const betweenTilesMs = Number(config?.timing?.betweenTilesMs ?? 80);

    console.log("Focus the game window now. Press Enter to start dragging words.");
    await promptEnter(rl, "");

    for (const { word, path: p } of words) {
      await checkFailSafeCorner(requestStop);
      if (stopRequested) throw new Error("Stopped by user");
      try {
        console.log(`Trying: ${word} (${p.join("-")})`);
        await dragPath(tileCenters, p, betweenTilesMs);
        if (betweenWordsMs > 0) await sleep(betweenWordsMs);
      } catch (e) {
        console.error(`Failed on word "${word}":`, e?.message ?? e);
      }
    }
  } finally {
    try {
      if (worker) await worker.terminate();
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

