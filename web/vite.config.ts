import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Starý leaderboard (../leaderboard.html) servírujeme na /vysledky/, kým ho neprepíšeme do Reactu.
// config.js sa generuje z rovnakých premenných ako nový web (web/.env.local, resp. prostredie pri builde).
function legacyLeaderboard(env: Record<string, string>): Plugin {
  return {
    name: 'legacy-leaderboard',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist/vysledky')
      mkdirSync(out, { recursive: true })
      const html = readFileSync(resolve(__dirname, '../leaderboard.html'), 'utf8').replace(
        '<body',
        '<a href="/" style="position:fixed;top:10px;left:12px;z-index:99;color:#ff5fdc;font:600 14px Inter,system-ui,sans-serif;text-decoration:none">← kvizfactory.sk</a>\n<body',
      )
      writeFileSync(resolve(out, 'index.html'), html)
      writeFileSync(resolve(out, 'styles.css'), readFileSync(resolve(__dirname, '../styles.css')))
      writeFileSync(
        resolve(out, 'config.js'),
        `window.SUPABASE_URL = ${JSON.stringify(env.VITE_SUPABASE_URL)};\nwindow.SUPABASE_ANON_KEY = ${JSON.stringify(env.VITE_SUPABASE_ANON_KEY)};\n`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  return {
    plugins: [react(), legacyLeaderboard(env)],
    build: { chunkSizeWarningLimit: 600 },
  }
})
