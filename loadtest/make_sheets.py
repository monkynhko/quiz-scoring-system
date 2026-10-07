"""Vygeneruje umelé „odfotené“ odpoveďové hárky (na záťaž, nie na meranie presnosti AI).
Každý hárok: ručné písmo, mix správnych/nesprávnych/polovičných/prázdnych/prečiarknutých odpovedí,
natočenie, rozmazanie, tieň – a veľkosť ako fotka z mobilu (3024×4032, niekoľko MB)."""
import json, random, pathlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

FONTS = [f'/mnt/c/Windows/Fonts/{f}' for f in ('Inkfree.ttf', 'segoepr.ttf', 'mvboli.ttf', 'comic.ttf')]
BASE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
WRONG = ['Praha', 'Viedeň', 'neviem', 'Atlantický', '1992', 'Mozart', 'futbal', 'Venuša', '42', 'Nie', 'Áno', 'Francúzsko', 'Rakúsko', '?']
OUT = pathlib.Path(__file__).parent / 'sheets' / 'synthetic'


def sheet(round_no: int, answers: list[dict], team: str, rnd: random.Random) -> tuple[Image.Image, list]:
    W, H = 1240, 1754                         # A4 pri ~150 dpi
    img = Image.new('RGB', (W, H), (246, 244, 238))
    d = ImageDraw.Draw(img)
    base, big = ImageFont.truetype(BASE, 30), ImageFont.truetype(BASE, 44)
    hand = ImageFont.truetype(rnd.choice(FONTS), rnd.randint(46, 58))
    d.rounded_rectangle((70, 60, 420, 140), 18, outline=(40, 40, 40), width=3); d.text((90, 85), 'Číslo stola:', font=base, fill=(30, 30, 30))
    d.rounded_rectangle((450, 60, 1060, 140), 18, outline=(40, 40, 40), width=3); d.text((470, 72), 'Názov\ntímu', font=ImageFont.truetype(BASE, 22), fill=(30, 30, 30))
    d.text((560, 70), team, font=hand, fill=(20, 20, 60))
    d.rectangle((70, 170, 1170, 260), fill=(70, 70, 70)); d.text((100, 190), f'{round_no}. Kolo', font=big, fill='white')
    d.text((1080, 275), 'Body:', font=ImageFont.truetype(BASE, 22), fill=(30, 30, 30))
    truth = []
    for i, a in enumerate(answers):
        y = 320 + i * 130
        d.line((70, y - 10, 1170, y - 10), fill=(60, 60, 60), width=3)
        d.text((90, y + 40), f'{i + 1}.', font=base, fill=(30, 30, 30))
        kind = rnd.choices(['ok', 'wrong', 'half', 'empty', 'crossed'], [55, 25, 7, 8, 5])[0]
        text = {'ok': a['correct'], 'wrong': rnd.choice(WRONG), 'half': a['correct'].split()[0], 'empty': '', 'crossed': a['correct']}[kind]
        if kind == 'ok' and rnd.random() < 0.3:                     # preklep / iný zápis
            text = text.lower() if rnd.random() < 0.5 else text.upper()
        x = 200 + rnd.randint(-20, 40)
        if kind == 'crossed':
            wrong = rnd.choice(WRONG)
            d.text((x, y + 20), wrong, font=hand, fill=(20, 20, 60))
            w = d.textlength(wrong, font=hand); d.line((x - 5, y + 55, x + w + 5, y + 50), fill=(20, 20, 60), width=5)
            x += int(w) + 40
        if text:
            d.text((x, y + 20 + rnd.randint(-8, 8)), text, font=hand, fill=(20, 20, 60))
        truth.append({'q': i + 1, 'kind': kind, 'written': text})
    d.line((70, 320 + 10 * 130 - 10, 1170, 320 + 10 * 130 - 10), fill=(60, 60, 60), width=3)
    d.line((1060, 270, 1060, 1610), fill=(60, 60, 60), width=3)

    # „fotka“: stôl, natočenie, perspektíva, svetlo, rozmazanie
    photo = Image.new('RGB', (1512, 2016), (rnd.randint(90, 130), rnd.randint(60, 85), rnd.randint(35, 55)))
    sh = img.rotate(rnd.uniform(-6, 6), expand=True, fillcolor=(0, 0, 0, 0)).resize((1150, 1626))
    photo.paste(sh, (180 + rnd.randint(-40, 40), 190 + rnd.randint(-40, 40)))
    photo = ImageEnhance.Brightness(photo).enhance(rnd.uniform(0.75, 1.1))
    photo = photo.filter(ImageFilter.GaussianBlur(rnd.uniform(0.4, 1.3))).resize((3024, 4032))
    # šum senzora → veľkosť súboru ako reálna fotka z mobilu (2–4 MB)
    noise = Image.effect_noise((3024, 4032), 28).convert('RGB')
    photo = Image.blend(photo, noise, 0.06)
    return photo, truth


def main(per_round: int = 10, seed: int = 7):
    rounds = json.loads((pathlib.Path(__file__).parent / 'answers.json').read_text())['rounds']
    OUT.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(seed)
    manifest = []
    for r, rd in enumerate(rounds, 1):
        for i in range(per_round):
            img, truth = sheet(r, rd['answers'], f'Test tím {i + 1:02d}', rnd)
            path = OUT / f'r{r}_{i + 1:02d}.jpg'
            img.save(path, quality=92)
            manifest.append({'round': r, 'file': path.name, 'truth': truth})
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f'{len(manifest)} hárkov → {OUT}')


if __name__ == '__main__':
    import sys
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 10)
