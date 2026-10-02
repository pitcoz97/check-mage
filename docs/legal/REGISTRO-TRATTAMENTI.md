# Registro delle attività di trattamento (art. 30 GDPR)

Documento interno: non si pubblica, si conserva e si mostra al Garante se lo richiede. Va aggiornato quando cambia il
trattamento (nuovi dati, nuovi fornitori, nuove finalità).

- **Titolare:** Riccardo Picozzi, info@check-mage.com
- **Responsabile della protezione dei dati (DPO):** non designato (non obbligatorio: nessun trattamento su larga
  scala di dati particolari né monitoraggio sistematico)
- **Data dell'ultimo aggiornamento:** 2 ottobre 2026
- **Dove gira il servizio:** su un computer del titolare, raggiungibile da internet tramite un tunnel Cloudflare
- **Posta:** info@check-mage.com è inoltrata da Cloudflare Email Routing a una casella Gmail del titolare

## Trattamenti

| # | Trattamento | Finalità | Base giuridica | Interessati | Categorie di dati | Destinatari | Trasferimenti extra UE | Conservazione | Misure di sicurezza |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Account | Registrazione, accesso, gestione dell'account | Contratto (art. 6.1.b) | Utenti registrati | Nome utente, email, hash della password, data di iscrizione, termini accettati | Cloudflare, Inc. (responsabile, solo dati in transito) | Cloudflare (USA): EU-US Data Privacy Framework e clausole contrattuali tipo | Fino alla cancellazione dell'account; backup 14 giorni | HTTPS, bcrypt (costo 12), database non esposto, segreti fuori dal repository |
| 2 | Gioco | Partite, ELO, classifica, collezione, mazzi | Contratto (art. 6.1.b) | Utenti registrati | Partite (giocatori, mosse, esito, data, classificata o amichevole), ELO, carte, mazzi | Come sopra | Come sopra | Account: fino alla cancellazione. Partite: restano anonimizzate per lo storico degli avversari | Come sopra |
| 3 | Funzioni social | Amicizie, richieste, blocchi, sfide, stato online | Contratto (art. 6.1.b) | Utenti registrati | Legami d'amicizia, blocchi; sfide e stato online solo in memoria | Come sopra | Come sopra | Legami: fino alla cancellazione. Sfide: 60 s. Stato online: 30 s dall'ultimo segnale | Stato nascondibile; blocco reciproco |
| 4 | Sicurezza | Prevenzione di abusi e attacchi, diagnostica | Legittimo interesse (art. 6.1.f) | Chiunque usi il servizio | Indirizzo IP (solo in memoria, limite di richieste); log tecnici senza parametri delle richieste | Come sopra | Come sopra | IP: memoria del processo. Log: rotazione (10 MB × 3–5 file) | Log senza query string (niente token) |
| 5 | Corrispondenza | Rispondere a richieste di accesso, rettifica, cancellazione; segnalazioni e altre domande | Obbligo di legge (art. 6.1.c) per le richieste sui dati; legittimo interesse (art. 6.1.f) per il resto | Chi scrive all'email di contatto | Indirizzo email, contenuto del messaggio, risposte | Cloudflare, Inc. (responsabile, inoltro della posta); Google (fornitore della casella Gmail) | USA: Cloudflare e Google aderiscono all'EU-US Data Privacy Framework | Il tempo necessario a rispondere e a dimostrarlo, al massimo 2 anni (come dichiarato nell'informativa) | Casella Gmail con password robusta e verifica in due passaggi; inoltro solo dell'indirizzo di contatto |

## Fornitori (responsabili del trattamento, art. 28)

| Fornitore | Servizio | Dati | Accordo (DPA) |
|---|---|---|---|
| Cloudflare, Inc. | Tunnel, HTTPS, protezione della rete; inoltro della posta (Email Routing) | Traffico in transito (IP, richieste); email inviate a info@check-mage.com | Incluso nei termini (cloudflare.com/cloudflare-customer-dpa) |
| Google (Gmail) | Casella che riceve la posta inoltrata | Email degli utenti che scrivono | Nessuno: con un account Gmail personale Google non firma un DPA e tratta i dati secondo i propri termini. Per avere un DPA (art. 28) serve Google Workspace o un altro servizio email professionale |

## Valutazione d'impatto (DPIA)

Non necessaria. Non ricorre nessuno dei criteri dell'elenco del Garante e delle linee guida WP248:
- nessuna profilazione o decisione automatizzata con effetti giuridici;
- nessun dato particolare;
- nessun monitoraggio sistematico;
- nessun trattamento su larga scala.

Il pubblico minimo è di 14 anni, ma i dati di minori sono trattati solo nella misura minima necessaria al gioco.
