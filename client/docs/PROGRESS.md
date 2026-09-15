# PROGRESS

> Punto di ripartenza, non diario. Massimo una pagina. Leggilo prima di tutto il resto.

## Step corrente
**Step 0 — Contratto e mock server** (piano approvato il 2026-09-15).

## Completo
- Repo git e tooling (TS strict, ESLint, Vitest).
- `ASSUMPTIONS.md` (G1–G10, A11–A18, M1–M11) e `BACKEND-REQUESTS.md` (P0-1…P2-4).

## In corso
- Catalogo (`src/spells/schema.ts`), `src/game/model.ts`, `src/ws/protocol.ts`, `src/api/adapter.ts`.

## Prossima azione concreta
Scrivere schema e fallback del catalogo, poi i modelli e protocol.ts.

## Decisioni prese (Step 0)
- G2: `card_drawn` assunto come `{card_id, spell_id}`; se manca `spell_id` l'adapter genera un id
  d'istanza locale. `cast_spell` sul filo resta `{spell_id, targets}`.
- Gli schemi del filo stanno tutti in `src/api/adapter.ts`; `api/types.ts` contiene solo modelli interni.
- Mock: Shield blocca magie avversarie **e** catture; Teleport solo su casella vuota.
- REST auth: contratto assunto (A11/A12), richiesta P1-4.

## Decisioni aperte (non bloccanti per lo Step 0, da §14)
- `appId`: `com.checkmage.app` o reverse-DNS di un dominio tuo → serve entro lo Step 6.
- Testo di flavour sulle carte, e con che tono → Step 5.
- Licenza del progetto → prima di scegliere gli asset dello Step 4.

## Note d'ambiente
- La shell dello strumento non vede Node nel PATH: prima dei comandi npm va ricaricato il PATH
  di Machine e User.
