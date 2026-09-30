# Mettere CheckMage online da un computer di casa

Questa guida è l'alternativa a [`DEPLOY.md`](DEPLOY.md), che usa una VPS in affitto. Qui il server è un piccolo
computer **a casa tua**, sempre acceso. Lo stile è lo stesso: ogni comando si copia e incolla, e dopo ogni passo c'è
scritto **cosa devi vedere**.

Alcuni passi sono identici a quelli della guida VPS: in quei casi trovi un rimando con le piccole differenze da
tenere a mente.

---

## Indice

0. [VPS o computer di casa? Il confronto](#0-vps-o-computer-di-casa-il-confronto)
1. [Come funziona, in breve](#1-come-funziona-in-breve)
2. [L'hardware](#2-lhardware)
3. [Controllare la connessione di casa](#3-controllare-la-connessione-di-casa)
4. [Installare Linux](#4-installare-linux)
5. [Preparare il computer a restare sempre acceso](#5-preparare-il-computer-a-restare-sempre-acceso)
6. [Accesso SSH e firewall](#6-accesso-ssh-e-firewall)
7. [Docker e progetto](#7-docker-e-progetto)
8. [Il dominio su Cloudflare](#8-il-dominio-su-cloudflare)
9. [Creare il tunnel](#9-creare-il-tunnel)
10. [Configurare i valori](#10-configurare-i-valori)
11. [Avviare e provare](#11-avviare-e-provare)
12. [Aggiornamenti e backup](#12-aggiornamenti-e-backup)
13. [Facoltativo: gestire il server da fuori casa](#13-facoltativo-gestire-il-server-da-fuori-casa)
14. [Problemi comuni](#14-problemi-comuni)
15. [Passare da casa alla VPS, o viceversa](#15-passare-da-casa-alla-vps-o-viceversa)

---

## 0. VPS o computer di casa? Il confronto

| | VPS ([`DEPLOY.md`](DEPLOY.md)) | Computer di casa (questa guida) |
|---|---|---|
| Spesa iniziale | 0 € | 80–180 € (mini PC o Raspberry Pi 5 con SSD) |
| Spesa continua | circa 5 € al mese (60 € all'anno) | corrente: 15–30 € all'anno |
| Dominio | necessario (5–15 € all'anno) | necessario, gestito da Cloudflare (5–15 € all'anno) |
| Pareggio dei costi | — | dopo circa 2–3 anni |
| Se va via la corrente o internet a casa | il gioco resta online | il gioco va offline finché non torna tutto |
| Guasto dell'hardware | lo risolve il fornitore | lo risolvi tu (disco, alimentatore…) |
| Porte aperte sul router | nessuna, non c'è router | nessuna, grazie al tunnel |
| Funziona con qualunque connessione | sì | sì, anche dietro CGNAT, grazie al tunnel |
| Chi vede il traffico | solo la VPS (HTTPS fino al tuo server) | anche Cloudflare, che termina l'HTTPS sui suoi server |
| Velocità per chi gioca | ottima | buona: dipende dall'upload di casa, ma a CheckMage bastano pochi Mbit |
| Tempo di manutenzione | basso | medio: aggiornamenti, backup fuori casa, hardware |
| Difficoltà della guida | media | media, con un passo in più (tunnel) e uno in meno (niente firewall pubblico) |

**Il mio consiglio.** Se il gioco deve essere usato da altre persone, anche poche, e vuoi che sia sempre raggiungibile,
scegli la **VPS**. Se è soprattutto per te e qualche amico, ti diverte gestire la macchina e accetti qualche
interruzione, il **computer di casa** va benissimo e dopo un paio d'anni costa meno.

Si può sempre cambiare idea: il [passo 15](#15-passare-da-casa-alla-vps-o-viceversa) spiega come spostare tutto
senza perdere i dati.

> **E il PC Windows che uso tutti i giorni?** Tecnicamente si può (Docker Desktop), ma lo sconsiglio: si spegne, va
> in sospensione, si riavvia per gli aggiornamenti, e ogni volta il gioco va offline. Meglio un computer dedicato.

---

## 1. Come funziona, in breve

A casa di solito non si può "ricevere" traffico da internet. Molti operatori non danno un indirizzo IP raggiungibile
(il **CGNAT**), spesso l'IP cambia, e aprire porte sul router espone la rete di casa. Per questo usiamo un **Cloudflare
Tunnel**: è il tuo computer a collegarsi a Cloudflare, con una connessione **in uscita**, e Cloudflare gli passa i
giocatori.

```
Giocatore ──HTTPS──► Cloudflare ◄══ tunnel (in uscita) ══ cloudflared ─► Caddy ─► server ─► Postgres
                                                          └──────── il tuo computer di casa ────────┘
```

- **Nessuna porta aperta** sul router: dall'esterno nessuno si collega direttamente a casa tua.
- **HTTPS gratis**: il lucchetto lo mette Cloudflare.
- I container sono gli stessi della VPS, più uno: **cloudflared**, il pezzo che tiene aperto il tunnel.

---

## 2. L'hardware

Non servono prestazioni: conta che sia **silenzioso, consumi poco e resti acceso**. Requisiti minimi: **4 GB di RAM**,
un **SSD** da almeno 64 GB e una porta di rete (meglio il cavo che il Wi-Fi).

| Opzione | Prezzo indicativo | Consumo | Note |
|---|---|---|---|
| **Mini PC usato** (Lenovo ThinkCentre Tiny M720q/M920q, Dell OptiPlex Micro, HP ProDesk/EliteDesk Mini) | 80–150 € | 7–15 W | La scelta più semplice: è un PC normale, con SSD e cavo di rete. Controlla che abbia almeno 8 GB di RAM o si possa espandere |
| **Mini PC nuovo con Intel N100** (Beelink, GMKtec, Minisforum…) | 120–180 € | 6–10 W | Nuovo, con garanzia, molto efficiente |
| **Raspberry Pi 5** (4 o 8 GB) | 90–150 € completo | 3–6 W | Serve comprare a parte alimentatore ufficiale, case con ventola e un **SSD** (USB o NVMe). Evita la sola microSD: con un database si consuma in fretta |

Costo della corrente (a circa 0,30 € per kWh), acceso tutto l'anno: 10 W fanno circa 26 € all'anno, 5 W circa 13 €.

Tutti e tre vanno bene con questo progetto: le immagini Docker usate esistono sia per PC (x86) sia per Raspberry
(ARM), e Stockfish c'è per entrambi.

---

## 3. Controllare la connessione di casa

Questo passo è **solo informativo**: col tunnel funziona in ogni caso. Serve a capire perché non apriamo porte sul
router.

1. Scopri l'IP che internet vede: apri **ifconfig.me** nel browser e annota il numero.
2. Entra nella pagina del router (di solito `192.168.1.1` o `192.168.0.1`; la password è sull'etichetta del router) e
   cerca l'**indirizzo IP WAN** o "IP pubblico", di solito nella pagina di stato.
3. Confronta:
   - **uguali**: hai un IP pubblico. Si potrebbero aprire porte, ma il tunnel resta più sicuro e semplice;
   - **diversi**, o l'IP WAN inizia con `100.64`–`100.127`, `10.`, `172.16`–`172.31` o `192.168.`: sei dietro
     **CGNAT**, cioè le porte aperte non funzionerebbero. Il tunnel è l'unica strada, ed è quella di questa guida.

---

## 4. Installare Linux

Prima crea la **chiave SSH** sul tuo PC Windows, come al [passo 3.1 della guida VPS](DEPLOY.md#31-la-chiave-ssh-sul-tuo-pc).
Tieni pronta la riga `ssh-ed25519 …`.

### 4A. Mini PC: Ubuntu Server 24.04

Ti servono una chiavetta USB da almeno 4 GB (verrà cancellata), una tastiera e uno schermo **solo per l'installazione**.

1. Sul PC Windows scarica **Ubuntu Server 24.04 LTS** da ubuntu.com/download/server (un file `.iso` di circa 3 GB).
2. Scarica **balenaEtcher** (etcher.balena.io) o **Rufus** (rufus.ie). Apri il programma, scegli il file `.iso`,
   scegli la chiavetta e premi **Flash** (o **Avvia**).
3. Collega al mini PC la chiavetta, la tastiera, lo schermo e il **cavo di rete**. Accendilo e premi subito il tasto del
   menu di avvio: di solito **F12** (Lenovo, Dell), **F9** (HP) o **F7**/**F11**. Scegli la chiavetta USB.
4. Nell'installazione (si va avanti con le frecce, **Invio** e **Tab**):
   - **Language**: `English` (i messaggi di errore in inglese sono più facili da cercare) o `Italiano`;
   - **Keyboard**: `Italian`;
   - **Type of installation**: `Ubuntu Server` (non *minimized*);
   - **Network**: se c'è il cavo, compare un indirizzo tipo `192.168.1.23`: va bene così, *Done*;
   - **Proxy** e **Mirror**: lascia com'è, *Done*;
   - **Storage**: `Use an entire disk` → il disco interno. **Cancella tutto il disco**, *Done*, poi *Continue*;
   - **Profile**: il tuo nome, server name `checkmage`, un nome utente (es. `gioco`) e una password **che ricordi**
     (ti servirà per `sudo`);
   - **Ubuntu Pro**: `Skip for now`;
   - **SSH**: seleziona **Install OpenSSH server** (con lo spazio). Se la tua chiave SSH è anche su GitHub puoi
     scegliere *Import SSH key → from GitHub*; altrimenti la aggiungi al passo 6;
   - **Featured snaps**: non selezionare nulla, *Done*.
5. Alla fine scegli **Reboot Now**, togli la chiavetta quando te lo chiede e premi Invio.

**Cosa devi vedere:** dopo il riavvio, un prompt di login `checkmage login:`. Accedi con utente e password, poi scrivi
`ip -4 addr` e annota l'indirizzo della scheda di rete, tipo `192.168.1.23`: è l'**IP locale** del server. Da ora puoi
scollegare tastiera e schermo.

### 4B. Raspberry Pi 5: Raspberry Pi OS Lite a 64 bit

1. Sul PC Windows installa **Raspberry Pi Imager** (raspberrypi.com/software) e collega l'SSD (con un adattatore USB)
   o la microSD.
2. Nell'Imager:
   - **Device**: Raspberry Pi 5;
   - **OS**: *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**;
   - **Storage**: l'SSD o la microSD.
3. Quando chiede *Would you like to apply OS customisation settings?* scegli **Edit settings**:
   - scheda *General*: hostname `checkmage`, nome utente (es. `gioco`) e password, fuso orario `Europe/Rome`, tastiera
     `it`;
   - scheda *Services*: **Enable SSH** → *Allow public-key authentication only*, e incolla la riga `ssh-ed25519 …`.
4. Salva, conferma e aspetta la scrittura. Collega l'SSD (o la microSD), il **cavo di rete** e l'alimentatore. Il Pi 5
   si avvia da solo; da un SSD USB parte da solo se non c'è una microSD.
5. Trova l'IP locale del Pi nella pagina del router, nell'elenco dei dispositivi connessi (nome `checkmage`).

---

## 5. Preparare il computer a restare sempre acceso

### 5.1 Un IP locale che non cambia

Nella pagina del router cerca **Prenotazione DHCP**, *DHCP statico*, *Static lease* o *Indirizzi riservati*
(dipende dal modello). Associa il dispositivo `checkmage` al suo IP attuale e salva. Così l'IP locale non cambia mai,
e i comandi `ssh` di questa guida continuano a funzionare.

### 5.2 Riaccensione automatica dopo un blackout

- **Mini PC**: entra nel BIOS all'accensione (di solito **F1**, **F2** o **Canc**) e cerca **After Power Loss**,
  *AC Recovery* o *Restore on AC Power Loss*. Impostala su **Power On**, poi salva (**F10**).
- **Raspberry Pi**: si riaccende da solo quando torna la corrente.

### 5.3 Niente sospensione

Collegati in SSH (vedi il passo 6) ed esegui:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Se il server è un **portatile**, fai in modo che chiudere il coperchio non lo spenga:

```bash
sudo mkdir -p /etc/systemd/logind.conf.d
echo -e "[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore" | sudo tee /etc/systemd/logind.conf.d/lid.conf
sudo systemctl restart systemd-logind
```

---

## 6. Accesso SSH e firewall

Da PowerShell sul PC Windows (cambia utente e IP con i tuoi):

```powershell
ssh gioco@192.168.1.23
```

Rispondi `yes` alla prima domanda. Se la chiave non era stata importata durante l'installazione, entra con la password
e poi, **da PowerShell sul PC**, copia la chiave sul server:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | ssh gioco@192.168.1.23 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Da ora `ssh gioco@192.168.1.23` entra senza password.

> Rispetto alla guida VPS qui non sei `root`: i comandi di sistema iniziano con **`sudo`**, che chiede la password del
> tuo utente, e la cartella di casa è `/home/gioco` invece di `/root`.

**Aggiorna il sistema:**

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

**Firewall.** Col tunnel non serve aprire nessuna porta verso internet. Lasciamo entrare solo SSH, e solo dalla rete
di casa. Se il tuo IP locale è `192.168.1.x`, la rete è `192.168.1.0/24`; se è `192.168.0.x`, è `192.168.0.0/24`, e
così via.

```bash
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw enable
```

Rispondi `y`. **Cosa devi vedere** con `sudo ufw status`: `Status: active` e la regola per la porta 22 dalla tua
rete.

**Aggiornamenti automatici di sicurezza:** come al [passo 5.4 della guida VPS](DEPLOY.md#54-aggiornamenti-di-sicurezza-automatici),
aggiungendo `sudo` davanti ai comandi.

---

## 7. Docker e progetto

1. **Docker**: segui il [passo 6 della guida VPS](DEPLOY.md#6-installare-docker), con `sudo` davanti a `sh`:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   ```

   Poi permetti al tuo utente di usare Docker senza `sudo`:

   ```bash
   sudo usermod -aG docker $USER
   ```

   **Esci** (`exit`) e **rientra** con `ssh`: la modifica vale dal nuovo accesso. Verifica con `docker run --rm hello-world`.
2. **Progetto**: segui il [passo 7 della guida VPS](DEPLOY.md#7-scaricare-il-progetto-sulla-vps). È identico: il
   progetto finisce in `~/check-mage`, cioè `/home/gioco/check-mage`.

---

## 8. Il dominio su Cloudflare

Per il tunnel il dominio deve essere **gestito da Cloudflare**, cioè il suo DNS deve stare su Cloudflare.

- **Non hai ancora un dominio?** Crea un account su **dash.cloudflare.com** e compralo da lì: *Domain Registration* →
  *Register Domains*. È già pronto.
- **L'hai comprato altrove** (Aruba, Namecheap…)?
  1. Su dash.cloudflare.com: **Add a domain** (o *Add a site*), scrivi il dominio, scegli il piano **Free**.
  2. Cloudflare ti mostra due **nameserver**, tipo `anna.ns.cloudflare.com` e `bob.ns.cloudflare.com`.
  3. Nel pannello del tuo registrar cerca **Nameserver** (o *DNS personalizzati*), sostituisci quelli esistenti con i
     due di Cloudflare e salva.
  4. Aspetta l'email di Cloudflare con scritto che il dominio è **Active**: da pochi minuti fino a 24 ore.

**Cosa devi vedere:** su dash.cloudflare.com il dominio compare con lo stato **Active**.

---

## 9. Creare il tunnel

1. Su dash.cloudflare.com apri **Zero Trust** dal menu a sinistra.
   - La prima volta ti chiede un **nome del team** (uno qualsiasi, es. `checkmage`) e un piano: scegli **Free**. Può
     chiedere una carta anche per il piano gratuito, senza addebiti.
2. Vai in **Networks** → **Tunnels** (in alcune versioni del pannello: *Networks → Connectors → Cloudflare Tunnels*) e
   premi **Create a tunnel**.
3. Scegli **Cloudflared**, dai il nome `checkmage` e salva.
4. Nella pagina *Install and run a connector* scegli **Docker**. Compare un comando tipo:

   ```
   docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoi…
   ```

   **Non eseguirlo.** Copia solo la parte dopo `--token ` (una stringa lunghissima che inizia con `eyJ`): è il tuo
   `CLOUDFLARE_TUNNEL_TOKEN`. Trattala come una password. Premi **Next**.
5. Aggiungi le due **rotte** (si chiamano *Public hostnames*, o *Published application routes*):

   | Subdomain | Domain | Path | Service Type | URL |
   |---|---|---|---|---|
   | *(vuoto)* | `tuodominio.it` | *(vuoto)* | `HTTP` | `caddy:80` |
   | `api` | `tuodominio.it` | *(vuoto)* | `HTTP` | `caddy:80` |

   Il tipo è proprio **HTTP**, non HTTPS, e l'URL è **`caddy:80`**, non `localhost`. Salva la prima rotta, poi aggiungi
   la seconda con *Add a public hostname*.
   Se Cloudflare dice che esiste già un record DNS per quel nome (per esempio da una prova con la VPS), cancellalo in
   *DNS → Records* e riprova.
6. Nel pannello del dominio (non in Zero Trust) vai in **SSL/TLS** → **Edge Certificates** e attiva **Always Use
   HTTPS**.

**Cosa devi vedere:** il tunnel `checkmage` nell'elenco, per ora con stato *Inactive* o *Down*: si accenderà al
passo 11. In *DNS → Records* compaiono due record `CNAME` (il dominio e `api`) che puntano a `….cfargotunnel.com`.

---

## 10. Configurare i valori

Come al [passo 8 della guida VPS](DEPLOY.md#8-configurare-i-cinque-valori), con due righe in più.

```bash
cd ~/check-mage/deploy
cp .env.example .env
nano .env
```

Compila:

```ini
APP_DOMAIN=tuodominio.it
API_DOMAIN=api.tuodominio.it
ACME_EMAIL=latuaemail@esempio.it
DB_PASSWORD=la-stringa-di-openssl-rand-hex-24
JWT_SECRET=la-stringa-di-openssl-rand-hex-32

COMPOSE_FILE=docker-compose.yml:docker-compose.home.yml
CLOUDFLARE_TUNNEL_TOKEN=eyJ…il-token-del-passo-9
```

- Le ultime due righe sono già nel file, commentate: togli il `#` all'inizio.
- `COMPOSE_FILE` attiva la variante per casa. Senza, Docker proverebbe ad aprire le porte 80 e 443 e a chiedere i
  certificati da solo, come sulla VPS.
- `ACME_EMAIL` qui non viene usata (i certificati li fa Cloudflare), ma il file la chiede: metti comunque la tua email.

Salva con **Ctrl+O**, **Invio**, ed esci con **Ctrl+X**.

---

## 11. Avviare e provare

```bash
cd ~/check-mage/deploy
docker compose up -d --build
```

La prima volta ci vogliono 5–10 minuti; su un Raspberry anche 15–20.

**Controlla i container:**

```bash
docker compose ps
```

**Cosa devi vedere:** **quattro** righe `Up`: `caddy`, `cloudflared`, `db` (con `healthy`) e `server`. Nella colonna
delle porte di `caddy` **non** devono comparire `0.0.0.0:80` o `0.0.0.0:443`.

**Controlla il tunnel:**

```bash
docker compose logs cloudflared | grep -i "registered tunnel connection"
```

**Cosa devi vedere:** alcune righe (di solito 4) *Registered tunnel connection*. Nel pannello Zero Trust il tunnel ora è
**Healthy**, in verde.

**La prova vera:** come al [passo 9.3 della guida VPS](DEPLOY.md#93-la-prova-vera). Apri
`https://api.tuodominio.it/status`, poi `https://tuodominio.it`, registra due utenti da due browser e gioca.

---

## 12. Aggiornamenti e backup

Funzionano esattamente come sulla VPS, perché `COMPOSE_FILE` in `deploy/.env` fa usare agli script la variante giusta:

- **aggiornare**: [passo 10 della guida VPS](DEPLOY.md#10-aggiornare-dopo-una-modifica), `~/check-mage/deploy/update.sh`;
- **backup e ripristino**: [passo 11 della guida VPS](DEPLOY.md#11-backup-del-database). Nella riga del `cron` usa il
  tuo percorso:

  ```
  0 3 * * * /home/gioco/check-mage/deploy/backup.sh >> /home/gioco/check-mage/deploy/backups/backup.log 2>&1
  ```

**Importante a casa:** un backup che sta sullo stesso computer non ti salva se si rompe il disco. Tieni una copia
**fuori** dal server, almeno una volta alla settimana:
- sul PC Windows, con `scp` come al [passo 11.3 della guida VPS](DEPLOY.md#113-tenere-una-copia-sul-pc) (utente `gioco`
  invece di `root`, percorso `/home/gioco/...`);
- oppure su un disco USB collegato al server.

---

## 13. Facoltativo: gestire il server da fuori casa

Il firewall permette SSH solo dalla rete di casa. Per entrare anche da fuori, senza aprire porte, usa **Tailscale**
(gratis per uso personale): crea una rete privata fra i tuoi dispositivi.

1. Crea un account su **tailscale.com** e installa l'app sul PC Windows.
2. Sul server:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

   Apri il link che compare e accedi con lo stesso account.
3. Nell'app Tailscale sul PC vedrai `checkmage` con un indirizzo `100.x.y.z`. Da fuori casa: `ssh gioco@100.x.y.z`.
4. Permetti SSH anche dalla rete Tailscale:

   ```bash
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   ```

---

## 14. Problemi comuni

Valgono anche quelli della [guida VPS](DEPLOY.md#13-problemi-comuni), tranne quelli sui certificati di Let's Encrypt.
In più:

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| Il pannello dice che il tunnel è **Inactive** o **Down** | `cloudflared` non è acceso o il token è sbagliato | `docker compose ps` e `docker compose logs cloudflared`. Se vedi *Unauthorized* o *invalid token*, ricopia il token (passo 9.4) in `deploy/.env`, poi `docker compose up -d` |
| Pagina di Cloudflare **Error 1033** | Il tunnel non è collegato: server spento, niente internet a casa, `cloudflared` fermo | Controlla che il computer sia acceso e online, poi la riga sopra |
| Pagina di Cloudflare **502 Bad Gateway** | Il tunnel è collegato ma non raggiunge Caddy | Nelle rotte (passo 9.5) il servizio deve essere `HTTP` e `caddy:80`. Verifica anche che `caddy` sia `Up` |
| `docker compose ps` mostra solo tre container, senza `cloudflared` | Manca `COMPOSE_FILE` in `deploy/.env`, o ha ancora il `#` davanti | Correggi `.env`, poi `docker compose up -d` |
| Errore *Manca CLOUDFLARE_TUNNEL_TOKEN* | Token non compilato | Passo 10 |
| Errore sulla parola `!reset` o *unknown tag* | Docker Compose troppo vecchio | `sudo apt update && sudo apt install --only-upgrade docker-compose-plugin`, oppure rilancia lo script del passo 7 |
| Il sito non risponde dopo un blackout | Il computer non si è riacceso | Passo 5.2 (BIOS). Poi `docker compose ps`: i container ripartono da soli |
| Il server "sparisce" dopo un po' | È andato in sospensione | Passo 5.3 |
| Non riesci più a entrare in SSH | L'IP locale è cambiato, o sei fuori casa | Guarda l'IP nel router e fai la prenotazione DHCP (passo 5.1); da fuori usa Tailscale (passo 13) |
| Registrazioni ripetute rifiutate con "troppe richieste" per tutti | Il server vede un unico IP per tutti | Verifica che `deploy/caddy/Caddyfile.home` sia montato: `docker compose exec caddy head -5 /etc/caddy/Caddyfile` deve mostrare `auto_https off` |

Una nota sulle partite: Cloudflare chiude le connessioni inattive dopo 100 secondi, ma il server manda un segnale ogni
54 secondi, quindi le partite non vengono interrotte.

---

## 15. Passare da casa alla VPS, o viceversa

I dati stanno tutti nel database: basta un backup.

1. Sulla macchina vecchia: `~/check-mage/deploy/backup.sh`, poi copia il file sul PC con `scp`.
2. Prepara la macchina nuova seguendo la sua guida fino a "Configurare i valori", usando **lo stesso `JWT_SECRET`**:
   così nessuno deve rifare il login. Avvia con `docker compose up -d --build`.
3. Copia il backup sulla macchina nuova e ripristinalo con `restore.sh` (passo 11.4 della guida VPS).
4. Sposta il dominio:
   - **da casa alla VPS**: su Cloudflare cancella le due rotte del tunnel (e i record `CNAME` in *DNS → Records*), poi
     aggiungi i due record `A` verso l'IP della VPS come al [passo 4 della guida VPS](DEPLOY.md#4-collegare-il-dominio-alla-vps),
     con la nuvola **grigia**. Sulla VPS, in `deploy/.env`, **non** mettere `COMPOSE_FILE` né il token;
   - **dalla VPS a casa**: cancella i record `A` e crea il tunnel (passo 9).
5. Spegni la macchina vecchia: `cd ~/check-mage/deploy && docker compose down`.

---

## Riferimenti tecnici

- `deploy/docker-compose.home.yml` si aggiunge a `docker-compose.yml` tramite `COMPOSE_FILE`:
  - toglie le porte pubbliche di Caddy (`ports: !reset []`, serve Compose 2.24 o più recente);
  - monta `deploy/caddy/Caddyfile.home`;
  - aggiunge `cloudflared` col token da `CLOUDFLARE_TUNNEL_TOKEN`.
- `deploy/caddy/Caddyfile.home` serve in HTTP (`auto_https off`) e, con `trusted_proxies static private_ranges`,
  conserva l'`X-Forwarded-For` di Cloudflare. Il server si fida della rete Docker (`TRUSTED_PROXIES=172.28.0.0/16`) e
  legge così l'IP vero per il rate limit.
- Le origini ammesse (`CORS_ALLOWED_ORIGINS`, anche per il WebSocket) restano `https://APP_DOMAIN` più quelle
  dell'app Android: dal punto di vista del browser il sito è comunque in HTTPS.
