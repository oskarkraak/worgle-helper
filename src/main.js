import './style.css';
import { Trie, solveWorgle } from './solver.js';

let trie = null;

// Initialize grid UI
const gridContainer = document.getElementById('worgle-grid');
const inputs = [];

for (let i = 0; i < 16; i++) {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 2; // Allow 2 chars for edge cases like 'qu', typical worgle is 1 though
  input.classList.add('grid-cell');
  input.dataset.index = i;
  
  // Auto-move focus on type
  input.addEventListener('input', (e) => {
    if (e.target.value.length === 1 && i < 15 && !e.target.value.match(/q/i)) { 
      inputs[i + 1].focus();
    }
    input.classList.remove('highlight', 'path-start');
  });

  input.addEventListener('focus', () => input.select());
  
  // Auto move with arrow keys
  input.addEventListener('keydown', (e) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    let nextIndex = -1;
    if (e.key === 'ArrowRight' && col < 3) nextIndex = i + 1;
    if (e.key === 'ArrowLeft' && col > 0) nextIndex = i - 1;
    if (e.key === 'ArrowDown' && row < 3) nextIndex = i + 4;
    if (e.key === 'ArrowUp' && row > 0) nextIndex = i - 4;
    if (nextIndex !== -1) {
        inputs[nextIndex].focus();
        e.preventDefault();
    }
    if (e.key === 'Backspace' && input.value === '') {
        if (i > 0) inputs[i - 1].focus();
    }
  });
  
  gridContainer.appendChild(input);
  inputs.push(input);
}

// Focus first input on load
setTimeout(() => inputs[0].focus(), 100);

// Clear Button
document.getElementById('clear-btn').addEventListener('click', () => {
  inputs.forEach(input => {
    input.value = '';
    input.classList.remove('highlight', 'path-start');
  });
  inputs[0].focus();
  document.getElementById('word-list').innerHTML = '';
  document.getElementById('word-count').innerText = '0';
});

// Dictionary loading
async function loadDictionary() {
  if (trie) return;
  const loading = document.getElementById('loading');
  loading.classList.remove('hidden');
  try {
    const response = await fetch('/dictionary.txt');
    if (!response.ok) throw new Error("Could not load dictionary");
    const text = await response.text();
    const words = text.split(/\r?\n/);
    
    trie = new Trie();
    words.forEach(word => {
        // Must match parameters from solver (trim and lower)
        word = word.trim().toLowerCase();
        // Skip short words or absurdly long words to save RAM
        if (word.length >= 3 && word.length <= 16) {
            trie.insert(word);
        }
    });
    console.log(`Loaded ${trie.wordCount} words into Trie`);
  } catch(e) {
    console.error(e);
    alert("Error loading dictionary. Check browser console.");
  } finally {
    loading.classList.add('hidden');
  }
}

// Solve Logic
document.getElementById('solve-btn').addEventListener('click', async () => {
    // Disable inputs / show loading maybe? Worgle solving is extremely fast with a Trie.
    await loadDictionary();
    
    // Clear highlights
    inputs.forEach(input => input.classList.remove('highlight', 'path-start'));
    
    // Get grid state
    const gridState = inputs.map(input => input.value.trim());
    
    // Check if empty
    if (gridState.every(val => val === '')) {
        alert("Please enter some letters into the grid.");
        return;
    }
    
    // 3 char minimum length
    const results = solveWorgle(gridState, trie, 3);
    
    // Render results
    const wordListEl = document.getElementById('word-list');
    const countEl = document.getElementById('word-count');
    wordListEl.innerHTML = '';
    
    // Sort words by length descending, then alphabetical
    const sortedWords = Array.from(results.entries()).sort((a, b) => {
        if (b[0].length !== a[0].length) {
            return b[0].length - a[0].length;
        }
        return a[0].localeCompare(b[0]);
    });
    
    countEl.innerText = sortedWords.length;
    
    if (sortedWords.length === 0) {
        wordListEl.innerHTML = '<p class="no-words">No words found.</p>';
        return;
    }
    
    sortedWords.forEach(([word, path]) => {
        const wordEl = document.createElement('div');
        wordEl.className = 'word-item';
        wordEl.innerText = word;
        
        // Hover effects
        wordEl.addEventListener('mouseenter', () => {
            inputs.forEach(inp => inp.classList.remove('highlight', 'path-start'));
            path.forEach((index, i) => {
                inputs[index].classList.add('highlight');
                if (i === 0) inputs[index].classList.add('path-start');
            });
        });
        
        wordEl.addEventListener('mouseleave', () => {
            inputs.forEach(inp => inp.classList.remove('highlight', 'path-start'));
        });
        
        wordListEl.appendChild(wordEl);
    });
});
