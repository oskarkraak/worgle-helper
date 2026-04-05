export class TrieNode {
    constructor() {
        this.children = {};
        this.isEndOfWord = false;
    }
}

export class Trie {
    constructor() {
        this.root = new TrieNode();
        this.wordCount = 0;
    }

    insert(word) {
        let node = this.root;
        // Normalize: lowercase, keeping umlauts intact
        word = word.toLowerCase().trim();
        for (const char of word) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
        }
        if (!node.isEndOfWord) {
            node.isEndOfWord = true;
            this.wordCount++;
        }
    }
}

export function solveWorgle(grid, trie, minLength = 3) {
    const ROW_COUNT = 4;
    const COL_COUNT = 4;
    
    const results = new Map();
    
    const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [ 0, -1],          [ 0, 1],
        [ 1, -1], [ 1, 0], [ 1, 1]
    ];
    
    function dfs(r, c, currentNode, visited, currentWord, currentPath) {
        let cellContent = grid[r * COL_COUNT + c].toLowerCase().trim();
        if (!cellContent) return; // skip empty cells
        
        // Support cells with multiple characters (like 'qu') by matching each character deeply against Trie
        // For standard single-char cells, this loop just runs once.
        let nextNode = currentNode;
        for (let char of cellContent) {
            if (nextNode.children && nextNode.children[char]) {
                nextNode = nextNode.children[char];
            } else {
                return; // Pruning: prefix doesn't exist
            }
        }
        
        let cellIndex = r * COL_COUNT + c;
        visited.add(cellIndex);
        currentWord += cellContent;
        currentPath.push(cellIndex);
        
        if (nextNode.isEndOfWord && currentWord.length >= minLength) {
            if (!results.has(currentWord)) {
                results.set(currentWord, [...currentPath]);
            }
        }
        
        // recursive calls to 8 neighbors
        for (let [dr, dc] of directions) {
            let nr = r + dr;
            let nc = c + dc;
            if (nr >= 0 && nr < ROW_COUNT && nc >= 0 && nc < COL_COUNT) {
                let neighborIndex = nr * COL_COUNT + nc;
                if (!visited.has(neighborIndex)) {
                    dfs(nr, nc, nextNode, visited, currentWord, currentPath);
                }
            }
        }
        
        // backtrack
        visited.delete(cellIndex);
        currentPath.pop();
    }
    
    for (let i = 0; i < 16; i++) {
        let r = Math.floor(i / 4);
        let c = i % 4;
        let visited = new Set();
        dfs(r, c, trie.root, visited, "", []);
    }
    
    return results;
}
