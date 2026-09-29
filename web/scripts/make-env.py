# Vytvorí web/.env.local zo starého config.js (Supabase URL + verejný anon kľúč).
# Spusti sám: python3 ~/projects/quiz-scoring-system/web/scripts/make-env.py
import re, pathlib
src = pathlib.Path('/mnt/c/Users/ŠpanoPeter/OneDrive - MIM, s.r.o/Pracovná plocha/Projects/quiz scoring system/quiz-scoring-system/config.js')
s = src.read_text(encoding='utf-8')
url = re.search(r'SUPABASE_URL\s*=\s*["\']([^"\']+)', s).group(1)
key = re.search(r'SUPABASE_ANON_KEY\s*=\s*["\']([^"\']+)', s).group(1)
out = pathlib.Path(__file__).resolve().parent.parent / '.env.local'
out.write_text(f'VITE_SUPABASE_URL={url}\nVITE_SUPABASE_ANON_KEY={key}\n', encoding='utf-8')
out.chmod(0o600)
print(f'Hotovo: {out}')
