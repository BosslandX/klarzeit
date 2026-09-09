# AUF-nnn — <Kurztitel>

> Vorlage. Kopieren nach `auftraege/AUF-nnn.md`, ausfüllen, **committen**
> (`tools/auftrag.ps1` bricht sonst in Vorprüfung 1 ab — ein nicht committeter Auftrag
> ist im Arbeitsort nicht vorhanden, und der Ausführende bekäme eine leere Anweisung).

## Auftrag

<Ein Satz: was soll erhoben werden. Kein „und ausserdem" — ein Auftrag, eine Sache.>

## Warum das gebraucht wird

<Ein bis drei Sätze. Ohne diesen Abschnitt liefert der Ausführende formal Richtiges,
das inhaltlich am Bedarf vorbeigeht.>

## Gegenstand

| | |
|---|---|
| Werk(e) | <Buch-ID / Aktenzeichen / Kursnummer — die Grundgesamtheit> |
| Stellen | <Kapitel, Kurseinheiten, Vorgänge — oder „alle", dann mit Anzahl> |
| Material im Arbeitsort | <welche Bäume kopiert wurden> |
| **Nicht** im Arbeitsort | <was fehlt und was daraus folgt> |

## Was zu tun ist

1. <Schritt>
2. <Schritt>
3. <Schritt>

## Was ausdrücklich NICHT zu tun ist

- <Sperre, mit Begründung>

## Erwartung des Auftraggebers

> **Vor dem Lauf ausfüllen, nicht danach.** Eine Erwartung, die nach dem Ergebnis
> geschrieben wird, kann nicht mehr widerlegt werden — und ein Auftrag, dessen Ergebnis
> immer passt, hat nichts gemessen.

<Was erwarte ich? Woran würde ich merken, dass die Erwartung falsch war?>

## Lieferung

`auftraege/_ergebnisse/AUF-nnn_lieferung.json`, gebildet gegen `tools/lieferschema.json`.

Pflicht je Befund: `aussage`, `achse`, `sicherheit`, `marker_vorschlag`,
`begruendung_marker`, `gegenstand`, mindestens ein Beleg.
`nicht_erreicht` ist Pflicht, auch wenn es leer bleibt.

### Achsen in diesem Auftrag

| Achse | wann | Beleg |
|---|---|---|
| `implementiert` | der Code steht | C1–C3 |
| `getestet` | ein Test fährt darüber und fällt ohne die Änderung um | L1–L3 |
| `gemessen` | eine Zahl liegt vor, mit beiden Kontrollen | C + L + `ablage` |

### Anker

Ein wörtliches Stück, das in der Zieldatei **genau einmal** vorkommt.
Stelle als `datei.ts:N`. Ein nacktes `:N` wird von der Abnahme abgewiesen.
Ein Testname taugt als Anker, wenn er im Repo eindeutig ist.

## Kontrollen, die der Auftrag verlangt

- [ ] Jede Nullaussage („kein", „nirgends", „0 Treffer") trägt eine **Positiv-Kontrolle**
      mit einem bekannten Treffer aus demselben Bereich.
- [ ] Jede Aussage mit einem Vollständigkeitswort trägt eine `grundgesamtheit` mit
      Anzahl, Befehl **und** Wurzel.
- [ ] Wo ein Werkzeug gefahren wurde: Positiv- und Negativkontrolle benannt.
- [ ] Bei Vorher/Nachher: derselbe Stand zweimal gemessen (Null-Diff).

## Abnahme

```
python -u tools/abnahme.py auftraege/_ergebnisse/AUF-nnn_lieferung.json
```

Danach liest der Auftraggeber **jeden** Anker selbst an der Quelle nach. Ein Agentenbericht
ist eine Hypothese, kein Beleg.
