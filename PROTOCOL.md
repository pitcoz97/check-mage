# WebSocket Protocol — Chess + Magic

Riferimento autoritativo del protocollo realtime del server. Per una checklist
orientata all'implementazione del client vedi [FRONTEND_TEST_SPEC.md](FRONTEND_TEST_SPEC.md).

## Connessione

- Endpoint: `GET /ws` (upgrade a WebSocket).
- Autenticazione JWT, in **uno** dei due modi:
  - header `Authorization: Bearer <access_token>`, oppure
  - query param `?token=<access_token>` (per i browser, che non possono
    impostare header sul WebSocket).
- Appena due giocatori sono in coda viene creata una `Room`; il primo in coda è
  il **Bianco**, il secondo il **Nero**.
- Rate limit: ~5 messaggi/secondo per client.

## Inviluppo messaggi

Ogni messaggio (in entrambe le direzioni) è JSON:

```json
{ "type": "<tipo>", "payload": { ... } }
```

`player`/`active_player` valgono `"white"` o `"black"`. I tempi (`*_time`) sono
in **millisecondi**. Le caselle sono in notazione algebrica (`"e4"`); le mosse
in **UCI** (`"e2e4"`, promozione `"e7e8q"`).

## Fasi del turno

Sequenza fissa per turno: `draw → main1 → move → main2 → end_turn` (poi il turno
passa all'avversario). Il server **auto-avanza** le fasi che non richiedono
input, quindi il client può ricevere più `phase_changed` in sequenza e non
osserva mai `draw` né `end_turn`:

| Fase | Auto-avanza? | Azioni client |
|------|-------------|---------------|
| `draw` | sempre (la pesca avviene comunque) | — |
| `main1` | se il giocatore non può castare nulla | `cast_spell`, `pass_phase` |
| `move` | mai | `move` (obbligatoria) |
| `main2` | se il giocatore non può castare nulla | `cast_spell`, `pass_phase` |
| `end_turn` | transizione server-side | — |

`resign` / `draw_offer` sono sempre ammessi durante il proprio turno. Dopo una
mossa valida la fase avanza da sola (il client non manda `pass_phase`).

## Client → Server

| `type` | `payload` | Note |
|--------|-----------|------|
| `move` | `{ "move": "e2e4" }` | solo in fase `move` |
| `pass_phase` | _(nessuno)_ | solo in `main1`/`main2` |
| `cast_spell` | `{ "spell_id": "...", "targets": ["e7"] }` | `main1`/`main2`; `targets` secondo il tipo (0/1/2 caselle) |
| `resign` | _(nessuno)_ | |
| `draw_offer` | _(nessuno)_ | |
| `draw_accepted` | _(nessuno)_ | in risposta a `draw_offer` |
| `draw_declined` | _(nessuno)_ | in risposta a `draw_offer` |

## Server → Client

| `type` | `payload` | Destinatario |
|--------|-----------|--------------|
| `game_state` | vedi sotto | entrambi (pubblico) |
| `timer_update` | `{ white_time, black_time, turn }` | entrambi |
| `phase_changed` | `{ phase, active_player, turn_number }` | entrambi |
| `hand` | `{ hand:[id...], mana, max_mana, deck_size }` | **solo proprietario** |
| `card_drawn` | `{ card_id, deck_size }` | **solo chi pesca** |
| `hand_size_changed` | `{ player, size }` | entrambi |
| `mana_changed` | `{ player, current, max }` | entrambi |
| `spell_cast` | `{ player, spell_id, targets, effects_applied:[...] }` | entrambi |
| `effect_expired` | `{ square, effect_kind, piece_id?, reason? }` | entrambi |
| `game_over` | `{ result, reason, winner? }` | entrambi |
| `draw_offer` | `{ from }` | avversario |
| `draw_offer_sent` | `{ message }` | offerente |
| `draw_declined` | `{ message }` | offerente |
| `opponent_disconnected` | `{ message }` | avversario |
| `opponent_reconnected` | `{ message }` | avversario |
| `error` | `{ message }` | mittente |

### `game_state` (stato pubblico)

```json
{
  "board": { "fen": "...", "moves": ["e2e4"], "turn": "white", "status": "active" },
  "white_time": 600000, "black_time": 600000,
  "phase": "main1", "active_player": "white", "turn_number": 1,
  "white_mana": 1, "white_max_mana": 1, "black_mana": 1, "black_max_mana": 1,
  "white_hand_size": 4, "black_hand_size": 4,
  "white_deck_size": 36, "black_deck_size": 36,
  "active_effects": [ { "square": "e7", "effects": [ { "kind": "freeze", "remaining_turns": 2 } ] } ],
  "reconnected": true
}
```

La **FEN è la fonte di verità** della scacchiera (aggiornata sia dalle mosse sia
dalle magie che editano la board). Il client non ricalcola lo stato.

`effects_applied` (in `spell_cast`) è una lista di oggetti `{ kind, ... }` con
campi specifici per effetto: `destroy_piece` → `target`, `piece_destroyed`;
`freeze_piece`/`shield_piece` → `target`, `remaining_turns`; `move_piece` →
`from`, `to`; `draw_card` → `count`; `gain_mana` → `amount`, `mana`.

## Anti-cheat

- Il client vede **solo la propria mano** (`hand`/`card_drawn`); dell'avversario
  conosce solo dimensione mano/mazzo e mana.
- Il server è autoritativo: applica lui gli effetti e li comunica; il client li
  visualizza soltanto.

## Regole magiche rilevanti per il client

- **freeze**: un pezzo congelato non può muoversi (mossa rifiutata con `error`).
- **shield**: assorbe una cattura — il pezzo sopravvive ma l'attaccante consuma
  comunque la mossa; arriva `effect_expired` con `reason: "shield_absorbed"`.
- Gli effetti persistenti seguono il **pezzo** (non la casella) e durano
  `remaining_turns` turni del proprietario.

## Catalogo magie (set MVP)

| ID | Nome | Costo | Target | Effetto |
|----|------|-------|--------|---------|
| `spark`/`jolt`/`pulse`/`surge`/`nova` | — | 1/2/2/3/5 | none | `noop` (placeholder) |
| `disintegrate` | Disintegrate | 4 | enemy_piece | distrugge un pezzo nemico |
| `frostbolt` | Frost Bolt | 2 | enemy_piece | congela un pezzo nemico (2 turni) |
| `aegis` | Aegis | 3 | own_piece | scudo su un pezzo proprio (2 turni) |
| `insight` | Insight | 1 | none | pesca 1 carta |
| `channel` | Channel | 0 | none | +2 mana questo turno |
| `teleport` | Teleport | 3 | piece_move | sposta un pezzo proprio su casella vuota |

Mazzo: 40 carte (in Fase 1 condiviso/identico per i due giocatori).

## Limiti noti

- Nessuna persistenza DB dei match live: un riavvio del server perde le partite
  in corso (la riconnessione funziona solo a server acceso).
- Il server non comunica esplicitamente il colore del giocatore: il client lo
  deduce.
- Il clock segue il lato al tratto degli scacchi, non il "giocatore attivo"
  della FSM.
- Un matto causato da una magia non è auto-rilevato (il game-over è verificato
  solo dopo una mossa).
