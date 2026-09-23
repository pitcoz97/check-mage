# Build Android

Come trasformare il client in un APK e provarlo sul telefono contro il mock. Il progetto nativo è in `android/` ed è
versionato: non serve rigenerarlo.

> Su questa macchina non sono installati JDK, Android SDK né Android Studio, quindi la build dell'APK non è mai stata
> eseguita qui. Tutto il resto (configurazione, `cap sync`, codice) è verificato.

---

## 1. Cosa installare, una volta sola

- **Android Studio** (include il JDK 21 che serve a Gradle) e, dal suo SDK Manager, **Android SDK Platform 36** e
  gli **SDK Build-Tools**. Il progetto usa `compileSdk`/`targetSdk` 36, `minSdk` 26 (`android/variables.gradle`).
- Sul telefono: **Opzioni sviluppatore → Debug USB** attivo. In alternativa va bene un emulatore con Android 8.0+.
- Solo se vuoi compilare da riga di comando senza Android Studio: un **JDK 21** con `JAVA_HOME` impostato, e le
  variabili `ANDROID_HOME`/`ANDROID_SDK_ROOT` sull'SDK.

---

## 2. Far parlare il telefono col mock

Il telefono non ha il tuo `localhost`: il client va costruito con l'indirizzo della macchina sulla rete locale.

Trova l'IP del Wi-Fi:

```bash
powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object InterfaceAlias -like 'Wi-Fi*' | Select-Object -ExpandProperty IPAddress"
```

Metti quell'indirizzo nel `.env` (esempio con `192.168.1.61`):

```bash
VITE_API_BASE_URL=http://192.168.1.61:8080
```

```bash
VITE_WS_URL=ws://192.168.1.61:8080/ws
```

Poi apri la porta 8080 in ingresso, una volta sola (da un PowerShell come amministratore):

```bash
powershell -Command "New-NetFirewallRule -DisplayName 'CheckMage mock 8080' -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow -Profile Private"
```

Telefono e PC devono stare **sulla stessa rete Wi-Fi**. Se hai una VPN attiva sul PC, il telefono probabilmente non
riuscirà a raggiungerlo: disattivala per la prova.

Il traffico è HTTP in chiaro, che Android blocca per default: il permesso è concesso **solo nella build di debug**
(`android/app/src/debug/AndroidManifest.xml`). La build di release parlerà solo HTTPS, cioè col server vero.

---

## 3. Costruire l'APK

Con il mock in esecuzione (`npm run mock`), dal progetto:

```bash
npm run android:sync
```

Compila il client (`dist/`) e lo copia nel progetto nativo. Da rifare a **ogni** modifica del client: l'APK contiene
una copia dei file, non legge il dev server.

Poi apri il progetto in Android Studio:

```bash
npm run android:open
```

Al primo avvio Gradle scarica quello che serve (qualche minuto). Quando la barra in basso è ferma, collega il
telefono e premi **Run ▶**: Android Studio installa e lancia l'app.

Se preferisci l'APK come file, da riga di comando (serve il JDK):

```bash
cd android && ./gradlew assembleDebug
```

Lo trovi in `android/app/build/outputs/apk/debug/app-debug.apk` e lo installi con
`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, oppure copiandolo sul telefono.

---

## 4. La prova che chiude lo Step 6

1. `npm run mock` sul PC, e lascialo aperto.
2. Sul PC apri `http://localhost:5173` (`npm run dev`), registra un utente e premi **Gioca**.
3. Sul telefono apri l'app, registra un **secondo** utente e premi **Gioca**: il mock accoppia i due.
4. Gioca una partita completa fino al matto o all'abbandono, lanciando qualche magia da entrambe le parti.
5. A metà partita manda l'app in background (tasto Home), aspetta una decina di secondi e riaprila: deve rientrare
   da sola nella partita, con la posizione e gli orologi giusti.

---

## 5. Quando qualcosa non va

| Sintomo | Causa probabile |
|---|---|
| Schermo scuro fisso all'avvio | `npm run android:sync` non eseguito dopo l'ultima modifica: l'app ha una `dist/` vecchia o assente. |
| "Impossibile raggiungere il server" sul telefono | IP sbagliato nel `.env`, firewall chiuso, VPN attiva, o reti Wi-Fi diverse. Prova ad aprire `http://IP:8080/status` dal browser del telefono. |
| Errore di rete solo sul telefono, il browser funziona | La build installata è di release (senza traffico in chiaro) invece che di debug. |
| L'app parte ma il login dà errore di risposta inattesa | Il mock è stato riavviato: gli utenti stanno in memoria, registra di nuovo. |
| Dopo la ripresa dal background la partita resta ferma | Sono passati più di 30 s: la finestra di rientro del server è scaduta e la partita è chiusa per abbandono. |
| Gradle si lamenta della versione di Java | Stai usando un JDK diverso da quello di Android Studio: imposta `JAVA_HOME` sul JDK 21. |

---

## 6. Dettagli della configurazione

- `capacitor.config.ts`: `appId` `com.checkmage.app` (immutabile dopo la pubblicazione), `appName` CheckMage,
  `webDir` `dist`, `androidScheme: 'https'` — così la WebView ha origine `https://localhost`, che il server accetta
  già nel CORS.
- Portrait bloccato sull'activity (`AndroidManifest.xml`), come chiede il briefing §9.
- Splash: colore pieno dello sfondo dell'app, chiusa dal client quando l'interfaccia è pronta. L'icona è il re del
  nostro set di pezzi. La grafica del template Capacitor è stata rimossa.
- Storage: su dispositivo token e lingua passano da `@capacitor/preferences` (storage di sistema), non dalla WebView.
- Alla ripresa dall'background la connessione WebSocket riparte con un ticket nuovo: su Android il socket muore in
  background senza avvisare.
- Il tasto "indietro" usa il comportamento di default di Capacitor (torna nella cronologia, esce dalla radice).
