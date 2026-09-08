const fs = require('fs');
const css = fs.readFileSync('frontend/src/style.css', 'utf8');

// Extract all --token definitions from :root
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/g);
const defined = new Set();
if (rootMatch) {
  rootMatch.forEach(block => {
    const defs = block.match(/--[a-z0-9-]+\s*:/g) || [];
    defs.forEach(d => defined.add(d.replace(':', '').trim()));
  });
}

// Extract all var(--token) usages
const usages = new Set();
const varMatches = css.match(/var\(--[a-z0-9-]+\)/g) || [];
varMatches.forEach(v => usages.add(v.replace('var(', '').replace(')', '')));

const missing = [...usages].filter(u => !defined.has(u));
console.log('Defined tokens:', defined.size);
console.log('Used tokens:', usages.size);
console.log('Missing (' + missing.length + '):', missing.join(', '));
