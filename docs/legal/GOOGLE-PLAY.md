# Google Play: privacy e sicurezza dei dati

Cosa compilare nella Play Console per pubblicare l'app Android. Le risposte seguono ciò che l'app fa davvero; se aggiungi
funzioni (statistiche, pubblicità, acquisti), vanno riviste.

## Contenuti dell'app (Play Console → Criteri → Contenuti dell'app)

| Voce | Cosa inserire |
|---|---|
| **Norme sulla privacy** | `https://<il-tuo-dominio>/privacy` |
| **Accesso alle app** | Serve un account: crea un account di prova per i revisori e indica email e password nel modulo |
| **Annunci** | No, l'app non contiene annunci |
| **Classificazione dei contenuti** | Questionario IARC: gioco di strategia, nessuna violenza, nessuna interazione non moderata a parte i nomi utente (niente chat) |
| **Pubblico di destinazione** | 13–15 anni, 16–17 anni, 18 anni e oltre. **Non** includere le fasce sotto i 13: attiverebbero le norme Famiglie. I Termini fissano comunque il minimo a 14 anni |
| **Cancellazione dell'account** | Sì, dall'app (Impostazioni → Privacy → Elimina account). Link web: `https://<il-tuo-dominio>/account-deletion` |

## Sicurezza dei dati (Data safety)

**L'app raccoglie o condivide dati utente?** Sì, li raccoglie; non li condivide con terze parti.

**Tutti i dati sono criptati in transito?** Sì (HTTPS e WSS).

**Gli utenti possono chiedere la cancellazione?** Sì, con lo stesso link della cancellazione dell'account.

| Tipo di dati (categoria Google) | Raccolto | Condiviso | Facoltativo | Finalità |
|---|---|---|---|---|
| Informazioni personali → **Indirizzo email** | Sì | No | No (obbligatorio) | Gestione dell'account |
| Informazioni personali → **ID utente** (nome utente, id) | Sì | No | No | Funzionalità dell'app, gestione dell'account |
| Attività nelle app → **Altre azioni** (partite, mosse, mazzi, amicizie) | Sì | No | No | Funzionalità dell'app |
| Informazioni e prestazioni dell'app → **Diagnostica** | No | | | Gli unici log stanno sul server e non sono legati all'utente |
| Posizione, contatti, foto, audio, file, calendario, informazioni finanziarie, salute, messaggi, cronologia web | No | | | |

Note:
- Le password non contano come dato da dichiarare in sé, ma sono gestite come parte dell'account: non vanno indicate
  separatamente.
- L'indirizzo IP è usato solo in memoria sul server per limitare le richieste, non viene memorizzato: secondo la guida
  di Google non è da dichiarare. Se un giorno lo salverai, rientra in «ID dispositivo o altri ID».
- «Condivisione» per Google esclude i fornitori che trattano i dati per tuo conto (hosting, Cloudflare): per questo è
  «No».

## Prima di inviare

- [ ] `npm run legal:check` passa e le pagine `/privacy`, `/terms`, `/account-deletion` sono online.
- [ ] Account di prova per i revisori creato e funzionante.
- [ ] Questionario dei contenuti compilato.
- [ ] Sezione «Sicurezza dei dati» coerente con l'informativa.
