#!/usr/bin/env python
"""Kopiert einen Quellbaum in den Arbeitsort -- Links bleiben Links.

WARUM (gemessen 2026-09-24, lohnradar-azure, AUF-000 Anlauf 1): 'Copy-Item -Recurse'
(Windows PowerShell 5.1) folgt Verzeichnis-Symlinks. Buns isolierter Linker legt die
node_modules als 2.386 relative Symlinks an; aus 51.960 Dateien im Wurzel-node_modules
wurden 185.396, der Arbeitsort waere rund 10,8 GB statt 1,1 GB gross geworden, und die
Gegenprobe in auftrag.ps1 brach ab. 'robocopy /SL' legt hier gar keinen Link an (Probe:
rc=1, Link fehlt -- still). os.symlink kann es ohne Sonderrechte.

ZWEI DURCHGAENGE: erst alle echten Verzeichnisse und Dateien, dann jeder Link mit seinem
woertlichen Ziel, ausdruecklich als Verzeichnis-Link, wenn die Quelle einer ist. In einem
Durchgang entstuenden Links, deren Ziel noch nicht kopiert ist, auf Windows als DATEI-Links
(os.symlink raet den Typ am vorhandenen Ziel).

DER LINKTYP WIRD AM LINK ABGELESEN, nicht am Ziel (lohnradar-azure S6 gemessen, S7 hier):
os.path.isdir folgt dem Link und haelt einen TOTEN Verzeichnis-Link fuer keinen. Zwei solche
Links in node_modules wurden als Datei-Links angelegt; Get-ChildItem -File zaehlte sie im Ziel
mit, die Gegenprobe in auftrag.ps1 zaehlte im Arbeitsort 58.046 statt 58.044 Dateien und brach
die Einrichtung ab -- waehrend die eigene Pruefung hier Exit 0 meldete, weil sie nur das Linkziel
verglich. Unter
Windows traegt ein Verzeichnis-Link selbst FILE_ATTRIBUTE_DIRECTORY, auch ohne Ziel. Die Pruefung
vergleicht den Typ jetzt mit, und jeder tote Link wird gemeldet (Zeile "TOTER LINK ...").

Ein Link, dessen Ziel aus <grenze> herausfuehrt, wird NICHT angelegt (Exit 1): ein
'git worktree remove --force' darf nie einem Link aus dem Arbeitsort heraus folgen.

Aufruf:  python -u tools/quellbaum_kopieren.py <quelle> <ziel> <grenze> [--nur-pruefen]
Exit 0 = Ziel traegt gleich viele Dateien und Links wie die Quelle, jeder Link mit
         demselben Ziel und demselben Typ. Exit 1 = sonst, mit Begruendung.
"""
import os
import shutil
import stat
import sys


def ist_link(p):
    return os.path.islink(p) or os.path.isjunction(p)


def ist_verzeichnislink(p):
    """Typ am Link selbst (Windows: FILE_ATTRIBUTE_DIRECTORY), auch wenn sein Ziel fehlt.

    Ausserhalb von Windows haben Links keinen eigenen Typ; dort gilt, worauf er zeigt.
    """
    attribute = getattr(os.lstat(p), 'st_file_attributes', None)
    if attribute is None:
        return os.path.isdir(p)
    return bool(attribute & stat.FILE_ATTRIBUTE_DIRECTORY)


def inventar(wurzel):
    """{relativer Pfad: (Linkziel, Verzeichnis-Link?) oder None} fuer jede Datei und jeden Link,
    ohne Links zu folgen."""
    inv = {}
    for dp, dns, fns in os.walk(wurzel):
        for n in dns + fns:
            p = os.path.join(dp, n)
            if ist_link(p):
                inv[os.path.relpath(p, wurzel)] = (os.readlink(p), ist_verzeichnislink(p))
            elif n in fns:
                inv[os.path.relpath(p, wurzel)] = None
    return inv


def tote_links(wurzel):
    """[(relativer Pfad, Linkziel, Verzeichnis-Link?)] fuer jeden Link, dessen Ziel fehlt."""
    tot = []
    for rel, wert in sorted(inventar(wurzel).items()):
        if wert is not None and not os.path.exists(os.path.join(wurzel, rel)):
            tot.append((rel, wert[0], wert[1]))
    return tot


def innerhalb(pfad, grenze):
    a = os.path.normcase(os.path.normpath(pfad))
    g = os.path.normcase(os.path.normpath(grenze))
    return a == g or a.startswith(g + os.sep)


def kopieren(quelle, ziel, grenze):
    links = []
    for dp, dns, fns in os.walk(quelle):
        zdir = os.path.normpath(os.path.join(ziel, os.path.relpath(dp, quelle)))
        os.makedirs(zdir, exist_ok=True)
        for n in dns + fns:
            p = os.path.join(dp, n)
            if ist_link(p):
                links.append((p, os.path.join(zdir, n)))
            elif n in fns:
                shutil.copy2(p, os.path.join(zdir, n))
    for q, z in links:
        zielwort = os.readlink(q)
        aufgeloest = os.path.join(os.path.dirname(z), zielwort)
        if os.path.isabs(zielwort) or not innerhalb(aufgeloest, grenze):
            print(f"LINK FUEHRT HERAUS, nicht angelegt: {q} -> {zielwort}")
            return 1
        os.symlink(zielwort, z, target_is_directory=ist_verzeichnislink(q))
    return 0


def pruefen(quelle, ziel):
    iq, iz = inventar(quelle), inventar(ziel)
    dq = sum(1 for v in iq.values() if v is None)
    dz = sum(1 for v in iz.values() if v is None)
    lq, lz = len(iq) - dq, len(iz) - dz
    print(f"Quelle: {dq} Dateien, {lq} Links | Ziel: {dz} Dateien, {lz} Links")
    tot = tote_links(quelle)
    for rel, zielwort, verz in tot:
        print(f"TOTER LINK in der Quelle ({'Verzeichnis' if verz else 'Datei'}-Link, Ziel fehlt): "
              f"{rel} -> {zielwort}")
    print(f"Tote Links in der Quelle: {len(tot)}")
    fehlt = sorted(set(iq) - set(iz))
    zuviel = sorted(set(iz) - set(iq))
    gemeinsam = set(iq) & set(iz)
    # Datei gegen Link: genau einer der beiden Eintraege ist None.
    art = sorted(k for k in gemeinsam if (iq[k] is None) != (iz[k] is None))
    beide_links = [k for k in gemeinsam if iq[k] is not None and iz[k] is not None]
    anders = sorted(k for k in beide_links if iq[k][0] != iz[k][0])
    typ = sorted(k for k in beide_links if iq[k][1] != iz[k][1])
    for name, liste in (("fehlt im Ziel", fehlt), ("zu viel im Ziel", zuviel),
                        ("Datei gegen Link", art), ("anderes Linkziel", anders),
                        ("anderer Linktyp", typ)):
        if liste:
            print(f"{name}: {len(liste)}, z. B. {liste[:3]}")
    return 0 if not (fehlt or zuviel or art or anders or typ) else 1


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    quelle, ziel, grenze = (os.path.abspath(a) for a in argv[1:4])
    if not os.path.isdir(quelle):
        print(f"Quelle fehlt: {quelle}")
        return 1
    if "--nur-pruefen" not in argv:
        if kopieren(quelle, ziel, grenze) != 0:
            return 1
    return pruefen(quelle, ziel)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
