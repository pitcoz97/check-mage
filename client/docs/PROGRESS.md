# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 0 — Contratto e mock server: COMPLETO, in attesa di review.** Non iniziare lo Step 1 senza approvazione.

## Completo (Step 0)
- Tooling: TS strict, ESLint (`no-explicit-any`, `no-console`, divieto di import `mock-server` da `src`), Vitest.
- `src/game/model.ts`, `src/ws/protocol.ts` (con guardia di sincronia a compile-time), `src/api/adapter.ts`
  (unico interprete del filo, warning etichettati con l'id dell'assunzione), `src/spells/schema.ts` + `fallback.json`.
- Mock (`npm run mock`, porta 8080): REST §3.1 + `/ws/ticket` + `/spells`, rate limit per IP, CORS P0-2,
  room severo (fasi, mana, magie, piece_id, orologi, riconnessione), 9 scenari via `?scenario=` o `MOCK_SCENARIO`.
- `npm run mock:e2e`: 9/9 scenari verdi passando solo per l'adapter. Test: 68 verdi (adapter, regole mock,
  sincronia dei cataloghi, e2e).
- Documenti: `ASSUMPTIONS.md` (G1–G10, A11–A19, M1–M12), `BACKEND-REQUESTS.md` (P0-1…P2-5).

## In corso
- Niente.

## Prossima azione concreta
Review dello Step 0. Dopo l'approvazione: Plan Mode per lo **Step 1** (Vite + React + Tailwind + Router +
token + layout shell + i18n), aggiungendo gli script `dev`/`build`.

## Decisioni prese (Step 0)
- G2: `card_drawn` = `{card_id, spell_id}`; senza `spell_id` l'adapter genera un id locale. `cast_spell` = `{spell_id, targets}`.
- Schemi del filo solo in `adapter.ts`; `api/types.ts` contiene solo modelli interni.
- Mock: Shield blocca magie avversarie **e** catture; Teleport solo verso caselle vuote.
- REST auth assunto (A11/A12). Ogni `game_start` alla riconnessione sostituisce l'intero stato (G5).

## Decisioni aperte
- `appId`: `com.checkmage.app` o un dominio tuo → entro lo Step 6.
- Testo di flavour sulle carte, e con che tono → Step 5.
- Licenza del progetto → prima degli asset dello Step 4.
- Semantica di M5 (durata degli effetti contata sui turni del proprietario) e M7 (matto immediato dopo la
  mossa): scelte del mock, da confermare.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH di Machine e User.
- Identità git locale del repo: Riccardo Picozzi <riccardo.picozzi97@gmail.com>.
