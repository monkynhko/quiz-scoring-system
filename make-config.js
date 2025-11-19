// make-config.js
// Simple script to generate a browser-friendly `config.js` from a .env file.
// Usage: `node make-config.js` (run from project root). Requires Node.js.

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');
const outPath = path.resolve(process.cwd(), 'config.js');

if (!fs.existsSync(envPath)) {
  console.error('.env file not found in project root. Create one from env.example');
  process.exit(1);
}

const env = fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const map = {};
for (const line of env) {
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  const key = line.substring(0, idx).trim();
  let val = line.substring(idx + 1).trim();
  // strip surrounding quotes if present
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.substring(1, val.length - 1);
  }
  map[key] = val;
}

if (!map.SUPABASE_URL || !map.SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const content = `// Auto-generated config for browser
window.SUPABASE_URL = ${JSON.stringify(map.SUPABASE_URL)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(map.SUPABASE_ANON_KEY)};
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log('Generated config.js');
