/**
 * dedup_css.js — removes earlier duplicate CSS rule blocks, keeping the last definition.
 * Rules: a "block" is from a selector line (contains {) to its closing }.
 * If the same selector appears multiple times, only the last occurrence is kept.
 */
const fs = require('fs');
const css = fs.readFileSync('frontend/src/style.css', 'utf8');
const lines = css.split('\n');

// Parse into blocks: each block is { selector, lines[] }
// Simple approach: split on blank-line boundaries then by selector presence
// More robust: track brace depth

const blocks = [];
let current = [];
let depth = 0;

for (const line of lines) {
  const opens  = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;

  if (depth === 0 && opens === 0 && closes === 0 && line.trim() === '') {
    // blank line between blocks
    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
    blocks.push(['']); // preserve blank line
    continue;
  }

  current.push(line);
  depth += opens - closes;

  if (depth <= 0) {
    depth = 0;
    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
}
if (current.length > 0) blocks.push(current);

// Identify selector for each block
function getSelector(block) {
  // First non-empty, non-comment line that contains {
  for (const l of block) {
    const t = l.trim();
    if (t && !t.startsWith('/*') && t.includes('{')) {
      return t.split('{')[0].trim();
    }
  }
  return null;
}

// Walk blocks in reverse; collect selectors seen; skip earlier duplicates
const seen = new Set();
const keepFlags = new Array(blocks.length).fill(true);

for (let i = blocks.length - 1; i >= 0; i--) {
  const sel = getSelector(blocks[i]);
  if (!sel) continue; // blank line or comment-only block, keep
  if (seen.has(sel)) {
    keepFlags[i] = false; // earlier duplicate — drop
  } else {
    seen.add(sel);
  }
}

const output = blocks.filter((_, i) => keepFlags[i]).flat().join('\n');
fs.writeFileSync('frontend/src/style.css', output, 'utf8');

const before = lines.length;
const after  = output.split('\n').length;
const removed = blocks.filter((_, i) => !keepFlags[i]);
console.log('Lines before: ' + before);
console.log('Lines after:  ' + after);
console.log('Duplicate blocks removed: ' + removed.length);
