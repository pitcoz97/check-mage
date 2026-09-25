# CREDITS

Provenienza e licenza di ogni asset incluso nel client.

## Font

| Asset | Uso | Provenienza | Licenza |
|---|---|---|---|
| Figtree (400, 500, 600, 700, 800) | Tutta l'interfaccia | [Google Fonts](https://fonts.google.com/specimen/Figtree), pacchetto npm `@fontsource/figtree` | SIL Open Font License 1.1 |
| Cinzel (600, 700, 800) | Titoli, nomi delle carte, numeri del mana | [Google Fonts](https://fonts.google.com/specimen/Cinzel), pacchetto npm `@fontsource/cinzel` | SIL Open Font License 1.1 |
| JetBrains Mono (500, 700) | Orologi | [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono), pacchetto npm `@fontsource/jetbrains-mono` | SIL Open Font License 1.1 |
| Noto Sans Symbols 2, **ritagliato** ai glifi ♚♛♜♝♞♟ | Pezzi degli scacchi | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+Symbols+2), pacchetto npm `@fontsource/noto-sans-symbols-2`; il ritaglio è `src/design/fonts/checkmage-pieces.woff2`, prodotto da `scripts/subset-pieces-font.ts` | SIL Open Font License 1.1, nessun Reserved Font Name; testo della licenza in `src/design/fonts/OFL.txt` |

I file dei font sono serviti dal bundle (self-hosted): nessuna richiesta a servizi terzi a runtime.

## Grafica

| Asset | Uso | Provenienza | Licenza |
|---|---|---|---|
| Set di pezzi degli scacchi | Scacchiera | Disegnato per questo progetto (`src/game/pieces/PieceIcon.tsx`), nessun set di terzi | Licenza del progetto (ancora da scegliere) |
| Icone degli effetti | Carte magia e badge sui pezzi | Disegnate per questo progetto (`src/spells/icons/EffectIcon.tsx`) | Licenza del progetto (ancora da scegliere) |
| Icona dell'app Android | Launcher | Il re del set di pezzi, riportato in un'icona adattiva (`android/app/src/main/res/drawable/ic_launcher_foreground.xml`) | Licenza del progetto (ancora da scegliere) |

Il progetto Android non contiene grafica di Capacitor: lo splash e l'icona del template (logo Capacitor) sono stati
rimossi. Lo splash è un colore pieno, l'icona è la nostra. Se un giorno servirà un logo vero e proprio, è quello il
punto da cambiare.

I pezzi sono tracciati SVG inline, colorati con i token di `src/design/tokens.css`: per sostituirli con un altro set
basta cambiare quel file, la scacchiera non cambia. Le icone degli effetti seguono la stessa regola e sono una per
**kind di effetto**, non per magia: una magia nuova con un effetto noto ha già la sua icona.
