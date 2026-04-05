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
