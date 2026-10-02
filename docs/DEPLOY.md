# Mettere CheckMage online su una VPS

Questa guida porta CheckMage da "gira sul mio PC" a "chiunque può giocare da `https://tuodominio.it`", anche se non
hai mai usato un server. Ogni comando si copia e incolla; dopo ogni passo c'è scritto **cosa devi vedere** e cosa fare
se non lo vedi.

> **Preferisci un computer a casa invece di una VPS?** C'è una guida apposta, con un confronto fra le due strade:
> [`DEPLOY-CASA.md`](DEPLOY-CASA.md).

Tempo necessario: circa **2 ore** la prima volta, di cui buona parte ad aspettare (DNS, build). Poi ogni
aggiornamento è un solo comando.

---

## Indice

0. [Come funziona, in breve](#0-come-funziona-in-breve)
1. [Cosa ti serve e quanto costa](#1-cosa-ti-serve-e-quanto-costa)
2. [Comprare il dominio](#2-comprare-il-dominio)
3. [Creare la chiave SSH e la VPS](#3-creare-la-chiave-ssh-e-la-vps)
4. [Collegare il dominio alla VPS](#4-collegare-il-dominio-alla-vps)
5. [Primo accesso e messa in sicurezza](#5-primo-accesso-e-messa-in-sicurezza)
6. [Installare Docker](#6-installare-docker)
7. [Scaricare il progetto sulla VPS](#7-scaricare-il-progetto-sulla-vps)
8. [Configurare i cinque valori](#8-configurare-i-cinque-valori)
9. [Avviare tutto](#9-avviare-tutto)
10. [Aggiornare dopo una modifica](#10-aggiornare-dopo-una-modifica)
11. [Backup del database](#11-backup-del-database)
12. [L'app Android puntata al server online](#12-lapp-android-puntata-al-server-online)
13. [Problemi comuni](#13-problemi-comuni)
14. [Comandi utili](#14-comandi-utili)
15. [Facoltativo: prova in locale prima della VPS](#15-facoltativo-prova-in-locale-prima-della-vps)
16. [Glossario](#16-glossario)

---

## 0. Come funziona, in breve

Affitti un piccolo computer Linux sempre acceso in un datacenter (la **VPS**). Sopra ci girano tre "scatole"
separate (**container** Docker), che si avviano tutte insieme con un solo comando:

```
Internet ──► Caddy (porte 80 e 443, HTTPS automatico)
               ├── tuodominio.it      → i file del sito (il client)
               └── api.tuodominio.it  → il server Go ──► il database Postgres
```

- **Caddy** mostra il sito e ottiene da solo i certificati HTTPS (il lucchetto nel browser), gratis.
- Il **server** Go gestisce login, partite e magie; dentro ha già Stockfish.
- **Postgres** conserva utenti, partite, collezioni e mazzi. Da internet non è raggiungibile.

Tutto quello che serve è già nel repository, nella cartella `deploy/`. Tu dovrai solo scegliere un dominio, creare la
VPS e scrivere **cinque valori** in un file.

---

## 1. Cosa ti serve e quanto costa

| Cosa | Dove | Costo indicativo |
|---|---|---|
| Una VPS Linux con almeno **2 vCPU e 4 GB di RAM** | Hetzner Cloud (usata in questa guida) | 4–6 € al mese |
| Un **dominio** (es. `checkmage.it`) | un registrar, per esempio Cloudflare, Namecheap o Aruba | 5–15 € all'anno |
| Un account **GitHub** con accesso al repository | già ce l'hai | gratis |
| Il tuo PC Windows con **PowerShell** | già ce l'hai | — |

Ti servono anche una carta di pagamento (Hetzner a volte chiede un documento per verificare l'account) e un'email.

> **Perché serve un dominio?** I browser e l'app Android accettano solo connessioni cifrate (HTTPS). I certificati
> gratuiti di Let's Encrypt si rilasciano per un nome di dominio, non per un indirizzo IP.

In questa guida:
- `tuodominio.it` è il **tuo** dominio: sostituiscilo ovunque;
- `IP_DELLA_VPS` è l'indirizzo della VPS (lo vedrai al passo 3), da sostituire allo stesso modo.

---

## 2. Comprare il dominio

1. Scegli un registrar. Tutti vanno bene; due comodi:
   - **Cloudflare Registrar** (dash.cloudflare.com → *Domain Registration* → *Register Domains*): prezzo di costo,
     niente sorprese al rinnovo;
   - **Namecheap** (namecheap.com): interfaccia semplice.
2. Cerca il nome che vuoi, aggiungilo al carrello, paga. Il WHOIS privacy, se proposto gratis, va bene lasciarlo
   attivo.
3. Tieni aperta la pagina di gestione del dominio: al passo 4 ci aggiungerai due record.

**Cosa devi vedere:** il dominio compare nell'elenco "I miei domini", con lo stato *Attivo*.

---

## 3. Creare la chiave SSH e la VPS

### 3.1 La chiave SSH (sul tuo PC)

La chiave SSH è il modo sicuro per entrare nella VPS senza password: una parte resta sul tuo PC (privata), l'altra
la dai a Hetzner (pubblica).

1. Apri **PowerShell**: tasto Start, scrivi `PowerShell`, Invio.
2. Incolla questo comando e premi Invio:

   ```powershell
   ssh-keygen -t ed25519 -C "checkmage"
   ```

3. Alle domande:
   - *Enter file in which to save the key*: premi solo **Invio**, va bene il percorso proposto;
   - *Enter passphrase*: puoi scegliere una frase che ti verrà chiesta a ogni accesso (più sicuro), oppure premere
     Invio due volte per non averla.
4. Mostra la parte pubblica:

   ```powershell
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   **Cosa devi vedere:** una riga sola che inizia con `ssh-ed25519 AAAA…` e finisce con `checkmage`. Selezionala tutta
   con il mouse e copiala (Ctrl+C). È pubblica: non è un segreto.

> **Non condividere mai** il file `id_ed25519` senza `.pub`: è la tua chiave privata.

### 3.2 La VPS su Hetzner

1. Vai su **console.hetzner.cloud** e crea un account. Conferma l'email ed eventualmente completa la verifica.
2. Crea un **progetto**: *+ New project*, nome `checkmage`, poi aprilo.
3. Premi **Add Server** e scegli:
   - **Location**: una in Europa (Norimberga, Falkenstein o Helsinki);
   - **Image**: **Ubuntu 24.04**;
   - **Type**: *Shared vCPU*, architettura **x86 (Intel/AMD)**, il piano più piccolo con **almeno 4 GB di RAM**
     (per esempio CX22, o quello che Hetzner propone oggi con caratteristiche simili);
   - **Networking**: lascia *Public IPv4* e *Public IPv6* attivi;
   - **SSH keys**: *Add SSH key*, incolla la riga copiata al punto 3.1, dai un nome (es. `pc-casa`) e salva. Assicurati
     che sia **selezionata**;
   - **Volumes**, **Firewalls**, **Backups**: per ora niente. I backup di Hetzner (+20% del prezzo) sono un'ottima
     sicurezza in più: puoi attivarli anche dopo;
   - **Name**: `checkmage`.
4. Premi **Create & Buy now**.

**Cosa devi vedere:** dopo meno di un minuto il server è *Running*, con un indirizzo **IPv4** del tipo `49.12.34.56`.
Quello è il tuo `IP_DELLA_VPS`: annotalo.

---

## 4. Collegare il dominio alla VPS

Il DNS è la "rubrica" di internet: diremo che `tuodominio.it` e `api.tuodominio.it` corrispondono all'IP della VPS.

1. Nel pannello del registrar apri la gestione **DNS** del dominio (su Cloudflare: il dominio → *DNS* → *Records*; su
   Namecheap: *Domain List* → *Manage* → *Advanced DNS*).
2. Se ci sono già record di tipo `A` o `AAAA` per `@` o `www` messi dal registrar (una "pagina di parcheggio"),
   cancellali.
3. Aggiungi **due** record:

   | Tipo | Nome (Host) | Valore (IPv4 address) | TTL |
   |---|---|---|---|
   | `A` | `@` | `IP_DELLA_VPS` | Auto (o 5 min) |
   | `A` | `api` | `IP_DELLA_VPS` | Auto (o 5 min) |

   `@` significa "il dominio stesso" (`tuodominio.it`); `api` crea `api.tuodominio.it`.
4. **Solo se usi Cloudflare:** per entrambi i record imposta *Proxy status* su **DNS only** (nuvola grigia, non
   arancione). Con il proxy di Cloudflare attivo, Caddy non riesce a ottenere i certificati.
5. Salva.

**Come controllare** (dopo qualche minuto, a volte fino a un'ora). Da PowerShell sul PC:

```powershell
nslookup tuodominio.it
nslookup api.tuodominio.it
```

**Cosa devi vedere:** in entrambe le risposte, sotto *Addresses* o *Address*, il tuo `IP_DELLA_VPS`. Se vedi un altro
indirizzo o *Non-existent domain*, aspetta ancora e riprova. **Non andare al passo 9 finché entrambi non rispondono
con l'IP giusto**: i passi 5–8 invece li puoi fare nel frattempo.

---

## 5. Primo accesso e messa in sicurezza

### 5.1 Entrare nella VPS

Da PowerShell:

```powershell
ssh root@IP_DELLA_VPS
```

- La prima volta compare *Are you sure you want to continue connecting (yes/no/[fingerprint])?*: scrivi `yes` e
  premi Invio.
- Se hai messo una passphrase alla chiave, ora te la chiede.

**Cosa devi vedere:** un messaggio di benvenuto di Ubuntu e un prompt tipo `root@checkmage:~#`. Da qui in poi i
comandi si scrivono **in questa finestra**, che è la VPS, non il tuo PC.

> **Copiare e incollare nel terminale:** per copiare, seleziona il testo col mouse. Per incollare usa **clic
> destro** oppure **Ctrl+V** (dipende dalla versione di Windows: se Ctrl+V non va, usa il clic destro).
> Per uscire dalla VPS scrivi `exit`.

### 5.2 Aggiornare il sistema

```bash
apt update && apt upgrade -y
```

Ci vuole qualche minuto. Se compare una schermata viola che chiede quali servizi riavviare o se tenere un file di
configurazione, lascia la scelta proposta e premi **Invio**.

Poi riavvia:

```bash
reboot
```

La connessione si chiude. Aspetta un minuto e rientra con `ssh root@IP_DELLA_VPS`.

### 5.3 Il firewall

Il firewall lascia entrare solo SSH (per te) e il web (porte 80 e 443). **Esegui i comandi in quest'ordine**: la prima
riga è quella che ti permette di non restare chiuso fuori.

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

Alla domanda *Command may disrupt existing ssh connections. Proceed with operation (y|n)?* rispondi `y`.

**Cosa devi vedere** con `ufw status`: `Status: active` e le regole per `OpenSSH`, `80/tcp`, `443/tcp` e `443/udp`.

> Se per errore resti chiuso fuori: nella console Hetzner, sul server, c'è il pulsante **>_ Console**, che apre un
> terminale nel browser anche senza SSH. Da lì puoi scrivere `ufw allow OpenSSH`.

### 5.4 Aggiornamenti di sicurezza automatici

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

Alla domanda scegli **Yes** (con le frecce, poi Invio). Da ora Ubuntu installa da solo gli aggiornamenti di sicurezza.

### 5.5 Niente accesso con password

Con la chiave SSH l'accesso con password non serve, e disattivarlo blocca i tentativi di indovinarla. Controlla:

```bash
sshd -T | grep -i passwordauthentication
```

- Se vedi `passwordauthentication no`, è già tutto a posto.
- Se vedi `passwordauthentication yes`, esegui:

  ```bash
  echo "PasswordAuthentication no" > /etc/ssh/sshd_config.d/99-no-password.conf
  systemctl restart ssh
  ```

  Prima di chiudere questa finestra, **apri un secondo PowerShell** e verifica che `ssh root@IP_DELLA_VPS` funzioni
  ancora.

### 5.6 Facoltativo: memoria di scorta (swap)

Utile se hai scelto una VPS con meno di 4 GB di RAM: la prima build del sito ne usa parecchia.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Cosa devi vedere** con `free -h`: una riga `Swap:` con circa `2.0Gi`.

---

## 6. Installare Docker

Docker è il programma che fa girare i tre container. Lo script ufficiale lo installa in un colpo:

```bash
curl -fsSL https://get.docker.com | sh
```

Poi verifica:

```bash
docker run --rm hello-world
docker compose version
```

**Cosa devi vedere:** la prima scrive *Hello from Docker!*; la seconda *Docker Compose version v2…*.

---

## 7. Scaricare il progetto sulla VPS

Il repository è privato, quindi la VPS ha bisogno di un permesso per leggerlo: un **token** di GitHub in sola lettura.

### 7.1 Creare il token (sul PC, nel browser)

1. Su github.com: la tua foto in alto a destra → **Settings** → in fondo a sinistra **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Compila:
   - **Token name**: `vps-checkmage`;
   - **Expiration**: per esempio 1 anno. Segnati la scadenza: quando scade, gli aggiornamenti smettono di funzionare
     finché non ne crei uno nuovo (vedi [Problemi comuni](#13-problemi-comuni));
   - **Repository access**: **Only select repositories** → scegli `check-mage`;
   - **Permissions** → *Repository permissions* → **Contents**: **Read-only**. Il resto lascialo com'è.
3. **Generate token** e copia subito il codice (`github_pat_…`): GitHub non te lo mostrerà più.

### 7.2 Clonare (sulla VPS)

Prima fai ricordare a git le credenziali, così gli aggiornamenti non chiederanno il token ogni volta. Il token viene
salvato sulla VPS in `~/.git-credentials`; è in sola lettura e vale solo per questo repository.

```bash
git config --global credential.helper store
cd ~
git clone https://github.com/pitcoz97/check-mage.git
```

Alle domande:
- **Username**: il tuo nome utente GitHub (`pitcoz97`);
- **Password**: incolla il **token** (mentre lo incolli non compare nulla, è normale), poi Invio.

**Cosa devi vedere:** *Cloning into 'check-mage'…* e alla fine *done*. Controlla con:

```bash
ls ~/check-mage/deploy
```

Devono comparire `docker-compose.yml`, `update.sh`, `backup.sh`, `restore.sh`, `caddy` e `postgres`.

> Viene scaricato il branch `main`: tutto ciò che vuoi mettere online deve essere unito in `main` e pushato.

---

## 8. Configurare i cinque valori

Tutta la configurazione sta in un solo file, `deploy/.env`, che contiene segreti: **non va mai messo su GitHub** (è già
escluso dal `.gitignore`).

### 8.1 Generare i due segreti

Sulla VPS:

```bash
openssl rand -hex 24
openssl rand -hex 32
```

Il primo comando stampa la **password del database**, il secondo il **segreto dei login** (JWT). Tienili a portata di
mano: li incolli fra un momento. Conservane una copia in un posto sicuro, per esempio un password manager.

### 8.2 Scrivere il file

```bash
cd ~/check-mage/deploy
cp .env.example .env
nano .env
```

Si apre l'editor **nano**. Muoviti con le **frecce** e compila le righe vuote, senza spazi attorno all'`=`:

```ini
APP_DOMAIN=tuodominio.it
API_DOMAIN=api.tuodominio.it
ACME_EMAIL=latuaemail@esempio.it
DB_PASSWORD=la-stringa-del-primo-comando
JWT_SECRET=la-stringa-del-secondo-comando
```

- **Niente** `https://` nei domini, solo il nome.
- `ACME_EMAIL`: Let's Encrypt la usa solo per avvisarti se un certificato ha problemi.

Per salvare: **Ctrl+O**, poi **Invio**. Per uscire: **Ctrl+X**.

**Cosa devi vedere** con `cat .env`: i cinque valori compilati.

> **Attenzione a `DB_PASSWORD`:** Postgres la legge **solo al primo avvio**. Se la cambi dopo, il server non riesce
> più a collegarsi al database (vedi [Problemi comuni](#13-problemi-comuni)). Cambiare `JWT_SECRET` invece va bene:
> semplicemente tutti dovranno rifare il login.

### 8.3 I documenti legali

Prima di andare online, l'informativa privacy e i termini devono indicare chi gestisce il gioco e come contattarlo.
Segui la lista di controllo in [`docs/legal/README.md`](legal/README.md): in breve, compila
`client/src/legal/config.ts` (nome, email, provider della VPS) **sul tuo computer**, fai il commit e il push, poi
sulla VPS `git pull`. Finché ci sono segnaposto, il passo 9 si ferma con il messaggio «Documenti legali non pronti».

---

## 9. Avviare tutto

Prima di partire, ricontrolla che il passo 4 sia completato: `nslookup` deve rispondere con l'IP della VPS per
**entrambi** i nomi.

```bash
cd ~/check-mage/deploy
docker compose up -d --build
```

La prima volta ci vogliono **5–10 minuti**: Docker scarica le immagini, compila il server Go e costruisce il sito.
Scorreranno molte righe; alla fine torna il prompt.

### 9.1 Controllare che i container siano accesi

```bash
docker compose ps
```

**Cosa devi vedere:** tre righe, `checkmage-caddy-1`, `checkmage-db-1` e `checkmage-server-1`, con *STATUS* `Up`. Il
database deve essere `Up … (healthy)`.

Se una riga dice `Restarting` o `Exited`, guarda i suoi log (sezione 9.2) e poi [Problemi comuni](#13-problemi-comuni).

### 9.2 Leggere i log

Server:

```bash
docker compose logs server
```

**Cosa devi vedere:** fra le ultime righe *Connesso al database*, *Stockfish pronto* e *Chess server avviato*.

Caddy (i certificati):

```bash
docker compose logs caddy | grep -i certificate
```

**Cosa devi vedere:** per `tuodominio.it` e per `api.tuodominio.it` una riga con *certificate obtained successfully*.
Se non c'è ancora, aspetta un minuto e riprova: Caddy ci prova da solo più volte.

> Per seguire i log in diretta: `docker compose logs -f` (tutti) o `docker compose logs -f server`. Si esce con
> **Ctrl+C**, e i container restano accesi.

### 9.3 La prova vera

1. Nel browser apri `https://api.tuodominio.it/status`.

   **Cosa devi vedere:** un testo tipo `{"success":true,"data":{"status":"ok",…}}` e il lucchetto nella barra degli
   indirizzi.
2. Apri `https://tuodominio.it`.

   **Cosa devi vedere:** la schermata di accesso di CheckMage.
3. Registra un utente e accedi.
4. Apri una **finestra in incognito** (Ctrl+Shift+N), o un altro browser, o il telefono, e registra un **secondo**
   utente.
5. Premi **Gioca** in entrambe: il server le accoppia e parte la partita. Gioca qualche mossa e lancia una magia.
6. Ricarica la pagina a metà partita: devi rientrare nella partita.

Se tutto funziona, **CheckMage è online**. 🎉

---

## 10. Aggiornare dopo una modifica

Ogni volta che vuoi pubblicare una nuova versione:

1. sul PC, unisci le modifiche in `main` e fai **push** su GitHub;
2. sulla VPS (`ssh root@IP_DELLA_VPS`):

   ```bash
   ~/check-mage/deploy/update.sh
   ```

Lo script scarica il codice nuovo, ricostruisce solo ciò che è cambiato, riavvia e mostra lo stato. Le partite in
corso vengono salvate allo spegnimento e riprese al riavvio: i giocatori vedono una breve disconnessione e poi
rientrano da soli.

**Cosa devi vedere** alla fine: la tabella di `docker compose ps` con i tre container `Up`.

---

## 11. Backup del database

### 11.1 Un backup subito

```bash
~/check-mage/deploy/backup.sh
```

**Cosa devi vedere:** `… backup salvato: deploy/backups/checkmage-AAAA-MM-GG_HHMM.sql.gz (…)`.

### 11.2 Backup automatico ogni notte

```bash
crontab -e
```

Se chiede quale editor usare, scegli **nano** (di solito il numero `1`). Vai in fondo al file con le frecce e aggiungi
questa riga:

```
0 3 * * * /root/check-mage/deploy/backup.sh >> /root/check-mage/deploy/backups/backup.log 2>&1
```

Salva con **Ctrl+O**, **Invio**, ed esci con **Ctrl+X**. Da ora ogni notte alle 3 viene fatto un backup; quelli più
vecchi di 14 giorni si cancellano da soli.

**Controllo**, il giorno dopo:

```bash
ls -lh ~/check-mage/deploy/backups
```

### 11.3 Tenere una copia sul PC

I backup sulla VPS non servono se si rompe la VPS stessa. Ogni tanto scaricane uno. Da PowerShell **sul PC**, non
sulla VPS:

```powershell
scp root@IP_DELLA_VPS:/root/check-mage/deploy/backups/NOME-DEL-FILE.sql.gz .
```

Il file finisce nella cartella in cui si trova PowerShell (di solito `C:\Users\tuonome`). Per sapere i nomi dei file,
usa il comando `ls` del punto 11.2 sulla VPS.

In più, i **Backups** di Hetzner (sul server, scheda *Backups*) salvano l'intera VPS ogni giorno: sono la rete di
sicurezza più semplice.

### 11.4 Ripristinare un backup

**Cancella i dati attuali** e li sostituisce con quelli del backup:

```bash
cd ~/check-mage/deploy
./restore.sh backups/checkmage-AAAA-MM-GG_HHMM.sql.gz
```

Lo script chiede di scrivere `SI` per confermare. Senza argomenti, elenca i backup disponibili.

Per ripristinare un file scaricato sul PC, prima ricaricalo sulla VPS (da PowerShell sul PC):

```powershell
scp .\NOME-DEL-FILE.sql.gz root@IP_DELLA_VPS:/root/check-mage/deploy/backups/
```

---

## 12. L'app Android puntata al server online

L'app contiene una copia del sito, quindi va costruita con gli indirizzi del server online. Sul **PC**, nella cartella
`client`:

1. Crea il file `client/.env.production` con queste due righe (cambia il dominio):

   ```ini
   VITE_API_BASE_URL=https://api.tuodominio.it
   VITE_WS_URL=wss://api.tuodominio.it/ws
   ```

   Serve solo alle build (`npm run build`, `npm run android:sync`): `npm run dev` continua a usare il mock. Il file
   non va su GitHub.
2. Poi:

   ```bash
   npm run android:sync
   ```

3. Costruisci la versione **release** firmata seguendo `client/docs/ANDROID.md`, sezione **4-bis. Costruire contro il
   server vero**.

Il server accetta già l'origine dell'app (`https://localhost`): il `docker-compose.yml` la mette in
`CORS_ALLOWED_ORIGINS` insieme al tuo dominio.

---

## 13. Problemi comuni

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| Il browser dice "non sicuro", o nei log di Caddy compaiono errori su `acme` o `challenge` | Il DNS non punta ancora alla VPS, o le porte 80/443 sono chiuse | Ricontrolla `nslookup` (passo 4) e `ufw status` (passo 5.3). Se usi Cloudflare, la nuvola deve essere **grigia**. Poi `docker compose restart caddy` |
| Troppi tentativi falliti: Let's Encrypt ti blocca per un'ora | Hai avviato con il DNS sbagliato più volte | Sistema il DNS, aspetta un'ora, poi `docker compose restart caddy` |
| `https://api.tuodominio.it` risponde **502 Bad Gateway** | Il server non è acceso o si sta ancora avviando | `docker compose ps` e `docker compose logs server` |
| Nei log del server: *JWT_SECRET non impostato* | Manca il valore in `deploy/.env` | Compilalo (passo 8.2), poi `docker compose up -d` |
| Nei log del server: *password authentication failed* | `DB_PASSWORD` è stata cambiata dopo il primo avvio | Rimetti la password originale in `.env`, oppure aggiorna quella del database (vedi sotto) |
| Nei log del server: *Errore avvio Stockfish* | L'immagine non è stata costruita bene | `docker compose build --no-cache server && docker compose up -d` |
| Il sito si apre ma login e registrazione non vanno, e nella console del browser (F12) c'è un errore **CORS** | `APP_DOMAIN` non è esattamente il dominio che usi nel browser (per esempio apri `www.tuodominio.it`) | Usa esattamente `APP_DOMAIN`, oppure scrivi in `APP_DOMAIN` il dominio che usi davvero; poi `docker compose up -d --build` |
| "Gioca" non trova la partita e si riconnette di continuo | Il WebSocket viene rifiutato (origine non ammessa) o è bloccato dal proxy di Cloudflare | Come la riga sopra; con Cloudflare, nuvola grigia |
| `docker compose` risponde *Manca … in deploy/.env* | Uno dei cinque valori è vuoto | Compilalo (passo 8.2) |
| `update.sh` chiede username e password, o dice *Authentication failed* | Il token GitHub è scaduto | Creane uno nuovo (passo 7.1), poi sulla VPS `rm ~/.git-credentials` e `cd ~/check-mage && git pull`: inserisci username e nuovo token |
| Errori *no space left on device* | Disco pieno (immagini vecchie, log) | `df -h` per vedere lo spazio, poi `docker system prune -a` (toglie immagini non usate; i dati del database restano) |
| La build si interrompe con *Killed* o *out of memory* | Poca RAM | Aggiungi lo swap (passo 5.6) e riprova |
| Dopo un riavvio della VPS il sito non torna | Raro: Docker non si è avviato | `systemctl start docker`, poi `cd ~/check-mage/deploy && docker compose up -d` |

**Cambiare la password del database dopo il primo avvio.** Metti la nuova password in `deploy/.env`, poi:

```bash
cd ~/check-mage/deploy
docker compose exec db psql -U chessuser -d chessdb -c "ALTER USER chessuser PASSWORD 'LA-NUOVA-PASSWORD';"
docker compose up -d
```

Quando chiedi aiuto a qualcuno, allega l'output di:

```bash
cd ~/check-mage/deploy
docker compose ps
docker compose logs --tail 100
```

**Non** mandare mai il contenuto di `deploy/.env`.

---

## 14. Comandi utili

Tutti vanno eseguiti dalla cartella `~/check-mage/deploy` (prima: `cd ~/check-mage/deploy`).

| Cosa vuoi fare | Comando |
|---|---|
| Vedere lo stato dei container | `docker compose ps` |
| Vedere i log (ultime 100 righe) | `docker compose logs --tail 100` |
| Seguire i log in diretta (esci con Ctrl+C) | `docker compose logs -f` |
| Riavviare solo il server | `docker compose restart server` |
| Riavviare tutto | `docker compose restart` |
| Spegnere tutto (i dati restano) | `docker compose down` |
| Riaccendere | `docker compose up -d` |
| Aggiornare alla versione su GitHub | `./update.sh` |
| Fare un backup | `./backup.sh` |
| Spazio su disco | `df -h` |
| Memoria e CPU dei container | `docker stats` (esci con Ctrl+C) |
| Aprire la console del database | `docker compose exec db psql -U chessuser -d chessdb` (esci con `\q`) |

> **Non usare mai** `docker compose down -v`: la `-v` **cancella i dati del database**.

---

## 15. Facoltativo: prova in locale prima della VPS

Se hai Docker su un computer (Docker Desktop su Windows, oppure una VM Linux), puoi provare tutto prima di spendere
per VPS e dominio. Dalla cartella `deploy` del progetto:

1. Crea `deploy/.env` con:

   ```ini
   APP_DOMAIN=localhost
   API_DOMAIN=api.localhost
   ACME_EMAIL=prova@example.com
   DB_PASSWORD=provaprova
   JWT_SECRET=un-segreto-qualsiasi-per-la-prova
   ```

2. Avvia con `docker compose up -d --build`.
3. Per `localhost` Caddy usa un certificato suo, che il browser non conosce. Apri prima
   `https://api.localhost/status` e accetta l'avviso (*Avanzate* → *Procedi*), poi `https://localhost` e accetta di
   nuovo.
4. Quando hai finito: `docker compose down -v`. Qui la `-v` va bene: cancella i dati **di prova**.

Chrome, Edge e Firefox risolvono da soli `*.localhost` sul tuo computer: non serve toccare nessun file.

---

## 16. Glossario

- **VPS** (Virtual Private Server): un computer Linux in affitto in un datacenter, sempre acceso e raggiungibile da
  internet.
- **Dominio**: il nome del sito (`tuodominio.it`); **sottodominio**: un nome sotto di esso (`api.tuodominio.it`).
- **DNS**: la "rubrica" che traduce un dominio nell'indirizzo IP del computer che lo ospita. Un record **A** dice
  "questo nome corrisponde a questo IPv4".
- **SSH**: il modo sicuro per aprire un terminale su un computer remoto. La **chiave SSH** sostituisce la password.
- **Firewall**: il filtro che decide quali "porte" del server sono aperte da internet.
- **Docker / container**: un programma impacchettato con tutto ciò che gli serve, che gira isolato. **Docker
  Compose** avvia più container insieme, descritti in `docker-compose.yml`.
- **Reverse proxy**: il "centralino" (qui Caddy) che riceve tutte le richieste e le passa al servizio giusto.
- **HTTPS / certificato**: la connessione cifrata (il lucchetto). Il certificato lo rilascia gratis **Let's Encrypt**;
  Caddy lo chiede e lo rinnova da solo.
- **WebSocket**: la connessione sempre aperta usata durante le partite, per ricevere le mosse in tempo reale.

---

## Riferimenti tecnici

Per chi mette mano alla configurazione:

- `deploy/docker-compose.yml`: i tre servizi, le variabili del server e la rete (`172.28.0.0/16`, usata come
  `TRUSTED_PROXIES`, così il rate limit legge l'IP vero da `X-Forwarded-For`).
- `deploy/caddy/Dockerfile`: la build del client con `VITE_API_BASE_URL` e `VITE_WS_URL` ricavati da `API_DOMAIN`.
- `deploy/caddy/Caddyfile`: il sito, con fallback a `index.html` e cache lunga sugli `/assets`, e il proxy verso
  `server:8080`.
- `server/Dockerfile`: il server Go più Stockfish di Debian.
- `deploy/postgres/init.sql`: le tabelle `users` e `games`, create solo al primo avvio. Le altre le crea il server.
- Variabili del server: `server/.env.example`. Per un Postgres esterno con SSL si usa `DB_SSLMODE=require`.
