# Registro delle attività di trattamento (art. 30 GDPR)

Documento interno: non si pubblica, si conserva e si mostra al Garante se lo richiede. Va aggiornato quando cambia il
trattamento (nuovi dati, nuovi fornitori, nuove finalità). Compila i campi tra parentesi quadre.

- **Titolare:** [NOME E COGNOME], [EMAIL DI CONTATTO]
- **Responsabile della protezione dei dati (DPO):** non designato (non obbligatorio: nessun trattamento su larga
  scala di dati particolari né monitoraggio sistematico)
- **Data dell'ultimo aggiornamento:** [DATA]

## Trattamenti

| # | Trattamento | Finalità | Base giuridica | Interessati | Categorie di dati | Destinatari | Trasferimenti extra UE | Conservazione | Misure di sicurezza |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Account | Registrazione, accesso, gestione dell'account | Contratto (art. 6.1.b) | Utenti registrati | Nome utente, email, hash della password, data di iscrizione, termini accettati | Fornitore di hosting [PROVIDER] (responsabile) | [Nessuno / Cloudflare: EU-US DPF] | Fino alla cancellazione dell'account; backup 14 giorni | HTTPS, bcrypt (costo 12), database non esposto, segreti fuori dal repository |
| 2 | Gioco | Partite, ELO, classifica, collezione, mazzi | Contratto (art. 6.1.b) | Utenti registrati | Partite (giocatori, mosse, esito, data, classificata o amichevole), ELO, carte, mazzi | Come sopra | Come sopra | Account: fino alla cancellazione. Partite: restano anonimizzate per lo storico degli avversari | Come sopra |
| 3 | Funzioni social | Amicizie, richieste, blocchi, sfide, stato online | Contratto (art. 6.1.b) | Utenti registrati | Legami d'amicizia, blocchi; sfide e stato online solo in memoria | Come sopra | Come sopra | Legami: fino alla cancellazione. Sfide: 60 s. Stato online: 30 s dall'ultimo segnale | Stato nascondibile; blocco reciproco |
| 4 | Sicurezza | Prevenzione di abusi e attacchi, diagnostica | Legittimo interesse (art. 6.1.f) | Chiunque usi il servizio | Indirizzo IP (solo in memoria, limite di richieste); log tecnici senza parametri delle richieste | Come sopra | Come sopra | IP: memoria del processo. Log: rotazione (10 MB × 3–5 file) | Log senza query string (niente token) |
| 5 | Richieste degli interessati | Rispondere a richieste di accesso, rettifica, cancellazione | Obbligo di legge (art. 6.1.c) | Chi scrive all'email di contatto | Email e contenuto della richiesta | Nessuno | Dipende dal fornitore della casella email: [FORNITORE EMAIL] | Il tempo necessario a rispondere e a dimostrarlo (consigliato: 2 anni) | Casella dedicata con password robusta e verifica in due passaggi |

## Fornitori (responsabili del trattamento, art. 28)

| Fornitore | Servizio | Dati | Accordo (DPA) |
|---|---|---|---|
| [PROVIDER DELLA VPS, se VPS] | Hosting del server e del database | Tutti i dati del servizio | [Accettato il GG/MM/AAAA, copia in …] |
| Cloudflare, Inc. (solo server di casa) | Tunnel, HTTPS, protezione della rete | Traffico in transito (IP, richieste) | Incluso nei termini (cloudflare.com/cloudflare-customer-dpa) |
| [FORNITORE EMAIL] | Casella di contatto | Email degli utenti che scrivono | [Termini del fornitore] |

## Valutazione d'impatto (DPIA)

Non necessaria. Non ricorre nessuno dei criteri dell'elenco del Garante e delle linee guida WP248:
- nessuna profilazione o decisione automatizzata con effetti giuridici;
- nessun dato particolare;
- nessun monitoraggio sistematico;
- nessun trattamento su larga scala.

Il pubblico minimo è di 14 anni, ma i dati di minori sono trattati solo nella misura minima necessaria al gioco.
