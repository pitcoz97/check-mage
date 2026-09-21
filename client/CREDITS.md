# CREDITS

Provenienza e licenza di ogni asset incluso nel client.

## Font

| Asset | Uso | Provenienza | Licenza |
|---|---|---|---|
| Montserrat (400, 500, 600, 700) | Tutta la chrome dell'interfaccia | [Google Fonts](https://fonts.google.com/specimen/Montserrat), pacchetto npm `@fontsource/montserrat` | SIL Open Font License 1.1 |
| Cinzel (600) | Solo il nome della magia sulla carta | [Google Fonts](https://fonts.google.com/specimen/Cinzel), pacchetto npm `@fontsource/cinzel` | SIL Open Font License 1.1 |

I file dei font sono serviti dal bundle (self-hosted): nessuna richiesta a servizi terzi a runtime.

## Grafica

| Asset | Uso | Provenienza | Licenza |
|---|---|---|---|
| Set di pezzi degli scacchi | Scacchiera | Disegnato per questo progetto (`src/game/pieces/PieceIcon.tsx`), nessun set di terzi | Licenza del progetto (ancora da scegliere) |
| Icone degli effetti | Carte magia e badge sui pezzi | Disegnate per questo progetto (`src/spells/icons/EffectIcon.tsx`) | Licenza del progetto (ancora da scegliere) |

I pezzi sono tracciati SVG inline, colorati con i token di `src/design/tokens.css`: per sostituirli con un altro set
basta cambiare quel file, la scacchiera non cambia. Le icone degli effetti seguono la stessa regola e sono una per
**kind di effetto**, non per magia: una magia nuova con un effetto noto ha già la sua icona.
