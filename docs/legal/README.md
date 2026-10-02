# Privacy e documenti legali: cosa fare prima di andare online

Questa cartella raccoglie ciò che serve per pubblicare CheckMage in regola con GDPR, regole sui cookie e store. Non è
consulenza legale: i testi sono bozze scritte partendo da ciò che il codice fa davvero. **Prima di pubblicare falli
rileggere a un avvocato** o a un consulente privacy; per un servizio piccolo e gratuito di solito basta una revisione
una tantum.

| File | A cosa serve | Si pubblica? |
|---|---|---|
| [`client/src/legal/config.ts`](../../client/src/legal/config.ts) | Titolare, email, hosting, data: gli unici valori da compilare | Sì (finisce nelle pagine) |
| [`client/src/legal/texts.it.ts`](../../client/src/legal/texts.it.ts), [`texts.en.ts`](../../client/src/legal/texts.en.ts) | Informativa privacy, Termini, cancellazione dell'account, Crediti | Sì (`/privacy`, `/terms`, `/account-deletion`, `/credits`) |
| [`REGISTRO-TRATTAMENTI.md`](REGISTRO-TRATTAMENTI.md) | Registro delle attività di trattamento (art. 30 GDPR) | No: lo tieni tu, da mostrare al Garante se lo chiede |
| [`DATA-BREACH.md`](DATA-BREACH.md) | Cosa fare se qualcuno entra nel server | No |
| [`GOOGLE-PLAY.md`](GOOGLE-PLAY.md) | Le risposte per la scheda dell'app su Google Play | No |

## Lista di controllo

Fai i passi in ordine. Il build del deploy si rifiuta di partire finché il punto 2 non è fatto (`npm run legal:check`).

1. **Un'email dedicata**, per esempio `privacy@tuodominio.it` o una casella gratuita solo per il gioco. È il contatto
   per privacy, segnalazioni e richieste degli utenti: deve essere letta.
2. **Compila [`client/src/legal/config.ts`](../../client/src/legal/config.ts):**
   - `owner`: il tuo nome e cognome (o la ragione sociale, se un giorno ci sarà una società);
   - `contactEmail`: l'email del punto 1;
   - `hosting`:
     - VPS: `{ kind: 'vps', provider: 'Hetzner Online GmbH', country: 'Germania' }`, con il nome legale del provider
       e il paese del datacenter;
     - PC di casa: `{ kind: 'home' }`;
   - `effectiveDate`: la data di pubblicazione.

   Poi `npm run legal:check` deve dire «Documenti legali pronti».
3. **Contratto con il fornitore** (art. 28 GDPR):
   - VPS: nel pannello del provider accetta il **Data Processing Agreement (DPA)**. Hetzner lo chiama «Contratto per
     il trattamento dei dati», ed è in *Cloud Console → Account → Data processing*; OVH e Contabo lo includono nelle
     condizioni o lo fanno firmare online. Scaricane una copia.
   - Casa: il DPA di Cloudflare è già incluso nei termini del servizio; non serve firmare nulla, ma salvane il link
     (cloudflare.com/cloudflare-customer-dpa).
4. **Fai rileggere i testi** (Informativa, Termini, cancellazione) e applica le correzioni in `texts.it.ts` e
   `texts.en.ts`.
5. **Compila il [registro dei trattamenti](REGISTRO-TRATTAMENTI.md)** con nome, email e fornitore, e conservalo.
6. **Ricerca del marchio**: cerca «CheckMage» su [EUIPO eSearch](https://euipo.europa.eu/eSearch/) e sulla banca dati
   UIBM. Se esiste già un marchio identico per giochi o software, cambia nome **prima** di farti conoscere.
7. **Backup al sicuro**: i backup (`deploy/backups/`) contengono dati personali. Restano sul server per 14 giorni
   (`deploy/backup.sh`); se li copi altrove, tienili su un disco cifrato o in un servizio con cifratura.
8. **Google Play** (solo se pubblichi l'app): segui [`GOOGLE-PLAY.md`](GOOGLE-PLAY.md).

## Dopo la pubblicazione

- **Richieste degli utenti** (accesso, rettifica, cancellazione, copia dei dati): rispondi **entro un mese**. Quasi
  tutto l'utente lo fa da solo nelle Impostazioni. Per il resto:
  - **cancellazione** di chi non riesce più ad accedere: verifica che scriva dall'email dell'account, poi cancellalo
    dal database (vedi sotto);
  - **rettifica dell'email**: non c'è una funzione nell'app; aggiornala nel database dopo aver verificato l'identità;
  - **copia dei dati**: chiedi all'utente di usare «Scarica i miei dati», oppure esporta tu le sue righe.
- **Cambi i testi?** Se la modifica è sostanziale (nuovi dati raccolti, nuovi fornitori, nuove finalità):
  1. aggiorna i testi e `effectiveDate`;
  2. alza `TERMS_VERSION` in `client/src/legal/config.ts` **e** `TermsVersion` in
     `server/internal/handlers/privacy.go` (stesso numero);
  3. pubblica client e server insieme.

  Al primo accesso ogni utente vedrà «Termini aggiornati» e dovrà accettarli.
- **Violazione dei dati**: segui [`DATA-BREACH.md`](DATA-BREACH.md).

### Cancellare un account a mano (utente che non accede più)

Dal server, trova l'id dell'utente a partire dall'email:

```bash
cd ~/check-mage/deploy
docker compose exec db psql -U chessuser -d chessdb -c "SELECT id, username FROM users WHERE email = 'email@utente.it';"
```

Apri la console del database (`docker compose exec db psql -U chessuser -d chessdb`) ed esegui le stesse operazioni
del pulsante «Elimina account» (`pgAccountStore.Delete` in `server/internal/db/accounts.go`), sostituendo `42` con l'id:

```sql
BEGIN;
DELETE FROM user_decks WHERE user_id = 42;
DELETE FROM user_cards WHERE user_id = 42;
DELETE FROM friend_links WHERE requester_id = 42 OR addressee_id = 42;
DELETE FROM user_blocks WHERE blocker_id = 42 OR blocked_id = 42;
DELETE FROM live_matches WHERE white_id = 42 OR black_id = 42;
UPDATE users SET username = '#eliminato-42', email = 'deleted-42@deleted.invalid', password = '',
       hide_presence = true, terms_accepted_at = NULL, deleted_at = now()
WHERE id = 42 AND deleted_at IS NULL;
COMMIT;
```

Esci con `\q` e rispondi all'utente che l'account è stato cancellato.

## Se un giorno guadagni dal gioco

Pubblicità, acquisti in app o abbonamenti cambiano molte cose. Prima di introdurli serve un'altra revisione:
- **fisco:** partita IVA o regime adatto;
- **consumatori:** Codice del consumo, cioè informazioni precontrattuali e recesso per i contenuti digitali;
- **identificazione completa** del gestore (D.Lgs. 70/2003);
- **pubblicità:** banner dei cookie con consenso preventivo per gli strumenti pubblicitari o di analisi;
- **DSA:** nuove regole del Digital Services Act;
- **store:** nuove dichiarazioni nelle schede degli store.
