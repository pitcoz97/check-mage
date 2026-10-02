# Violazione dei dati personali (data breach): cosa fare

Una violazione è qualunque evento che porti alla distruzione, perdita, modifica o divulgazione non autorizzata dei dati,
o all'accesso non autorizzato. Esempi:
- qualcuno entra nel server o nel database;
- un backup finisce in mano ad altri;
- un errore rende visibili le email di tutti;
- il disco si rompe senza backup.

## Subito (primi minuti, prime ore)

1. **Contieni.** Spegni o isola ciò che è compromesso:
   - `docker compose down` se l'attacco è in corso;
   - cambia le password del server e del pannello del provider;
   - revoca le chiavi SSH sospette.
2. **Cambia i segreti.** Rigenera `JWT_SECRET` e `DB_PASSWORD` in `deploy/.env` (guida: `docs/DEPLOY.md`, passo 8) e
   riavvia. Un nuovo `JWT_SECRET` disconnette tutti: è voluto.
3. **Conserva le prove.** Non cancellare log e file sospetti: copiali altrove (`docker compose logs > incidente.txt`).
4. **Annota l'ora** in cui te ne sei accorto: da lì partono le 72 ore.

## Entro 72 ore: notifica al Garante (art. 33)

Va fatta **se la violazione presenta un rischio** per i diritti degli utenti. Per esempio:
- **sì:** sono uscite email e hash delle password, oppure qualcuno ha avuto accesso al database;
- **no:** il disco si è rotto ma c'era un backup integro e cifrato, e nessuno ha visto i dati.

- La notifica si fa online sul sito del Garante (servizio «Notifica data breach»), anche a informazioni incomplete,
  integrandola dopo.
- Serve indicare:
  - cosa è successo;
  - quali dati sono coinvolti e quanti utenti;
  - le conseguenze probabili;
  - le misure prese;
  - un contatto.

## Se il rischio è elevato: avvisa gli utenti (art. 34)

Per esempio se sono uscite email e hash delle password. Scrivi agli utenti coinvolti, in modo semplice, dicendo:
- cosa è successo e quali loro dati sono coinvolti;
- cosa hai fatto;
- cosa conviene che facciano: cambiare la password se l'avevano riusata altrove, diffidare di email sospette;
- il contatto per domande.

## Sempre: registro delle violazioni (art. 33.5)

Annota **ogni** violazione, anche quelle che non notifichi, con:
- data;
- cosa è successo;
- dati coinvolti;
- conseguenze;
- misure prese;
- perché hai deciso di notificare o no.

Basta una tabella in questo file o in un documento a parte.

| Data | Cosa è successo | Dati e utenti coinvolti | Misure | Notificata al Garante? Perché |
|---|---|---|---|---|
| | | | | |

## Prevenzione (già in atto)

- **Server e database:** HTTPS, password con bcrypt, database non raggiungibile da internet, firewall
  (`docs/DEPLOY.md`, passo 5), accesso SSH solo con chiave.
- **Log e backup:** log senza parametri delle richieste, quindi niente token; backup giornalieri conservati 14 giorni.
- **Da fare tu:**
  - aggiornare il sistema (`unattended-upgrades` è già nella guida);
  - tenere al sicuro le copie dei backup fuori dal server;
  - non condividere mai `deploy/.env`.
