# Die Rechtedateien unter `.cursor/`

| Datei | was sie ist |
|---|---|
| `cli.aus.json` | Vorlage: nur lesen. Der Standardzustand. |
| `cli.an.json` | Vorlage: Arbeitsmodus. |
| `cli.json` | **die wirksame Datei.** `tools/cursor.ps1 -An` / `-Aus` kopiert eine der Vorlagen hierher; der Zustand wird per SHA-256 gegen beide bestimmt. |

Erklärungen gehören hierher, **nicht** in die JSON-Dateien: `cursor-agent` validiert
`.cursor/cli.json` gegen ein Schema und weist unbekannte Felder ab. Ein `"_kommentar"`
darin ließ jeden Aufruf mit `Invalid project config: schema validation failed`
scheitern (gemessen am 2026-09-09 in `gamedesign`).

---

# ⛔ Diese Liste ist KEINE Grenze

Am **2026-09-09** in `klarzeit` gemessen (`AUF-002`), mit `Write(**)` als einziger
Write-Sperre und zwei `allow`-Einträgen für die Ergebnisverzeichnisse:

| | Ergebnis |
|---|---|
| **Das `Write`-Werkzeug** | wurde für **jeden** Pfad blockiert — auch für die in `allow` ausdrücklich erlaubten Ergebnisverzeichnisse |
| **`Shell(python)`** | schrieb **alle 12 Ziele**: `src/`, `android/`, `tools/`, `.serena/`, `CLAUDE.md`, eine Datei ohne Endung, eine mit unbekannter Endung, drei Ebenen tief — und `../AUF-002_ausbruch.txt` **außerhalb des Arbeitsorts** |

## Was daraus folgt

**1. Die Write-Sperren wirken nur gegen das `Write`-Werkzeug, nicht gegen die Shell.**
Solange `Shell(python)` in `allow` steht — und ohne das kann ein Ausführender nichts
messen — ist jede Write-Sperre eine Absichtserklärung.

**2. Das frühere Bild war ein Artefakt der Werkzeugwahl.** In `AUF-000` (gamedesign,
klarzeit) sah es so aus, als hielten die *Muster*-Sperren (`*.md`, `*.ts`) und fielen nur
die *Pfad*-Sperren (`src/**`, `books/**`). Tatsächlich hatte der Ausführende dort für die
Muster das `Write`-Werkzeug benutzt und für die Pfade die Shell. Die Sperrenart hatte
damit nichts zu tun.

**3. `Write(**)` macht es schlimmer, nicht besser.** Es hindert den Ausführenden daran,
mit seinem normalen Werkzeug in die *erlaubten* Verzeichnisse zu schreiben, und zwingt
ihn damit auf den Shell-Umweg, der gar keine Grenze kennt.

## Was tatsächlich hält

**Der Fingerabdruck in `tools/auftrag.ps1`.** Er hat den Ausbruch gemeldet:

```
[!] AUSSERHALB DES ARBEITSORTS HAT SICH ETWAS GEAENDERT:
    Neben dem Arbeitsort ist etwas entstanden: AUF-002_ausbruch.txt
```

Er ist die einzige Kontrolle, die in diesem Lauf funktioniert hat. Er misst vor und nach
dem Lauf: `git status`, die Nachbarschaft von `.wt/`, die Wahrheitsquellen und — über
`tools/blindbaum.py` — die Bäume, die `git status` nicht sieht.

**Der Worktree begrenzt, wohin *versehentlich* geschrieben wird. Er verhindert keinen
absichtlichen Ausbruch.**

## Warum die Liste trotzdem bleibt

Sie bremst das `Write`-Werkzeug, das ein Ausführender als Erstes greift. Das ist ein
Stolperdraht, keine Mauer — aber ein Stolperdraht mehr als nichts.

Sie darf nur **nie mit einer Grenze verwechselt werden**. Wer einem Ausführenden Material
anvertraut, dessen Verlust wehtut, braucht eine echte Sandbox (Container oder ein
Windows-Konto ohne Schreibrecht außerhalb des Arbeitsorts) — nicht diese Datei.

## Die Regel für jeden Auftrag

Was nicht angefasst werden soll, gehört **in den Auftragstext**, nicht nur in die
deny-Liste. Der Auftragstext erreicht den Ausführenden; die deny-Liste erreicht nur sein
`Write`-Werkzeug.
