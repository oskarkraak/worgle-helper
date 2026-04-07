# Worgle Helper

A web-based tool to find all valid Worgle words in a 4x4 grid. It uses a Trie data structure and Depth-First Search to find words of at least 3 letters without reusing grid cells. Includes a German dictionary.

## Setup

Requires Node.js.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:5173/` in your browser.

## Usage

- **Find Words**: Type your letters into the grid and click **Solve**.
- **View Paths**: Hover over any discovered word to see its path highlighted on the grid.
- **Remove Words**: Click any invalid word in the results list to quickly hide it. The application will permanently remove the word from `public/dictionary.txt`.

## CLI Bot (auto-play)

This repo also includes a command-line bot which can:

- calibrate the 4 corner **tile centers** of the 4x4 board (saved to a JSON config)
- interpolate the other 12 tile centers
- OCR each tile letter
- run the existing solver (`src/solver.js`)
- (optionally) drag across tiles to try each word

### Install

```bash
npm install
```

### Prepare a dictionary file

The bot always uses the German dictionary at `public/dictionary_de.txt` (one word per line).

### Run (dry-run recommended first)

```bash
npm run bot -- --dryRun
```

The first run will ask you to move your mouse to each corner tile center (top-left, top-right, bottom-left, bottom-right) and press Enter. It will then save `worgle-bot.config.json` with the calibration points.

### Run (actually drag words)

```bash
npm run bot --
```

If the game sometimes misses tiles during dragging, increase `timing.betweenTilesMs` in `worgle-bot.config.json` (e.g. 40–80ms).

