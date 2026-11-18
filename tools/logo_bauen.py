# Pixelart-Logo Klarzeit: Stoppuhr, deren Zeiger einen Haken bilden (32 x 32 Raster, transparenter Grund).
# Kreise als Scheiben mit festem Radius, Konturen als Randpixel der Scheibe (gleichmaessige Staerke);
# Krone, Striche und Haken von Hand gesetzt. Farben aus der App (src/ui/styles.css: Akzent, Start-Gruen).
# Aufruf: python -I tools/logo_bauen.py <ausgabeordner>
#   -> raster.txt (Raster als Text), logo_32.png (Quelle), logo_1024.png (Vorschau auf Weiss), logo.svg
# Einbau: logo_32.png nach assets/source-logo.png kopieren, dann npm run icons; die Rechtecke aus logo.svg
# stehen in assets/readme/banner-{light,dark}.svg (Gruppe mit scale(9)).
import math
import pathlib
import sys

from PIL import Image

AUS = pathlib.Path(sys.argv[1])
N = 32
CX, CY = 16.0, 18.0  # Mittelpunkt auf einer Pixelecke -> symmetrischer Kreis gerader Breite

FARBEN = {
    '.': None,
    'O': '#1e3a8a',  # Kontur (blue-900)
    'B': '#2563eb',  # Ring (App-Akzent, blue-600)
    'b': '#60a5fa',  # Lichtkante (blue-400)
    'D': '#1d4ed8',  # Schatten im Ring (blue-700)
    'W': '#ffffff',  # Zifferblatt
    'w': '#e2e8f0',  # Schatten im Zifferblatt (slate-200)
    'T': '#94a3b8',  # Striche (slate-400)
    'G': '#16a34a',  # Haken-Zeiger (App-Start-Gruen, green-600)
}


def scheibe(radius):
    return {(x, y) for y in range(N) for x in range(N) if math.hypot(x + 0.5 - CX, y + 0.5 - CY) < radius}


def rand(menge):
    return {(x, y) for (x, y) in menge if any((x + dx, y + dy) not in menge for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}


def winkel(x, y):
    return math.degrees(math.atan2(y + 0.5 - CY, x + 0.5 - CX))  # 0 rechts, 90 unten, -90 oben


aussen = scheibe(13.0)
innen = scheibe(10.0)
r = [['.'] * N for _ in range(N)]
for (x, y) in aussen:
    r[y][x] = 'B'
for (x, y) in rand(aussen):
    r[y][x] = 'O'
for (x, y) in innen:
    r[y][x] = 'W'
for (x, y) in rand(innen):
    r[y][x] = 'O'
# Licht oben links nur in der aeusseren Pixelreihe des Rings (Glanzstreifen), Schatten unten rechts;
# Schatten im Zifferblatt unten rechts
ring = {(x, y) for (x, y) in aussen - innen if r[y][x] == 'B'}
aussenreihe = {(x, y) for (x, y) in ring if any(r[y + dy][x + dx] == 'O' and (x + dx, y + dy) in rand(aussen)
                                                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
for (x, y) in ring:
    w = winkel(x, y)
    if -165 <= w <= -110 and (x, y) in aussenreihe:
        r[y][x] = 'b'
    elif 15 <= w <= 75:
        r[y][x] = 'D'
for (x, y) in innen - rand(innen):
    if (x, y) in rand(innen - rand(innen)) and 5 <= winkel(x, y) <= 85:
        r[y][x] = 'w'


def setze(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        r[y][x] = c


# Krone: Knopf (3 Zeilen) und Stiel bis zum Ring
for x in range(13, 19):
    setze(x, 1, 'O')
    setze(x, 3, 'O')
setze(12, 2, 'O')
setze(19, 2, 'O')
for x in range(13, 19):
    setze(x, 2, 'B')
setze(13, 2, 'b')
setze(14, 2, 'b')
setze(15, 4, 'O')
setze(16, 4, 'O')

# Striche bei 12, 3, 6, 9 (innen an der Kontur)
for x, y in ((15, 9), (16, 9), (15, 26), (16, 26), (7, 17), (7, 18), (24, 17), (24, 18)):
    setze(x, y, 'T')

# Haken aus den Zeigern. Spitze unten (Zeile 18), kurzer Arm 45 Grad nach links oben,
# langer Arm 2:1 nach rechts oben; je zwei Pixel breit.
haken = [(15, 18), (16, 18),
         (14, 17), (15, 17), (13, 16), (14, 16), (12, 15), (13, 15), (11, 14), (12, 14),
         (16, 17), (17, 17), (17, 16), (18, 16), (17, 15), (18, 15), (18, 14), (19, 14),
         (18, 13), (19, 13), (19, 12), (20, 12), (19, 11), (20, 11)]
for x, y in haken:
    setze(x, y, 'G')

text = '\n'.join(''.join(z) for z in r)
(AUS / 'raster.txt').write_text(text + '\n', encoding='utf-8')
bild = Image.new('RGBA', (N, N), (0, 0, 0, 0))
for y in range(N):
    for x in range(N):
        f = FARBEN[r[y][x]]
        if f:
            bild.putpixel((x, y), tuple(int(f[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
bild.save(AUS / 'logo_32.png')
# SVG: je Zeile und Farbe zusammenhaengende Strecken als Rechteck, Rasterkoordinaten (viewBox 0 0 32 32)
strecken = []
for y in range(N):
    x = 0
    while x < N:
        c = r[y][x]
        x2 = x
        while x2 + 1 < N and r[y][x2 + 1] == c:
            x2 += 1
        if FARBEN[c]:
            strecken.append(f'<rect x="{x}" y="{y}" width="{x2 - x + 1}" height="1" fill="{FARBEN[c]}"/>')
        x = x2 + 1
(AUS / 'logo.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">'
    + ''.join(strecken) + '</svg>\n', encoding='utf-8')
print('SVG-Rechtecke:', len(strecken))
gross = bild.resize((1024, 1024), Image.NEAREST)
grund = Image.new('RGBA', gross.size, (255, 255, 255, 255))
grund.alpha_composite(gross)
grund.save(AUS / 'logo_1024.png')
print(text)
