# REDESIGN_PLAN

Analisi del design in `design-reference/` rispetto al client attuale (branch `feat/redesign`, partito da `main` a
`c9c4e22`). Le decisioni sui conflitti sono state prese il 2026-09-25 e sono nella **sezione 10**; il lavoro è diviso
negli step R1–R6 della sezione 9.

**Regola adottata:** l'HTML del design è la fonte di verità per colori, tipografia, spaziature e layout. Restano
validi i vincoli del progetto (CLAUDE.md, briefing): server autoritativo, nessuna informazione nascosta nel client,
colori solo in `src/design/tokens.css`, testi solo via i18n, nessun ramo per singola magia. Dove il design e questi
vincoli si scontrano, la sezione 7 lo dice e chiede una decisione.

**Come è stato letto il design.** `Design.html` è un bundle che si scompatta nel browser: dentro ci sono 7 tavole, ognuna
a sua volta un bundle con il proprio template, due componenti condivisi (Carta e Scacchiera, identici in tutte le
tavole) e i font. Li ho estratti e letti tutti; i valori delle sezioni 1 e 3 sono contati sul sorgente, non stimati. Il
tema della scacchiera effettivamente usato da ogni tavola l'ho verificato renderizzando il design nel browser.

---

## 0. Le tavole

| Tavola | Dimensioni | Contenuto | Tema scacchiera |
|---|---|---|---|
| Direzione visiva | 1440×900 | palette, tipografia, pulsanti, fasi, mana e orologi, stati della scacchiera, ventaglio di carte | arcano |
| Partita · desktop | 1440×900 | barra di navigazione, scacchiera 560, pannelli giocatori, colonna laterale, mano a ventaglio | **arcano** |
| Partita · Android | 390×844 | scacchiera a tutta larghezza, fasi + pulsante, suggerimento, mano, barra inferiore | **salvia** |
| Componente · Scacchiera | 560×560 | la scacchiera con tutti i suoi stati | salvia |
| Componente · Carta | 200×280 | la carta magia | — |
| Home · desktop | 1440×900 | barra laterale, partita in corso, "Gioca" con modalità e cadenza, mazzi, collezione, classifica, amici | arcano |
| Home · Android | 390×844 | intestazione, partita in corso, "Gioca", amici online, barra inferiore | arcano |

Il design non contiene: login e registrazione, profilo, coda di ricerca, fine partita, promozione, banner di
connessione, offerta di patta ricevuta, avvisi di rifiuto (sezione 6).

---

## 1. Valori del design

### 1.1 Palette

I 12 colori con nome sono quelli dichiarati nella tavola "Direzione visiva"; gli altri sono tutti quelli usati nei
template, raggruppati per ruolo, con il numero di occorrenze.

| Nome nel design | Hex | Ruolo |
|---|---|---|
| Notte | `#1B1A1F` | sfondo dell'app (×16) |
| Pietra | `#26242B` | pannelli, card della home, chip (×24) |
| Ardesia | `#37313F` | pulsante secondario, testata della carta, voce selezionata (×23) |
| Pergamena | `#EDE6D6` | orologio attivo, box del testo della carta |
| Oro arcano | `#D9A845` | mana, rarità rara, logo, colore del turno, badge scudo (×35) |
| Incanto | `#9B7BE0` | bersagli delle magie, fase corrente, selezione (×11) |
| Gioca | `#3A8230` | CTA primaria, orologio attivo, avatar proprio (×19) |
| Gelo | `#7FC8E0` | congelamento |
| Osso | `#E9DFC6` | casa chiara del tema salvia |
| Salvia | `#6F8A5E` | casa scura del tema salvia |
| Comune | `#8C8577` | rarità comune |
| Mitica | `#E0703E` | rarità mitica |

| Ruolo | Valori |
|---|---|
| Superfici più scure | `#141318` barre di navigazione · `#15131A` cornice della carta · `#1F1D24` campi, fasi future, controlli spenti · `#2B2731` interno carta · `#2F2B35` fasi passate, orologio inattivo · `#3A2F58` viola scuro (fase corrente, avatar avversario, selezione) |
| Bordi e divisori | `#2A2730` bordo delle barre di navigazione · `#2F2B35` anello dei controlli · `#37313F` · `#3D3945` cristallo di mana bloccato |
| Testo | `#EDE8DE` primario (×38) · `#A59E92` secondario (×68, il più usato) · `#BDB5A8` terziario · `#7F786E` quaternario · `#D6CFC2` riga del tipo sulla carta · `#FFFFFF` su verde · `#1B1710` su oro · `#2A241C` su pergamena |
| Oro | `#D9A845` · `#A57A26` bordo inferiore 3D · `#F2D38A` numeri del mana, icone sulle carte, voce attiva della barra Android |
| Viola | `#9B7BE0` · `#B9A2F0` testo e icone "magia" · `#D8C6FF` testo su viola scuro |
| Verde | `#3A8230` · `#265A1E` bordo inferiore 3D · `#7FBF6A` "tocca a te", online, delta ELO positivo |
| Sfondi dell'arte delle carte | salto `#3B3556` · gelo `#24485A` · scudo `#4A3C22` · annullamento `#3A2F58` · fulmine `#5A2E24` |
| Icone sulle carte | `#F2D38A` salto e scudo · `#BFE6F3` gelo · `#D8C6FF` annullamento · `#FFD9A0` fulmine |
| Classifica | 1° `#F2D38A` · 2° `#D6CFC2` · 3° `#E0A07E` |
| Pezzi | bianco `#FBF8F0` con contorno `#1A1714`; nero `#1F1B17` con bordo `rgba(245,239,226,.55/.35)` |
| Trasparenze | oro `rgba(217,168,69, .10 / .55 / .6 / .7)` · viola `rgba(155,123,224, .12 / .14 / .18 / .6 / .7 / .8 / .9 / .95)` · verde `rgba(58,130,48,.18)` · righe alterne `rgba(255,255,255,.025)` · bordo del campione `rgba(255,255,255,.08)` |

### 1.2 Scacchiera

| Tema | Casa chiara | Casa scura |
|---|---|---|
| salvia | `#E9DFC6` | `#6F8A5E` |
| noce | `#EADBC0` | `#9A6F4C` |
| arcano | `#DCD5E8` | `#5E5578` |

| Stato | Resa grafica |
|---|---|
| Ultima mossa | velo `rgba(246,214,72,.45)` su tutta la casa |
| Congelato | velo `rgba(127,200,224,.5)` + anello interno 2px `rgba(214,240,250,.9)` + fiocco (stroke `#0F3E52`) in alto a destra |
| Protetto | anello interno 3px `#D9A845` rientrato di 3px, raggio 4px, alone `0 0 14px rgba(217,168,69,.6)` + scudo pieno (`#D9A845`, stroke `#5A3F0E`) in alto a destra |
| Bersaglio di magia, casa vuota | punto viola 30% `rgba(155,123,224,.9)` con alone `0 0 10px rgba(155,123,224,.8)` |
| Bersaglio di magia, casa occupata | anello interno 4px `rgba(155,123,224,.95)` + velo `rgba(155,123,224,.18)` |
| Coordinate | numeri sulla colonna *a* (in alto a sinistra, 4px/2px), lettere sulla traversa *1* (in basso a destra, 4px/1px); 700, `max(9px, 19% della casa)`, colore della casa opposta |
| Pezzi | glifi Unicode pieni ♚♛♜♝♞♟ in *Noto Sans Symbols 2*, 80% della casa, alzati del 4% |
| Badge | `max(12px, 26% della casa)`, a 3px dall'angolo |
| Contenitore | raggio 6px, ombra `0 12px 32px rgba(0,0,0,.45)` |

### 1.3 Tipografia

| Famiglia | Pesi usati | Uso |
|---|---|---|
| **Figtree** | 400, 500, 600, 700, 800 | tutta l'interfaccia |
| **Cinzel** | 600, 700, 800 | titoli, logo, nomi delle carte, titoli di sezione, numeri del mana e della collezione |
| **JetBrains Mono** | 500, 700 | orologi, cadenze, punteggi ELO in classifica, codici colore |
| **Noto Sans Symbols 2** | 400 | solo i pezzi degli scacchi |

Scala delle dimensioni (occorrenze): **12** ×33 · **13** ×28 · **14** ×26 · **15** ×17 · **11** ×14 · **16** ×12 · 18
×5 · 20 ×5 · 22 ×5 · 24 ×3 · 19 ×2 · e una volta sola 10.5, 11.5, 17, 21, 26, 28, 30, 32, 34, 36, 46.

| Stile ricorrente | Valori |
|---|---|
| Titolo principale | Cinzel 800, 46 (logo) · 36 ("Gioca") · 32 ("Bentornato") · 28/22 su Android |
| Titolo di pannello | Cinzel 700, 20 · 18 per le card della home |
| Etichetta di sezione | Figtree 800, 12, maiuscolo, spaziatura 0.1–0.12em, `#A59E92` |
| Testo | Figtree 13–15, 600/700 per i nomi, `#A59E92` per le righe secondarie |
| Pulsanti | Figtree 800 (primari: 18–24) · 700 (secondari: 14–15) |
| Orologio | JetBrains Mono 700, 22 desktop · 20 Android |
| Nome carta | Cinzel 700, 13, spaziatura 0.02em |
| Testo carta | Figtree 500, 12, interlinea 1.35 |

Pesi: 700 ×81, 800 ×43, 600 ×22, 500 ×3. Spaziatura lettere: 0.12em, 0.1em, 0.08em (etichette maiuscole), 0.02–0.03em
(Cinzel). Interlinea: 1 (titoli), 1.35 (carta), 1.4 (testo), 1.5 (paragrafi).

### 1.4 Spaziature

Scala dei `gap`: **4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 24 · 28 · 32 · 40** (più 1, 2, 3, 5 all'interno dei
componenti). I più usati sono 8, 10, 12 e 6.

Padding ricorrenti: pannelli 16 / 18 / 28 (home), 14×16 (mana), 12×14 (suggerimento); controlli `0 14px`, `0 10px`,
`0 12px`, `0 16px`; chip `4px 10px` / `6px 12px`; pagina 48×56 (direzione visiva).

### 1.5 Raggi

| Raggio | Uso |
|---|---|
| 999px | chip e badge a pillola |
| 16px | card della home |
| 14px | logo grande, card della partita in corso su Android |
| 12px | pannelli della partita, carta (esterno), riquadro utente |
| 10px | **pulsanti** (il più usato, ×37), voci di navigazione, logo piccolo |
| 9px / 7px | carta in mano (desktop / Android), fasi su Android |
| 8px | fasi, chip, avatar, interno della carta, campioni di colore |
| 6px | scacchiera, orologi |
| 4px | anello dello scudo, legenda degli stati |
| 3px / 2px | cristalli di mana |
| 50% | pallini, moneta del costo |

### 1.6 Ombre ed elevazione

Il linguaggio è piatto: nessuna ombra sui pannelli. La profondità arriva da tre soli elementi.

| Tipo | Valori |
|---|---|
| **Pulsante "3D"** (bordo inferiore interno più scuro) | primario `inset 0 -4px 0 #265A1E` (−3 su Android, −5 per il CTA grande) · oro `inset 0 -3px 0 #A57A26` (−4 per il logo) · secondario `inset 0 -3px 0 #26222C` |
| **Anelli** (stato, non decorazione) | selezione/corrente `inset 0 0 0 2px #9B7BE0` · orologio attivo `0 0 0 2px #3A8230` · controllo spento `inset 0 0 0 1px #2F2B35` / `#37313F` · mazzo attivo `inset 0 0 0 1.5px #D9A845` |
| **Aloni e rilievi** | carta selezionata `0 0 0 3px #9B7BE0, 0 0 28px rgba(155,123,224,.7)` (2.5px / 22px su Android) · mana acceso `0 0 10px rgba(217,168,69,.55), inset 0 -2px 0 #A57A26` · carta `0 10px 24px rgba(0,0,0,.45)` · scacchiera `0 12px 32px rgba(0,0,0,.45)` |

### 1.7 Misure ricorrenti

| Elemento | Misure |
|---|---|
| Controlli | altezze 32 · 34 · 36 · 40 · 44 · 48 · 56 · 60 · 64 · 68 (CTA grande) |
| Avatar | 40 (desktop), 36 (Android e liste), raggio 8, iniziale in 800 |
| Navigazione | barra verticale 72 (partita) · barra laterale 220 (home) · barra inferiore 64 (partita Android) / 76 (home Android) |
| Scacchiera | 560 (partita desktop) · 390 (Android, a tutta larghezza) · 376 / 80 (miniature della home) |
| Carta | 200×280 nominale; in mano ×0.68 = 136×190 (desktop), ×0.5 = 100×140 (Android) |
| Colonna laterale | 380 (partita desktop) |
| Cristalli di mana | 16 (pannello), 12 (legenda), 10/8 (chip), ruotati di 45° |

### 1.8 Confronto con `src/design/tokens.css`

Il design **sostituisce** l'intera palette attuale (linguaggio chess.com, marrone-grigio caldo) con una notte fredda,
oro e viola. Quasi nessun valore si conserva.

| Token attuale | Valore attuale | Nel design |
|---|---|---|
| `--bg-app` | `#302e2b` | `#1B1A1F` Notte |
| `--bg-panel` | `#262421` | `#26242B` Pietra (e `#141318` per le barre di navigazione) |
| `--bg-elevated` | `#3a3835` | `#37313F` Ardesia |
| `--border-subtle` | `#4a4844` | `#2A2730` / `#2F2B35` / `#37313F` secondo il contesto |
| `--board-light` / `--board-dark` | `#eeeed2` / `#769656` | per tema: arcano `#DCD5E8`/`#5E5578` (oppure salvia, sezione 7) |
| `--board-hint` | verde `rgba(20,85,30,.5)` | non disegnato per le mosse; viola per le magie |
| `--board-last` | `rgba(255,255,51,.5)` | `rgba(246,214,72,.45)` |
| `--board-check` | `#e02b2b` | non disegnato |
| `--piece-light` / `-dark` / `-edge` | `#f7f6f2` / `#2b2926` / `#16150f` | `#FBF8F0` / `#1F1B17` / `#1A1714` |
| `--accent` / `--accent-hover` | `#81b64c` / `#a3d160` | `#3A8230` (CTA) + `#265A1E`; l'accento dell'interfaccia diventa l'oro `#D9A845` |
| `--text-primary` / `--text-muted` | `#ffffff` / `#b8b8b8` | `#EDE8DE` / `#A59E92` (+ `#BDB5A8`, `#7F786E`) |
| `--danger` | `#ca3431` | non disegnato |
| `--mana-full` / `--mana-empty` | blu `#3aa0e8` / `#1e3a52` | **oro** `#D9A845` (acceso) · contorno oro (speso) · `#3D3945` (bloccato) |
| `--spell-frame` | `#c9a227` | cornice per rarità: `#8C8577` / `#D9A845` / `#E0703E` |
| `--effect-freeze` / `-shield` / `-doom` | `#7fd8f7` / `#f0d264` / `#b5479b` | `#7FC8E0` / `#D9A845` / fulmine `#FFD9A0` su `#5A2E24` |
| `--font-ui` | Montserrat | **Figtree** |
| `--font-spell-name` | Cinzel, solo nomi magia | Cinzel **anche** per titoli e numeri |
| — | — | nuovo `--font-mono`: JetBrains Mono; nuovo `--font-pieces`: Noto Sans Symbols 2 |
| `--radius-chip` / `--radius-control` | 4 / 8 | 8 / 10 (+ 6, 12, 16, 999) |
| `--hit-target` | 44 | invariato: il design usa 44+ per i controlli toccabili, salvo le fasi (32–34) che non sono pulsanti |

---

## 2. Mappatura design ↔ codice

| Elemento del design | File esistenti | Note |
|---|---|---|
| Palette, tipografia, raggi, ombre | `src/design/tokens.css`, `src/design/theme.css`, `src/design/global.css`, `src/design/fonts.ts` | da riscrivere; `theme.css` va esteso (mono, pezzi, nuovi raggi) |
| Pulsanti (primario verde, secondario ardesia, oro) | `src/design/components/Button.tsx` | varianti da rifare con il bordo inferiore 3D; manca la variante oro |
| Pannelli | `src/design/components/Panel.tsx` | raggio 12/16, senza bordo |
| Barra di navigazione desktop (72 in partita, 220 in home) | `src/app/AppShell.tsx` | oggi è una testata orizzontale; la partita non ha navigazione (`MatchLayout.tsx`) |
| Barra inferiore Android (home) | `src/app/AppShell.tsx` | da creare |
| Controllo lingua a pulsanti | `src/i18n/LanguageSwitch.tsx` | oggi è un `<select>` |
| Home · desktop / Android | `src/screens/Lobby/Lobby.tsx`, `src/app/router.tsx` | la lobby attuale è una colonna centrata |
| Card "Partita in corso" | `src/screens/Lobby/Lobby.tsx` (`useSavedMatch`), `src/store/matchSession.ts` (`hasSavedMatch`) | oggi è un pannello con testo e "Riprendi" |
| Partita · layout desktop e Android | `src/screens/Match/MatchLayout.tsx`, `src/screens/Match/Match.tsx` | griglia e posizioni da rifare |
| Pannelli giocatore (avatar, nome, ELO, chip mano e mana, orologio) | `src/screens/Match/PlayerPanel.tsx`, `src/screens/Match/useClock.ts`, `src/game/clock.ts` | struttura simile, resa diversa |
| Pannello "Turno N · Tocca a te" + fasi | `src/screens/Match/PhaseTrack.tsx` | oggi è una riga di testo; nel design sono pillole con stati |
| Box del suggerimento | `src/screens/Match/Match.tsx` (`TargetingBar`, `useNotice`), `src/screens/Match/useCasting.ts` | oggi due elementi separati: barra di targeting e avviso |
| Pannello del mana | `src/game/mana/ManaBar.tsx`, `src/screens/Match/PlayerPanel.tsx` | oggi i cristalli stanno nel pannello giocatore |
| Schede Mosse / Grimorio / Chat, storico | `src/screens/Match/MoveHistory.tsx` | oggi solo lo storico, in UCI |
| CTA "Passa alla fase …", Patta, Abbandona | `src/screens/Match/Actions.tsx` | stesso contenuto, disposizione e testi diversi |
| Scacchiera | `src/game/board/Board.tsx`, `src/game/board/selection.ts`, `src/game/position.ts` | struttura compatibile (griglia di `button`), resa da rifare |
| Pezzi | `src/game/pieces/PieceIcon.tsx` | oggi SVG originali; il design usa glifi (sezione 7) |
| Stati sulla scacchiera | `src/game/board/Board.tsx`, `src/spells/effects.registry.tsx` (`StateBadge`) | badge da spostare in alto a destra, velo sulla casa |
| Carta magia | `src/game/hand/SpellCard.tsx`, `src/spells/effects.registry.tsx`, `src/spells/icons/EffectIcon.tsx` | struttura diversa (testata, arte, riga del tipo, box di testo) |
| Mano a ventaglio | `src/game/hand/Hand.tsx` | oggi è una riga scorrevole |
| Miniatura della scacchiera (home) | `src/game/board/Board.tsx` | serve una variante non interattiva |
| Testi (it/en) | `src/i18n/locales/it.ts`, `src/i18n/locales/en.ts` | il design porta già i testi nelle due lingue |
| Colori nativi | `capacitor.config.ts`, `android/app/src/main/res/values/colors.xml`, `.../ic_launcher_background.xml` | sfondo `#302e2b` → `#1B1A1F`; l'icona può passare all'oro del logo |
| Galleria di sviluppo | `src/screens/Dev/CardGallery.tsx` | non è nel design; segue la nuova carta da sé |

---

## 3. Differenze solo visive

Differenze che non cambiano dati, stati o flussi: si risolvono in CSS, markup e token.

### 3.1 Fondamenta
- **Palette e font** (sezione 1.8). File: `src/design/tokens.css`, `src/design/theme.css`, `src/design/fonts.ts`,
  `package.json` (fontsource: `@fontsource/figtree`, `@fontsource/jetbrains-mono`, `@fontsource/noto-sans-symbols-2`;
  via `@fontsource/montserrat`), `CREDITS.md` (tutte licenze SIL OFL 1.1).
- **Pulsanti** con bordo inferiore 3D, raggio 10, pesi 700/800; altezze 60 (primario) e 44–48 (secondari). File:
  `src/design/components/Button.tsx`.
- **Pannelli** piatti, `#26242B`, raggio 12 (partita) e 16 (home), senza bordo. File: `src/design/components/Panel.tsx`.
- **Campi di testo** e spinner da riallineare alla palette (non disegnati). File:
  `src/design/components/TextField.tsx`, `src/design/components/Spinner.tsx`.

### 3.2 Scacchiera
- Colori per tema, raggio 6 e ombra del contenitore. File: `src/game/board/Board.tsx`, `src/design/tokens.css`.
- Ultima mossa come velo giallo più caldo. File: `src/game/board/Board.tsx`.
- **Congelato**: velo celeste su tutta la casa + fiocco in alto a destra; **protetto**: anello d'oro rientrato con
  alone + scudo pieno in alto a destra. Oggi: icona piccola e numero dei turni in alto a sinistra. File:
  `src/game/board/Board.tsx`, `src/spells/effects.registry.tsx`.
- Bersagli delle magie viola: punto sulle case vuote, anello sulle occupate. Oggi: contorno dorato (`outline-spell-frame`).
  File: `src/game/board/Board.tsx`.
- Coordinate dentro le case (numeri sulla colonna *a*, lettere sulla traversa *1*). Oggi assenti. File:
  `src/game/board/Board.tsx`.
- Pezzi all'80% della casa invece dell'88%, colori e contorni del design. File: `src/game/pieces/PieceIcon.tsx`
  (o sostituzione, sezione 7).

### 3.3 Carta
- Cornice esterna `#15131A` 6px con bordo 2px del colore della rarità, raggio 12, ombra; interno `#2B2731` raggio 8.
- Testata 32px `#37313F`: nome Cinzel 700 13 a sinistra, **moneta del costo** oro 24px a destra (oggi il costo è
  un'etichetta con cristallo in alto a sinistra).
- **Area arte** 100px con fondo per tipo di effetto, cerchio decorativo e icona di 52px a tratto (le nostre icone sono
  piene: vanno ridisegnate a tratto, 1.8px, nello stile del design).
- Riga del tipo 22px in maiuscolo con rombo della rarità.
- Testo di regole su **pergamena** `#EDE6D6`, `#2A241C`, Figtree 500 12/1.35.
- Misure: 200×280 nominale, 136×190 in mano su desktop, 100×140 su Android (oggi 128×160).

File: `src/game/hand/SpellCard.tsx`, `src/spells/effects.registry.tsx` (fondo e colore dell'arte per kind),
`src/spells/icons/EffectIcon.tsx`, `src/design/tokens.css`.

### 3.4 Partita
- **Pannelli giocatore** su una riga di 48px sopra e sotto la scacchiera: avatar quadrato 40 colorato (verde per sé,
  viola per l'avversario), nome 15/700 con ELO tra parentesi, riga secondaria 12, chip per carte in mano e mana,
  orologio 112×40. File: `src/screens/Match/PlayerPanel.tsx`.
- **Orologio**: attivo su pergamena con anello verde e icona, inattivo `#2F2B35` spento; JetBrains Mono. File:
  `src/screens/Match/PlayerPanel.tsx`.
- **Fasi**: quattro pillole da 34px con tre stati (passata con spunta, corrente viola con anello, futura spenta).
  File: `src/screens/Match/PhaseTrack.tsx`.
- **Mana**: pannello dedicato con "4 / 8" in Cinzel oro e dieci rombi. File: `src/game/mana/ManaBar.tsx`.
- **Storico**: righe da 30px alternate, numero spento, mossa corrente con velo oro. File:
  `src/screens/Match/MoveHistory.tsx`.
- **Azioni**: CTA verde 60px con freccia; Patta e Abbandona secondari affiancati. File: `src/screens/Match/Actions.tsx`.
- **Layout desktop**: barra 72 · scacchiera 560 a x=264 · colonna 380 a x=1040 · mano sotto la scacchiera. Layout
  Android: pannelli sopra e sotto, fasi e pulsante su una riga, suggerimento, mano, barra inferiore. File:
  `src/screens/Match/MatchLayout.tsx`.

### 3.5 Home e shell
- Barra laterale 220 (desktop) con logo, voci da 48px, controllo lingua e riquadro utente; barra inferiore 76 (Android).
  File: `src/app/AppShell.tsx`, `src/i18n/LanguageSwitch.tsx`.
- Card "Gioca" con titolo Cinzel 36, tagline e CTA grande 68px. File: `src/screens/Lobby/Lobby.tsx`.

---

## 4. Funzionalità presenti nel design e assenti nel codice

Per ognuna: cosa serve e **da dove possono arrivare i dati**. "Solo client" vuol dire che il protocollo attuale basta.

| # | Funzionalità | Dove nel design | Dati | File coinvolti |
|---|---|---|---|---|
| F1 | **Coordinate** sulla scacchiera | scacchiera | solo client | `src/game/board/Board.tsx` |
| F2 | **Temi della scacchiera** salvia / noce / arcano | scacchiera (prop `theme`) | solo client, preferenza in `storage.ts` | `src/game/board/Board.tsx`, `src/design/tokens.css`, `src/lib/storage.ts`, una schermata Impostazioni (F18) |
| F3 | **Mano a ventaglio** con carta selezionata sollevata e alone | partita | solo client | `src/game/hand/Hand.tsx` |
| F4 | **Box del suggerimento contestuale**: fase + cosa fare, istruzione di targeting, pezzi propri congelati ("Il tuo Cc3 è congelato") | partita | solo client (fase, `activeEffects`, targeting) | `src/screens/Match/Match.tsx`, `src/screens/Match/useCasting.ts`, `src/i18n/locales/*` |
| F5 | **CTA con etichetta della fase successiva** ("Passa alla fase Mossa") | partita | solo client | `src/screens/Match/Actions.tsx` |
| F6 | **"Turno N"** e **pillola del colore** | partita | solo client (numero dalla FEN, colore dal `game_state`) | `src/screens/Match/PhaseTrack.tsx` |
| F7 | **Mana su 10 rombi con tre stati** (acceso, speso, bloccato) e nota "+1 per turno · max 10" | partita | corrente e massimo ci sono; **il tetto 10 non è nel protocollo** | `src/game/mana/ManaBar.tsx`; `docs/ASSUMPTIONS.md` o `docs/BACKEND-REQUESTS.md` |
| F8 | **Magie nello storico** ("Scudo Runico → e4 · Tu") | partita | dagli eventi `spell_cast` della sessione; **perse alla riconnessione** (il server non manda lo storico delle magie) | `src/store/matchStore.ts`, `src/screens/Match/MoveHistory.tsx`, `docs/BACKEND-REQUESTS.md` |
| F9 | **Storico in notazione algebrica** con lettere italiane (C, A, T, D, R) | partita | vedi sezione 7 (B7) | `src/screens/Match/MoveHistory.tsx`, `src/game/position.ts` |
| F10 | **Navigazione fra le posizioni** (mossa precedente/successiva) | partita Android | **non ricostruibile**: le magie cambiano la scacchiera fuori dalle mosse e il server non manda le posizioni intermedie | `src/screens/Match/*`; `docs/BACKEND-REQUESTS.md` |
| F11 | **Schede Grimorio e Chat** | partita | Grimorio: il contenuto non è disegnato, e il mazzo non è noto al client (informazione nascosta); Chat: fuori scope v1 | `src/screens/Match/MoveHistory.tsx` |
| F12 | **Nome del mazzo** del giocatore ("Mazzo · Rune d'Oro · 18 nel grimorio") | partita, home | il numero di carte nel mazzo sì (`myDeckSize`), **il nome no**: il server ha un solo mazzo condiviso | `src/screens/Match/PlayerPanel.tsx` |
| F13 | **Rarità, riga del tipo, categoria dell'arte** sulle carte | carta | **non nel catalogo** (`GET /spells`): servono campi nuovi (estensione di P2-15) | `src/spells/schema.ts`, `src/api/adapter.ts`, `src/game/hand/SpellCard.tsx`, `docs/BACKEND-REQUESTS.md` |
| F14 | **Card "Partita in corso"** con avversario, "tocca a te", orologio e miniatura live | home | disponibile solo se la sessione è connessa; dopo un riavvio c'è solo il flag locale (C11): per il resto serve P2-13 | `src/screens/Lobby/Lobby.tsx`, `src/store/matchSession.ts`, `src/game/board/Board.tsx` |
| F15 | **Modalità** (classificata, amichevole, bot) e **cadenza** (3+2, 5+0, 10+0, 15+10) | home | **coda unica 10+5 sul server** (P2-1 aperta) | `src/screens/Lobby/Lobby.tsx`, `src/store/matchSession.ts`, `src/ws/connection.ts` |
| F16 | **Classifica** (stagione, top 3, propria posizione) | home, navigazione | `GET /leaderboard` esiste (top 10); **stagione e posizione propria no** | `src/api/endpoints.ts`, `src/api/adapter.ts` (`normalizeLeaderboard` c'è già), nuova schermata |
| F17 | **Delta ELO** ("▲ 18") | home | non esposto dal server | `docs/BACKEND-REQUESTS.md` |
| F18 | **Impostazioni** | navigazione | nessuna schermata oggi; potrebbe ospitare tema della scacchiera (F2) e lingua | nuova schermata, `src/app/router.tsx` |
| F19 | **Mazzi, collezione, amici, notifiche, "Sfida"** | home, navigazione | **nessun supporto nel server**, e mazzi/deckbuilding sono fuori scope v1 nel briefing | — |
| F20 | **Carta "Dissolvi"** (reazione che annulla una magia) | carte d'esempio | non esiste nel catalogo né nel motore del server | — |

---

## 5. Differenze di flusso o comportamento

| # | Differenza | Oggi | Nel design | File coinvolti |
|---|---|---|---|---|
| B1 | **Uscire dalla partita e tornarci** | la lobby rimanda subito a `/match` se c'è una partita in corso (`Lobby.tsx`, `useEffect` su `lifecycle`); la partita non ha navigazione | la barra di navigazione resta visibile in partita e la home mostra "Partita in corso · Riprendi" | `src/screens/Lobby/Lobby.tsx`, `src/screens/Match/MatchLayout.tsx`, `src/app/router.tsx`, `src/app/AppShell.tsx` |
| B2 | **Annullare il targeting** | pulsante "Annulla", `Esc`, tap fuori dai bersagli | nessun pulsante: si tocca di nuovo la carta selezionata | `src/screens/Match/useCasting.ts`, `src/game/hand/Hand.tsx`, `src/screens/Match/Match.tsx` |
| B3 | **Carta non giocabile** | visibile, disabilitata, con il motivo scritto sulla carta, senza opacità (contrasto AA) | opacità 0.55; il motivo solo nell'etichetta accessibile ("mana insufficiente") | `src/game/hand/SpellCard.tsx` — sezione 7 |
| B4 | **Nome carta lungo** | va a capo, mai troncato (briefing §5.1.7) | troncato con i puntini | `src/game/hand/SpellCard.tsx` — sezione 7 |
| B5 | **Turni residui degli effetti** | numero accanto al badge | nessun numero | `src/game/board/Board.tsx` — togliendolo sparisce anche un valore che può essere vecchio (C13) |
| B6 | **Suggerimenti di mossa** e casa selezionata | punto e anello verdi, contorno giallo | non disegnati: "nessun effetto finché non c'è una magia in gioco" | `src/game/board/Board.tsx` — sezione 7 |
| B7 | **Scacco** | casa del re in rosso | non disegnato | `src/game/board/Board.tsx` |
| B8 | **Patta e resa su Android** | nella sezione azioni, sotto la scacchiera | dietro il pulsante "Menu" della barra inferiore | `src/screens/Match/MatchLayout.tsx`, `src/screens/Match/Actions.tsx` |
| B9 | **Storico su Android** | `<details>` "Mostra storico mosse" | nessuna lista: frecce mossa precedente/successiva (F10) | `src/screens/Match/MatchLayout.tsx`, `src/screens/Match/MoveHistory.tsx` |
| B10 | **Avvisi** (rifiuti del server, magie lanciate, patta rifiutata) | striscia sopra la partita (`useNotice`) | nessuna striscia: il box del suggerimento è l'unico spazio per i messaggi | `src/screens/Match/Match.tsx` |
| B11 | **Lingua** | `<select>` nella testata e nel login | pulsanti Italiano/English nella barra laterale, IT/EN nell'intestazione Android | `src/i18n/LanguageSwitch.tsx`, `src/app/AppShell.tsx`, `src/app/AuthLayout.tsx` |
| B12 | **Esci** | pulsante nella testata | assente in tutte le tavole | `src/app/AppShell.tsx` — sezione 7 |
| B13 | **Profilo** | voce "Profilo" nella navigazione, schermata `/profile` | solo il riquadro utente in fondo alla barra (link non definito) | `src/app/AppShell.tsx`, `src/screens/Profile/Profile.tsx` |
| B14 | **Orologio in esaurimento** | rosso sotto il minuto | non disegnato | `src/screens/Match/PlayerPanel.tsx`, `src/game/clock.ts` |
| B15 | **Posizione della mano su desktop** | fila sotto il pannello del giocatore | ventaglio sovrapposto al bordo inferiore dello schermo, sotto la scacchiera | `src/screens/Match/MatchLayout.tsx`, `src/game/hand/Hand.tsx` |

---

## 6. Parti del codice senza controparte nel design

Vanno disegnate estendendo il linguaggio del design (palette, pannelli, pulsanti), oppure decise insieme.

| Parte | File |
|---|---|
| Login e registrazione (con requisiti della password) | `src/app/AuthLayout.tsx`, `src/screens/Auth/Login.tsx`, `src/screens/Auth/Register.tsx` |
| Verifica della sessione, server irraggiungibile, 404 | `src/app/guards.tsx`, `src/app/errors.tsx` |
| Coda di ricerca con Annulla, ricerca continuata in un'altra scheda | `src/screens/Lobby/Lobby.tsx` |
| Profilo con statistiche | `src/screens/Profile/Profile.tsx` |
| Attesa della schermata di partita | `src/app/MatchFallback.tsx` |
| Banner di connessione (riconnessione con countdown, 4001 "Riprendi qui", sessione scaduta) | `src/screens/Match/ConnectionBanner.tsx` |
| Offerta di patta ricevuta (Accetta/Rifiuta), avversario disconnesso | `src/screens/Match/Actions.tsx`, `src/screens/Match/PlayerPanel.tsx` |
| Conferma della resa | `src/screens/Match/Actions.tsx` |
| Scelta della promozione | `src/game/board/PromotionDialog.tsx` |
| Fine partita (esito, motivo, ritorno) | `src/screens/Match/Match.tsx` (`OutcomePanel`) |
| Lampeggio delle case alla risoluzione di una magia | `src/design/global.css`, `src/screens/Match/Match.tsx` |
| Etichette CTA per le fasi diverse da main1 (move, main2, turno avversario) | `src/screens/Match/Actions.tsx` |
| Icone per pesca, mana, nessun effetto, effetto ignoto (il design ha solo salto, gelo, scudo, annullamento, fulmine) | `src/spells/icons/EffectIcon.tsx` |

---

## 7. Conflitti e decisioni da prendere

> **Chiusa.** Le risposte, insieme a quelle sulle altre voci delle sezioni 4 e 5, sono nella sezione 10.

1. **Tema della scacchiera.** Cinque tavole usano *arcano*, la partita Android e il componente isolato *salvia* (verificato
   renderizzando il design). Quale è quello di default? E i tre temi vanno offerti all'utente (F2)?
2. **Pezzi.** Il design usa i glifi Unicode in *Noto Sans Symbols 2*; allo Step 4 abbiamo scelto SVG originali. Adottare
   i glifi è la resa più fedele ma aggiunge il font dei simboli (il sottoinsieme che contiene gli scacchi pesa ~380 KB,
   a meno di ritagliarlo) e la resa varia un po' fra piattaforme. L'alternativa è ridisegnare i nostri SVG sulle
   sagome e sui colori del design.
3. **Carta non giocabile (B3).** Il briefing §7.5 vuole il motivo leggibile sulla carta, e l'opacità 0.55 rende il
   testo sotto il contrasto AA. Proposta: tenere l'aspetto spento del design ma scrivere il motivo (per esempio al posto
   della riga del tipo), e scurire invece che rendere trasparente.
4. **Nome troncato (B4).** Il briefing §5.1.7 vieta i troncamenti silenziosi. Con i nomi attuali del catalogo il
   problema non c'è; va deciso cosa fare con quelli lunghi (due righe o testo più piccolo).
5. **Suggerimenti di mossa e scacco (B6, B7).** Non disegnati. Il briefing §7.5 chiede le mosse legali evidenziate al
   pickup. Proposta: tenerli, ridisegnati nel linguaggio del design ma distinti dal viola delle magie.
6. **Notazione (F9).** La SAN con lettere italiane è quello che il design mostra. Si può calcolare mossa per mossa dalla
   posizione precedente (la sessione le vede tutte), ma dopo una riconnessione o per le partite vecchie resta solo
   l'UCI (B7). Accettiamo la mescolanza, o chiediamo al server la SAN?
7. **Funzionalità senza backend (F15–F19).** Modalità, cadenze, mazzi, collezione, amici, notifiche, delta ELO: il
   design le mostra, il server non le ha e alcune sono fuori scope v1. Proposta: le voci di navigazione e le card
   restano **fuori** finché non esiste il dato (niente placeholder che non fanno nulla); la **classifica** invece si
   può fare subito con `GET /leaderboard`.
8. **Dati mancanti sulle carte (F13).** Rarità, tipo e categoria dell'arte non vanno inventati nel client (niente dati
   per singola magia). Proposta: estendere P2-15 con `rarity` e `type`; nel frattempo la carta usa la rarità comune e
   deriva l'arte dal kind del primo effetto.
9. **Tetto del mana (F7).** Mostrare dieci rombi vuol dire sapere che il massimo è 10: nel protocollo non c'è.
   Proposta: voce in ASSUMPTIONS e richiesta al server (`max_mana_cap` in `game_state`).
10. **Esci (B12).** Il design non ha un logout. Dove lo mettiamo: riquadro utente, Impostazioni o profilo?
11. **Contrasto.** Il testo delle fasi future (`#7F786E` su `#1F1D24`) sta a 3.8:1, sotto l'AA per un testo di 13px.
    Proposta: schiarirlo quanto basta (resto fedele al design in tutto il resto).
12. **Navigazione durante la partita (B1).** Se la barra resta attiva in partita, bisogna decidere cosa succede
    andando in home: la partita continua in background (il socket resta aperto e la home mostra "Riprendi"), che è
    quello che il design suggerisce.

---

## 8. Impatto su test, Android e bundle

- **Test** che dipendono da testi o classi che il redesign cambia: il pulsante "Passa fase"
  (`src/screens/Match/Match.test.tsx`, `tests/match-ui.test.tsx`), il titolo "Pronto a giocare?" della lobby
  (`src/app/router.test.tsx`, `src/app/auth-routes.test.tsx`), i numeri dei turni sul badge
  (`src/game/board/Board.test.tsx`, `data-effects`), la classe `var(--board-check)` dello scacco
  (`Board.test.tsx`), "Bersaglio per …" della barra di targeting (`Match.test.tsx`). Vanno aggiornati insieme al
  componente, non dopo. `tests/no-hardcoded-colors.test.ts` resta il guardiano: ogni colore nuovo passa da `tokens.css`.
- **Android:** sfondo nativo e splash da `#302e2b` a `#1B1A1F` (`capacitor.config.ts`, `colors.xml`); l'icona può
  prendere l'oro e il simbolo del logo del design (`ic_launcher_background.xml`, `ic_launcher_foreground.xml`). Dopo
  ogni cambiamento, `npm run android:sync`.
- **Bundle:** Figtree e JetBrains Mono sostituiscono Montserrat a costo simile; il font dei simboli per i pezzi è il
  solo peso nuovo rilevante (decisione 2). Oggi: 519 kB iniziali.

---

## 9. Step

Ogni step è a sé: piano breve → implementazione → verifica (test verdi e screenshot affiancati al design a 1440×900 e
390×844) → stop per la review. Ogni step lascia l'app funzionante; i test cambiano insieme al componente.

| Step | Contenuto | Riferimenti |
|---|---|---|
| **R1 — Fondamenta** | token (palette, temi della scacchiera sotto `[data-board-theme]`), `theme.css` (font mono e pezzi, raggi, ombre), font Figtree / JetBrains Mono / Cinzel 700-800, font dei pezzi ritagliato ai 12 glifi con uno script, `Button`, `Panel`, `TextField`, `Spinner`, test di contrasto, sfondo nativo Android | 1, 3.1, D2, D4, D22 |
| **R2 — Scacchiera e pezzi** | temi, coordinate, stati (velo, badge in alto a destra con turni residui), bersagli viola, mosse legali / selezione / scacco ridisegnati, glifi, miniatura per la home | 3.2, F1, F2, D1–D3, D19 |
| **R3 — Carta e mano** | nuova carta (rarità comune di default, moneta del costo, arte per kind, riga del tipo, pergamena, stato scurito, nome che si riduce), icone a tratto, mano a ventaglio, annullo col tocco sulla carta | 3.3, F3, D5–D8 |
| **R4 — Partita** | layout desktop e Android (Menu con foglio), pannelli giocatore, orologio, fasi a pillole con "Turno N", mana a 10 rombi, box del suggerimento unico (targeting, avvisi, motivo della carta spenta, pezzi congelati), CTA con la fase successiva, schede Mosse (UCI) / Grimorio / Chat, magie nello storico | 3.4, F4–F8, F11, D16–D18, D21 |
| **R5 — Shell e home** | barra laterale / verticale / inferiore, home del design (Gioca con Classificata, card «Presto»), Partita in corso in background con miniatura live, Classifica, Impostazioni (tema, lingua, Esci), redirect solo coda → partita | 3.5, F14, F16, F18, D9–D15 |
| **R6 — Parti senza design e chiusura** | tutto ciò che è nella sezione 6, nel linguaggio del design; Android sincronizzato; PROGRESS | 6, 8, D20 |

---

## 10. Decisioni (2026-09-25)

| # | Tema | Decisione |
|---|---|---|
| D1 | Tema della scacchiera | Tre temi (salvia, noce, arcano), **arcano di default**, scelta nelle Impostazioni, preferenza salvata con `src/lib/storage.ts`. |
| D2 | Pezzi | Glifi Unicode in **Noto Sans Symbols 2**, font **ritagliato** ai 12 glifi degli scacchi con uno script di build. |
| D3 | Mosse legali, selezione, scacco | **Restano** (briefing §7.5), ridisegnati nella palette del design e distinti dal viola delle magie. |
| D4 | Contrasto | Colori fedeli; si schiariscono **solo** quelli sotto l'AA, del minimo necessario, elencati qui quando fatti. |
| D5 | Carta non giocabile | **Scurita** con un velo (non trasparente, il testo resta AA). Il motivo **non** è scritto sulla carta: sta nell'etichetta accessibile e compare nel **box del suggerimento** quando si tocca la carta. |
| D6 | Nome della carta lungo | Il corpo si riduce fino a un minimo; sotto quel minimo va a capo. Mai troncato. |
| D7 | Rarità e tipo | Assenti dal catalogo: **rarità comune di default**, riga del tipo dal kind del primo effetto; richiesta in P2-15. |
| D8 | Annullare il targeting | Tocco sulla carta selezionata, `Esc`, tocco fuori dai bersagli. **Nessun pulsante**: il box del suggerimento dice come annullare. |
| D9 | Funzioni senza backend | **Visibili ma disattivate («Presto»)**, senza dati finti: modalità Amichevole e Bot, mazzi, collezione, amici, Sfida, notifiche, scheda Chat (P2-21). Le **cadenze sono escluse del tutto**: il gioco resta a cadenza unica (P2-1 non più necessaria). |
| D10 | Dati assenti in elementi reali | **Omessi**: variazione dell'ELO (P2-19), nome del mazzo, stagione e posizione propria in classifica (P2-20). |
| D11 | Funzioni da realizzare | **Classifica** (`GET /leaderboard`), **Impostazioni**, **magie nello storico** (dalla sessione; dopo una riconnessione si perdono, P2-18), **scheda Grimorio** con il catalogo di tutte le magie (mai il mazzo). |
| D12 | Modalità | «Classificata» attiva e selezionata (è la coda reale); Amichevole e Bot «Presto». |
| D13 | Navigazione durante la partita | La barra resta visibile; andando in home la **partita continua in background** (il socket resta aperto: la sessione vive già a livello d'app in `src/store/matchSession.ts`) e la home mostra «Partita in corso · Riprendi» con la miniatura live. La lobby manda a `/match` solo al passaggio coda → partita. |
| D14 | Esci | In fondo alle **Impostazioni**, con conferma. |
| D15 | Lingua | **Solo nelle Impostazioni** (e nel login); non nella barra laterale né nell'intestazione Android. |
| D16 | Avvisi | Nel **box del suggerimento**, temporanei; poi torna il suggerimento. |
| D17 | Partita su Android | Barra inferiore del design; «Menu» apre un foglio con Patta, Resa e le schede Mosse / Grimorio / Chat. Nessuna freccia di navigazione fra le posizioni (F10 non realizzabile). |
| D18 | Notazione | **Resta UCI.** |
| D19 | Elementi non disegnati da tenere | Turni residui sul badge, orologio in esaurimento, lampeggio delle case alla risoluzione di una magia, ridisegnati nel linguaggio del design. |
| D20 | Parti senza design | Le estendo nel linguaggio del design; review con screenshot a fine step. |
| D21 | Mana | **10 rombi**: il tetto è `MaxManaCap` nel server ma non nel protocollo (ASSUMPTIONS C16, P2-17). |
| D22 | Icona e splash | **Non si toccano ora**; cambia solo lo sfondo nativo `#302e2b` → `#1B1A1F`. |

Conseguenze sui documenti, da applicare nello step che tocca il codice: ASSUMPTIONS C14 (oggi "motivo scritto sulla
carta") cambia con D5 in R3; il briefing §6 ("Cinzel solo per il nome della magia") è superato dal design per la sola
resa tipografica.
