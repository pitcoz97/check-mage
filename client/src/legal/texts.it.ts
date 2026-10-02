import type { LegalContext, LegalTexts } from './types';

/**
 * Testi legali in italiano (P4). BOZZA scritta a partire da ciò che il codice fa davvero (dati raccolti, tempi,
 * fornitori): va fatta rileggere a un professionista prima della pubblicazione. Ogni modifica sostanziale richiede di
 * alzare TERMS_VERSION (config.ts) e TermsVersion sul server.
 */
export function italianTexts(c: LegalContext): LegalTexts {
  const recipients =
    c.hosting.kind === 'vps'
      ? `Il server è ospitato da ${c.hosting.provider}, con data center in ${c.hosting.country}, che tratta i dati per conto del titolare come responsabile del trattamento (art. 28 GDPR), in base al proprio accordo sul trattamento dei dati.`
      : 'Il server funziona su un computer del titolare. Il traffico passa attraverso Cloudflare, Inc., che fornisce la connessione cifrata (HTTPS) e la protezione della rete e tratta i dati in transito (tra cui indirizzo IP e contenuto delle richieste) come responsabile del trattamento (art. 28 GDPR).';
  const transfers =
    c.hosting.kind === 'vps'
      ? 'Se il data center del provider si trova fuori dallo Spazio economico europeo, il trasferimento avviene sulla base di una decisione di adeguatezza della Commissione europea o delle clausole contrattuali tipo previste dall’accordo con il provider. Non ci sono altri trasferimenti fuori dall’UE.'
      : 'Cloudflare, Inc. ha sede negli Stati Uniti e aderisce all’EU-U.S. Data Privacy Framework: i trasferimenti avvengono su questa base e sulle clausole contrattuali tipo del suo accordo sul trattamento dei dati.';

  return {
    privacy: {
      title: 'Informativa privacy',
      intro: `Come CheckMage tratta i tuoi dati personali, ai sensi degli articoli 13 e 14 del Regolamento (UE) 2016/679 (GDPR). In vigore dal ${c.effectiveDate}.`,
      sections: [
        {
          title: 'Titolare del trattamento',
          body: [`Il titolare è ${c.owner}, che puoi contattare per qualunque domanda o richiesta sui tuoi dati all’indirizzo ${c.email}.`],
        },
        {
          title: 'Quali dati trattiamo',
          body: [
            {
              list: [
                'Dati dell’account: nome utente, indirizzo email, password (conservata solo in forma cifrata e non reversibile, con bcrypt), data di iscrizione, versione dei termini accettati e data dell’accettazione.',
                'Dati di gioco: punteggio ELO, partite giocate (giocatori, esito, mosse, cadenza, data, se classificata o amichevole), collezione di carte e mazzi.',
                'Dati sociali: amicizie, richieste d’amicizia, giocatori bloccati e sfide (queste ultime solo in memoria, al massimo per 60 secondi).',
                'Stato online: mentre l’app è aperta il dispositivo invia un segnale ogni pochi secondi; lo stato (online, in partita, offline) è tenuto solo in memoria e si perde dopo 30 secondi senza segnali o al riavvio del server. Puoi nasconderlo nelle Impostazioni.',
                'Dati tecnici: l’indirizzo IP, usato solo in memoria per limitare le richieste eccessive e mai salvato nel database; i log tecnici del server (metodo, percorso, esito e durata delle richieste, senza i loro parametri), conservati a rotazione con una dimensione massima limitata.',
              ],
            },
            'Non raccogliamo dati di pagamento, posizione, contatti o dati di categorie particolari, e non usiamo strumenti di analisi, pubblicità o profilazione.',
          ],
        },
        {
          title: 'Perché li trattiamo e su quale base',
          body: [
            {
              list: [
                'Creare e gestire il tuo account, farti giocare, calcolare la classifica e offrirti le funzioni social: esecuzione del contratto, cioè dei Termini di servizio che accetti alla registrazione (art. 6.1.b GDPR).',
                'Proteggere il servizio da abusi e attacchi (limiti alle richieste, log tecnici, sospensione degli account che violano i Termini): legittimo interesse del titolare alla sicurezza del servizio (art. 6.1.f GDPR).',
                'Rispettare obblighi di legge e, se necessario, difendere un diritto in giudizio (art. 6.1.c e 6.1.f GDPR).',
              ],
            },
            'Nome utente, email e password sono necessari per registrarsi: senza non è possibile usare il servizio.',
          ],
        },
        {
          title: 'Cosa vedono gli altri',
          body: [
            'Nome utente, ELO, data di iscrizione e statistiche delle partite sono pubblici: compaiono nel profilo e in classifica, visibili anche a chi non ha un account. Gli utenti registrati vedono anche lo storico delle tue partite e il tuo stato online (se non lo nascondi), e possono trovarti cercando il tuo nome. L’indirizzo email non è mai mostrato ad altri.',
          ],
        },
        {
          title: 'A chi comunichiamo i dati',
          body: [recipients, 'Non vendiamo né cediamo i dati a terzi. Possiamo comunicarli alle autorità solo quando la legge lo impone.'],
        },
        { title: 'Trasferimenti fuori dall’Unione europea', body: [transfers] },
        {
          title: 'Per quanto tempo',
          body: [
            {
              list: [
                'Account e dati collegati: finché l’account esiste; puoi cancellarlo quando vuoi.',
                'Alla cancellazione: email, password, mazzi, collezione, amicizie, richieste e blocchi vengono eliminati subito; le partite già giocate restano nello storico degli avversari, con il tuo nome sostituito da «Giocatore eliminato».',
                'Stato online e sfide: solo in memoria, per pochi secondi o minuti.',
                'Log tecnici: a rotazione, sovrascritti al raggiungimento di una dimensione massima.',
                `Backup del database: conservati ${c.backupDays} giorni e poi cancellati; fino ad allora possono contenere anche un account già cancellato.`,
              ],
            },
          ],
        },
        {
          title: 'Cookie e memoria del dispositivo',
          body: [
            'CheckMage non usa cookie. Salva nella memoria del browser (localStorage) o dell’app soltanto:',
            {
              list: [
                'i dati di accesso (token), per restare collegato;',
                'la lingua e il tema della scacchiera che hai scelto;',
                'l’indicazione che hai una partita in corso, per riprenderla.',
              ],
            },
            'Sono strumenti strettamente necessari al servizio che chiedi o a ricordare le tue scelte, per i quali la legge non richiede il consenso (art. 122 del Codice privacy e Linee guida del Garante sui cookie del 10 giugno 2021): per questo non vedi un banner. Non ci sono cookie di analisi, di profilazione o di terze parti, e anche i caratteri tipografici sono serviti dal nostro server.',
          ],
        },
        {
          title: 'Minori',
          body: [`Il servizio è riservato a chi ha almeno ${c.minimumAge} anni. Se scopriamo che un account appartiene a una persona più giovane, lo cancelliamo.`],
        },
        {
          title: 'I tuoi diritti',
          body: [
            'Puoi chiedere in qualunque momento l’accesso ai tuoi dati, la rettifica, la cancellazione, la limitazione del trattamento, la portabilità e opporti al trattamento basato sul legittimo interesse (articoli 15–21 GDPR).',
            `Nelle Impostazioni puoi scaricare tutti i tuoi dati e cancellare l’account in autonomia; per tutto il resto scrivi a ${c.email}: rispondiamo entro un mese.`,
            'Hai anche il diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it) o all’autorità di controllo del Paese in cui vivi.',
          ],
        },
        {
          title: 'Decisioni automatizzate',
          body: ['Il punteggio ELO e l’abbinamento in coda sono calcoli automatici basati sugli esiti delle partite, senza effetti giuridici o di analoga importanza su di te. Non facciamo profilazione.'],
        },
        {
          title: 'Sicurezza',
          body: [
            'Usiamo connessioni cifrate (HTTPS), password cifrate con bcrypt, un database raggiungibile solo dal server e limiti alle richieste. In caso di violazione dei dati che comporti un rischio per te, avvisiamo il Garante entro 72 ore e, se il rischio è elevato, anche te.',
          ],
        },
        {
          title: 'Modifiche',
          body: ['Aggiorniamo questa informativa quando il servizio cambia. Le modifiche sostanziali ti verranno mostrate al primo accesso e dovrai accettarle per continuare a giocare.'],
        },
      ],
    },

    terms: {
      title: 'Termini di servizio',
      intro: `Le regole per usare CheckMage. In vigore dal ${c.effectiveDate}.`,
      sections: [
        {
          title: 'Il servizio',
          body: [
            `CheckMage è un gioco di scacchi con carte magiche, offerto gratuitamente da ${c.owner} (contatto: ${c.email}). Registrandoti accetti questi Termini e dichiari di aver letto l’Informativa privacy.`,
          ],
        },
        {
          title: 'Chi può registrarsi',
          body: [
            {
              list: [
                `Devi avere almeno ${c.minimumAge} anni.`,
                'Puoi avere un solo account.',
                'L’indirizzo email deve essere tuo; sei responsabile della password e di ciò che avviene con il tuo account.',
              ],
            },
          ],
        },
        {
          title: 'Comportamento',
          body: [
            'Non è consentito:',
            {
              list: [
                'scegliere nomi utente offensivi, volgari o discriminatori, che impersonano altre persone o contengono dati personali;',
                'farsi aiutare da programmi o persone durante le partite (per esempio motori di scacchi) o automatizzare il gioco;',
                'manipolare la classifica, per esempio con più account o partite concordate;',
                'sfruttare errori del servizio, attaccarlo o sovraccaricarlo;',
                'molestare o insultare altri giocatori.',
              ],
            },
          ],
        },
        {
          title: 'Segnalazioni e moderazione',
          body: [
            `Puoi segnalare nomi o comportamenti scorretti scrivendo a ${c.email}. Se i Termini vengono violati possiamo cambiare un nome utente, annullare risultati, sospendere o chiudere l’account, spiegandone il motivo quando possibile.`,
          ],
        },
        {
          title: 'Un servizio gratuito, così com’è',
          body: [
            'Il gioco è offerto senza garanzia di disponibilità continua. Carte e regole possono cambiare o essere ribilanciate; punteggi e dati di gioco possono essere azzerati in caso di problemi tecnici o di nuove stagioni. Il servizio può essere sospeso o chiuso, con un preavviso ragionevole quando possibile.',
          ],
        },
        {
          title: 'Responsabilità',
          body: [
            'Nei limiti consentiti dalla legge, il titolare non risponde dei danni indiretti derivanti dall’uso, o dall’impossibilità di usare, un servizio gratuito. Restano ferme la responsabilità per dolo o colpa grave e le tutele che la legge non permette di escludere, compresi i diritti dei consumatori.',
          ],
        },
        {
          title: 'Proprietà intellettuale',
          body: [
            'Il gioco, la grafica e i testi appartengono ai rispettivi autori. Caratteri tipografici e componenti di terze parti sono usati secondo le loro licenze (vedi Crediti). Non è consentito copiare o redistribuire il gioco senza permesso.',
          ],
        },
        {
          title: 'Cancellazione dell’account',
          body: [
            `Puoi cancellare l’account quando vuoi, dalle Impostazioni («Elimina account») o scrivendo a ${c.email}. Puoi anche smettere di usare il servizio senza alcun preavviso.`,
          ],
        },
        {
          title: 'Modifiche ai Termini',
          body: ['Le modifiche sostanziali ti verranno mostrate al primo accesso. Se non le accetti puoi cancellare l’account.'],
        },
        {
          title: 'Legge applicabile',
          body: [
            'Questi Termini sono regolati dalla legge italiana. Se sei un consumatore, è competente il giudice del luogo in cui risiedi o sei domiciliato e restano salve le tutele inderogabili del Paese in cui vivi.',
          ],
        },
      ],
    },

    accountDeletion: {
      title: 'Cancellazione dell’account',
      intro: 'Come cancellare il tuo account CheckMage e cosa succede ai tuoi dati. Valido per il sito e per l’app Android.',
      sections: [
        {
          title: 'Come fare',
          body: [
            'Accedi al sito o all’app, apri Impostazioni, sezione Privacy, scegli «Elimina account», inserisci la password e conferma.',
            `Non riesci ad accedere? Scrivi a ${c.email} dall’indirizzo email del tuo account: cancelliamo l’account entro un mese.`,
          ],
        },
        {
          title: 'Cosa viene cancellato subito',
          body: [{ list: ['email, password e nome utente;', 'mazzi e collezione di carte;', 'amicizie, richieste, blocchi e impostazioni;', 'la registrazione dei termini accettati.'] }],
        },
        {
          title: 'Cosa resta',
          body: [
            {
              list: [
                'Le partite già giocate, perché fanno parte dello storico degli avversari: il tuo nome è sostituito da «Giocatore eliminato» e non sono più collegate ai tuoi dati.',
                `I backup del database, che vengono cancellati entro ${c.backupDays} giorni.`,
              ],
            },
          ],
        },
        { title: 'È definitivo', body: ['Un account cancellato non si può recuperare. Se vuoi, prima scarica i tuoi dati dalle Impostazioni.'] },
      ],
    },

    credits: {
      title: 'Crediti',
      intro: 'Grazie ai progetti su cui CheckMage è costruito.',
      sections: [
        {
          title: 'Caratteri tipografici',
          body: [
            'Figtree, Cinzel, JetBrains Mono e Noto Sans Symbols 2 (ritagliato ai pezzi degli scacchi), con licenza SIL Open Font License 1.1, serviti dal nostro server.',
          ],
        },
        { title: 'Motore scacchistico', body: ['Stockfish (GNU General Public License v3), usato sul server per verificare le mosse.'] },
        {
          title: 'Software open source',
          body: [
            'Client: React, React Router, Zustand, Zod, i18next, chess.js, Capacitor, Vite e Tailwind CSS. Server: Go, chi, Gorilla WebSocket, golang-jwt, zap e lib/pq. Tutti distribuiti con licenze open source (MIT, BSD, Apache o simili).',
          ],
        },
        { title: 'Grafica', body: ['Icone, simboli delle carte e icona dell’app sono stati disegnati per questo progetto.'] },
      ],
    },
  };
}
