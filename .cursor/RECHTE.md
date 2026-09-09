# Die Rechtedateien unter `.cursor/`

| Datei | was sie ist |
|---|---|
| `cli.aus.json` | Vorlage: nur lesen. Der Standardzustand. |
| `cli.an.json` | Vorlage: Arbeitsmodus. |
| `cli.json` | die wirksame Datei. `tools/cursor.ps1 -An` / `-Aus` kopiert eine Vorlage hierher. |

## ⛔ Diese Liste ist KEINE Grenze. Am 2026-09-09 gemessen.

`AUF-002` hat in diesem Projekt geprüft, ob `Write(**)` als einzige Write-Sperre trägt.
Ergebnis:

| | |
|---|---|
| **Das `Write`-Werkzeug** wurde blockiert | für **jeden** Pfad — auch für die in `allow` erlaubten Ergebnisverzeichnisse |
| **`Shell(python)` umging alles** | alle 12 Ziele wurden geschrieben: `src/`, `android/`, `tools/`, `.serena/`, `CLAUDE.md`, eine Datei ohne Endung, drei Ebenen tief — **und `../AUF-002_ausbruch.txt` außerhalb des Arbeitsorts** |

**Daraus folgt zweierlei:**

1. **Die Write-Sperren wirken nur gegen das `Write`-Werkzeug, nicht gegen die Shell.**
   Solange `Shell(python)` in `allow` steht — und ohne das kann ein Ausführender nichts
   messen —, ist jede Write-Sperre eine Absichtserklärung.
2. **`Write(**)` macht es schlimmer.** Es hindert den Ausführenden daran, mit seinem
   normalen Werkzeug in die *erlaubten* Verzeichnisse zu schreiben, und zwingt ihn damit
   auf den Python-Umweg, der gar keine Grenze kennt.

## Was tatsächlich hält

**Der Fingerabdruck.** `tools/auftrag.ps1` hat den Ausbruch gemeldet:

> `[!] AUSSERHALB DES ARBEITSORTS HAT SICH ETWAS GEAENDERT:`
> `    Neben dem Arbeitsort ist etwas entstanden: AUF-002_ausbruch.txt`

Er ist die einzige Kontrolle, die in diesem Lauf funktioniert hat. Der Worktree begrenzt,
wohin *versehentlich* geschrieben wird; er verhindert keinen absichtlichen Ausbruch.

## Warum die Liste trotzdem bleibt

Sie bremst das `Write`-Werkzeug, das ein Ausführender als Erstes greift. Das ist ein
Stolperdraht, keine Mauer — aber ein Stolperdraht mehr als nichts. Sie darf nur nie mit
einer Grenze verwechselt werden.
