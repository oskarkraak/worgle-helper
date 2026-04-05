import './style.css';
import { Trie, solveWorgle } from './solver.js';

let trie = null;
const langSelect = document.getElementById('lang-select');

// Helper to manage language-specific blocked words
const enPoints = {
  a:1, b:3, c:3, d:2, e:1, f:4, g:2, h:4, i:1, j:8, k:5, l:1, m:3, n:1, o:1, p:3, q:1, r:1, s:1, t:1, u:1, v:4, w:4, x:8, y:4, z:10
}; // unknown: q
const dePoints = {
  a:1, b:3, c:4, d:1, e:1, f:4, g:2, h:2, i:1, j:1, k:4, l:2, m:3, n:1, o:2, p:4, q:10, r:1, s:1, t:1, u:1, v:6, w:3, x:1, y:10, z:3, 'ä':6, 'ö':6, 'ü':6
}; // unknown: j,x

function getWordPoints(word, lang, path, inputs) {
  const pointsMap = lang === 'en' ? enPoints : dePoints;
  let total = 0;
  for (const char of word) {
    total += pointsMap[char] || 1;
  }
  let maxMult = 1;
  for (const idx of path) {
    const m = parseInt(inputs[idx].dataset.multiplier || "1");
    if (m > maxMult) maxMult = m;
  }
  return total * maxMult;
}
function getRemovedWordsSet() {
    const lang = langSelect.value;
    const str = localStorage.getItem(`worgle-removed-words-${lang}`) || '[]';
    return new Set(JSON.parse(str));
}

function saveRemovedWord(word) {
    const lang = langSelect.value;
    const set = getRemovedWordsSet();
    set.add(word);
    localStorage.setItem(`worgle-removed-words-${lang}`, JSON.stringify([...set]));
}

langSelect.addEventListener('change', () => {
    trie = null;
    document.getElementById('solve-btn').click();
});

// Initialize grid UI
const gridContainer = document.getElementById('worgle-grid');
const inputs = [];

for (let i = 0; i < 16; i++) {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 2; // Allow 2 chars for edge cases like 'qu', typical worgle is 1 though
  input.classList.add('grid-cell');
  input.dataset.index = i;
  input.dataset.multiplier = "1";
  
  // Auto-move focus on type
  input.addEventListener('input', (e) => {
    if (e.target.value.length === 1 && i < 15 && !e.target.value.match(/q/i)) { 
      inputs[i + 1].focus();
    }
    input.classList.remove('highlight', 'path-start');
    
    // Auto-solve when grid is completely filled
    if (inputs.every(inp => inp.value.trim() !== '')) {
        document.getElementById('solve-btn').click();
    }
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
    if (e.key === 'Enter') {
        let current = parseInt(input.dataset.multiplier || "1");
        current = current >= 3 ? 1 : current + 1;
        input.dataset.multiplier = current;
        if (inputs.every(inp => inp.value.trim() !== '')) {
            document.getElementById('solve-btn').click();
        }
        e.preventDefault();
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
    input.dataset.multiplier = "1";
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
    const lang = langSelect.value;
    const response = await fetch(`/dictionary_${lang}.txt`);
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
    const rawResults = solveWorgle(gridState, trie, 3);
    
    const removedWords = getRemovedWordsSet();
    const results = new Map();
    for (const [word, path] of rawResults.entries()) {
        if (!removedWords.has(word)) {
            results.set(word, path);
        }
    }
    
    // Render results
    const wordListEl = document.getElementById('word-list');
    const countEl = document.getElementById('word-count');
    wordListEl.innerHTML = '';
    
    const lang = langSelect.value;
    const wordsWithData = Array.from(results.entries()).map(([word, path]) => {
        return { word, path, points: getWordPoints(word, lang, path, inputs) };
    });
    
    // Sort words by points descending, then length descending, then alphabetical
    wordsWithData.sort((a, b) => {
        if (b.points !== a.points) {
            return b.points - a.points;
        }
        if (b.word.length !== a.word.length) {
            return b.word.length - a.word.length;
        }
        return a.word.localeCompare(b.word);
    });
    
    countEl.innerText = wordsWithData.length;
    
    if (wordsWithData.length === 0) {
        wordListEl.innerHTML = '<p class="no-words">No words found.</p>';
        return;
    }
    
    wordsWithData.forEach(({word, path, points}) => {
        const wordEl = document.createElement('div');
        wordEl.className = 'word-item';
        wordEl.innerHTML = `<span>${word}</span> <span class="pts-badge">${points}</span>`;
        
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
        
        wordEl.addEventListener('click', async () => {
            saveRemovedWord(word);
            wordEl.remove();
            countEl.innerText = parseInt(countEl.innerText) - 1;
            inputs.forEach(inp => inp.classList.remove('highlight', 'path-start'));
            
            // Permanently remove from file via Vite backend
            try {
                await fetch('/api/remove-word', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ word, lang: langSelect.value })
                });
            } catch (e) {
                console.error("Could not remove word from file:", e);
            }
        });
        
        wordListEl.appendChild(wordEl);
    });
});
