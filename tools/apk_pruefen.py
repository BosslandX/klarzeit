# Entpackt eine APK in ein NEUES Verzeichnis und zaehlt Versions-Strings im Web-Bundle.
# Aufruf: python -I apk_pruefen.py <apk> <zielverzeichnis> <neu> <alt>
import hashlib
import os
import sys
import zipfile

apk, out, neu, alt = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(out)  # bricht ab, wenn es das Verzeichnis schon gibt
root = os.path.abspath(out)

with open(apk, 'rb') as f:
    data = f.read()
print('APK', len(data), 'Byte, SHA-256', hashlib.sha256(data).hexdigest())

with zipfile.ZipFile(apk) as z:
    infos = [i for i in z.infolist() if not i.filename.endswith('/')]
    seen = set()
    renamed = 0
    written = 0
    for i in infos:
        target = os.path.abspath(os.path.join(root, i.filename))
        if not target.startswith(root + os.sep):
            raise SystemExit('Pfad ausserhalb des Ziels: ' + i.filename)
        key = target.lower()
        n = 0
        while key in seen:  # Windows unterscheidet keine Gross-/Kleinschreibung
            n += 1
            base, ext = os.path.splitext(target)
            target2 = f'{base}__{n}{ext}'
            key = target2.lower()
        if n:
            target = target2
            renamed += 1
        seen.add(key)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as g:
            g.write(z.read(i))
        written += 1
print('Eintraege', len(infos), 'geschrieben', written, 'umbenannt', renamed)

public = os.path.join(root, 'assets', 'public')
zaehl = {neu: 0, alt: 0, '__APP_VERSION__': 0, 'Klarzeit': 0}
dateien = 0
for d, _, files in os.walk(public):
    for fn in files:
        if not fn.endswith(('.js', '.html', '.css', '.json')):
            continue
        dateien += 1
        text = open(os.path.join(d, fn), encoding='utf-8', errors='replace').read()
        for k in zaehl:
            zaehl[k] += text.count(k)
print('Bundle-Dateien', dateien, zaehl)
