package game

import (
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/gameerr"
	"chess-server/internal/logger"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Valori di Board.Status. "active" è l'unico stato non terminale.
const (
	StatusActive    = "active"
	StatusCheckmate = "checkmate"
	StatusStalemate = "stalemate"
	StatusDraw      = "draw"      // 50 mosse, materiale insufficiente, ripetizione, accordo
	StatusResigned  = "resigned"  // un giocatore ha abbandonato
	StatusTimeout   = "timeout"   // tempo scaduto
	StatusAbandoned = "abandoned" // un giocatore non si è riconnesso in tempo
)

// NullMove è la mossa registrata in Board.Moves quando una mossa viene consumata
// senza spostare pezzi (cattura assorbita da uno scudo). Nel PGN diventa "--".
const NullMove = "0000"

// Room rappresenta una partita in corso tra due giocatori
type Room struct {
	ID                string
	White             *Client
	Black             *Client
	Board             *Board              // stato della scacchiera (scacchi puri)
	Match             *match.State        // orchestrazione fasi/turno (scacchi + magie)
	Tracker           *effects.Tracker    // identità pezzi + effetti persistenti (freeze/shield)
	WhiteTime         time.Duration       // tempo rimanente bianco
	BlackTime         time.Duration       // tempo rimanente nero
	BaseTime          time.Duration       // tempo iniziale per giocatore (time control)
	Increment         time.Duration       // incremento per mossa (es. 5 secondi)
	timerStop         chan struct{}       // canale per fermare il timer
	drawOfferer       *Client             // chi ha offerto la patta (nil se nessuna offerta)
	disconnectedTimer map[int]*time.Timer // userID -> timer di disconnessione
	posCounts         map[string]int      // FEN normalizzata -> occorrenze (tripla ripetizione)
	timerStarted      bool                // il timer è già in esecuzione? (room ripristinate partono dormienti)
	ended             bool                // la partita è conclusa: nessuna azione è più accettata
	mu                sync.Mutex          // protegge lo stato durante il timer

	// Persistenza dei match live: le scritture partono in goroutine, quindi
	// vanno ordinate (uno snapshot vecchio non sovrascrive uno nuovo) e nessuna
	// deve arrivare dopo la rimozione della partita conclusa.
	persistSeq uint64     // progressivo dell'ultimo snapshot preparato (sotto mu)
	persistMu  sync.Mutex // serializza le scritture su live_matches
	savedSeq   uint64     // ultimo snapshot scritto (sotto persistMu)
	persistOff bool       // partita rimossa da live_matches (sotto persistMu)
}

// Board rappresenta lo stato della partita
type Board struct {
	FEN    string   `json:"fen"`    // FEN = notazione standard per lo stato della board
	Moves  []string `json:"moves"`  // mosse UCI giocate ("0000" = mossa assorbita da uno scudo)
	Turn   string   `json:"turn"`   // "white" o "black"
	Status string   `json:"status"` // vedi le costanti Status*
}

func NewRoom(id string, white, black *Client, baseTime, increment time.Duration) *Room {
	room := &Room{
		ID:    id,
		White: white,
		Black: black,
		Board: &Board{
			// FEN iniziale = posizione di partenza degli scacchi
			FEN:    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
			Moves:  []string{},
			Turn:   "white",
			Status: StatusActive,
		},
		Match:             match.New(time.Now().UnixNano()), // draw / turno 1 / Bianco, mazzi mischiati
		WhiteTime:         baseTime,
		BlackTime:         baseTime,
		BaseTime:          baseTime,
		Increment:         increment,
		timerStop:         make(chan struct{}),
		disconnectedTimer: make(map[int]*time.Timer),
		posCounts:         make(map[string]int),
	}
	room.Tracker = effects.NewTracker(room.Board.FEN) // identità pezzi per gli effetti
	room.recordPosition()                             // conta la posizione iniziale (tripla ripetizione)

	white.Room = room
	black.Room = room

	// Manda lo stato iniziale con i tempi, la fase e l'identità dei giocatori
	room.broadcastState()

	// Manda a ciascun giocatore la propria mano iniziale (anti-cheat: solo la sua)
	room.sendHand(match.PlayerWhite)
	room.sendHand(match.PlayerBlack)

	// La fase draw del 1° turno passa da sola (e la main1 se il Bianco non può
	// castare): il Bianco parte già nella prima fase che richiede input.
	for _, res := range room.Match.AutoAdvance() {
		room.applyAdvanceBroadcasts(res)
	}

	// Avvia il timer per il bianco (inizia sempre lui)
	room.ensureTimer()

	// Salva subito lo stato iniziale (persistenza dei match live)
	room.persist()

	return room
}

// ensureTimer avvia il timer della partita se non è già in esecuzione. Le room
// ripristinate dal DB partono dormienti e avviano il timer al primo reconnect
// (il tempo scorre solo mentre il timer gira, quindi il downtime non consuma
// tempo). Va chiamata con r.mu tenuto (o in fase di init single-thread).
func (r *Room) ensureTimer() {
	if r.timerStarted || r.ended {
		return
	}
	if r.timerStop == nil {
		r.timerStop = make(chan struct{})
	}
	r.timerStarted = true
	go r.runTimer()
}

// stopTimer ferma il timer della partita senza terminarla (usato allo shutdown,
// prima di persistere).
func (r *Room) stopTimer() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closeTimerLocked()
}

// closeTimerLocked chiude timerStop una sola volta. Va invocata con r.mu tenuto.
func (r *Room) closeTimerLocked() {
	if r.timerStop == nil {
		return
	}
	select {
	case <-r.timerStop: // già chiuso
	default:
		close(r.timerStop)
	}
}

// isActive indica se la partita è ancora in corso.
func (r *Room) isActive() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return !r.ended && r.Board.Status == StatusActive
}

// roomSnapshot è lo stato serializzabile completo di una partita in corso, per
// la persistenza in DB e il ripristino al riavvio del server.
type roomSnapshot struct {
	RoomID      string                    `json:"room_id"`
	WhiteID     int                       `json:"white_id"`
	BlackID     int                       `json:"black_id"`
	WhiteName   string                    `json:"white_name"`
	BlackName   string                    `json:"black_name"`
	FEN         string                    `json:"fen"`
	Moves       []string                  `json:"moves"`
	Turn        string                    `json:"turn"`
	Status      string                    `json:"status"`
	WhiteTimeMs int64                     `json:"white_time_ms"`
	BlackTimeMs int64                     `json:"black_time_ms"`
	BaseTimeMs  int64                     `json:"base_time_ms,omitempty"`
	IncrementMs int64                     `json:"increment_ms"`
	Match       match.Snapshot            `json:"match"`
	Effects     []effects.PieceEffectInfo `json:"effects"`
	PosCounts   map[string]int            `json:"pos_counts"`
}

// buildSnapshot cattura lo stato corrente. Va invocata con r.mu tenuto (o in
// fase di init).
func (r *Room) buildSnapshot() roomSnapshot {
	return roomSnapshot{
		RoomID:      r.ID,
		WhiteID:     r.White.UserID,
		BlackID:     r.Black.UserID,
		WhiteName:   r.White.Username,
		BlackName:   r.Black.Username,
		FEN:         r.Board.FEN,
		Moves:       r.Board.Moves,
		Turn:        r.Board.Turn,
		Status:      r.Board.Status,
		WhiteTimeMs: r.WhiteTime.Milliseconds(),
		BlackTimeMs: r.BlackTime.Milliseconds(),
		BaseTimeMs:  r.BaseTime.Milliseconds(),
		IncrementMs: r.Increment.Milliseconds(),
		Match:       r.Match.Snapshot(),
		Effects:     r.Tracker.ActiveEffects(),
		PosCounts:   r.posCounts,
	}
}

// persist salva lo stato in modo asincrono (best-effort). Va invocata con r.mu
// tenuto: costruisce e serializza lo snapshot sotto lock, poi scrive in DB in
// background. Una partita conclusa non viene più salvata.
func (r *Room) persist() {
	if db.DB == nil || r.ended {
		return // DB non configurato (es. nei test) o partita finita
	}
	snap := r.buildSnapshot()
	data, err := json.Marshal(snap)
	if err != nil {
		logger.L.Warn("Serializzazione match live fallita", zap.String("room", r.ID), zap.Error(err))
		return
	}
	r.persistSeq++
	seq := r.persistSeq
	go func() {
		if err := r.writeSnapshot(seq, snap.WhiteID, snap.BlackID, data); err != nil {
			logger.L.Warn("Salvataggio match live fallito", zap.String("room", r.ID), zap.Error(err))
		}
	}()
}

// persistSync salva lo stato in modo sincrono (usato allo shutdown). Prende il
// lock da sé.
func (r *Room) persistSync() error {
	if db.DB == nil {
		return nil
	}
	r.mu.Lock()
	if r.ended {
		r.mu.Unlock()
		return nil
	}
	snap := r.buildSnapshot()
	data, err := json.Marshal(snap)
	r.persistSeq++
	seq := r.persistSeq
	r.mu.Unlock()
	if err != nil {
		return err
	}
	return r.writeSnapshot(seq, snap.WhiteID, snap.BlackID, data)
}

// writeSnapshot scrive uno snapshot rispettando l'ordine: uno snapshot più
// vecchio dell'ultimo scritto, o arrivato dopo la rimozione della partita, viene
// scartato (altrimenti una partita finita potrebbe ricomparire al riavvio).
func (r *Room) writeSnapshot(seq uint64, whiteID, blackID int, data []byte) error {
	r.persistMu.Lock()
	defer r.persistMu.Unlock()
	if r.persistOff || seq <= r.savedSeq {
		return nil
	}
	if err := db.SaveLiveMatch(r.ID, whiteID, blackID, data); err != nil {
		return err
	}
	r.savedSeq = seq
	return nil
}

// removeLiveMatch cancella la partita da live_matches e blocca le scritture
// successive.
func (r *Room) removeLiveMatch() {
	r.persistMu.Lock()
	defer r.persistMu.Unlock()
	r.persistOff = true
	if err := db.DeleteLiveMatch(r.ID); err != nil {
		logger.L.Warn("Errore rimozione match live", zap.String("room", r.ID), zap.Error(err))
	}
}

// placeholderClient crea un client "segnaposto" (senza connessione) per una room
// ripristinata dal DB: conserva UserID/Username finché il vero client non si
// riconnette. Il buffer permette i broadcast senza bloccare (trySend scarta).
func placeholderClient(userID int, username string) *Client {
	return &Client{
		UserID:   userID,
		Username: username,
		Send:     make(chan []byte, 256),
	}
}

// roomFromSnapshot ricostruisce una room dormiente dallo stato persistito. Non
// avvia il timer né fa broadcast: il timer parte al primo reconnect.
func roomFromSnapshot(snap roomSnapshot) *Room {
	baseTime := time.Duration(snap.BaseTimeMs) * time.Millisecond
	if baseTime == 0 && config.C != nil {
		baseTime = config.C.DefaultBaseTime // snapshot salvati prima del campo base_time_ms
	}
	room := &Room{
		ID:    snap.RoomID,
		White: placeholderClient(snap.WhiteID, snap.WhiteName),
		Black: placeholderClient(snap.BlackID, snap.BlackName),
		Board: &Board{
			FEN:    snap.FEN,
			Moves:  snap.Moves,
			Turn:   snap.Turn,
			Status: snap.Status,
		},
		Match:             match.FromSnapshot(snap.Match),
		WhiteTime:         time.Duration(snap.WhiteTimeMs) * time.Millisecond,
		BlackTime:         time.Duration(snap.BlackTimeMs) * time.Millisecond,
		BaseTime:          baseTime,
		Increment:         time.Duration(snap.IncrementMs) * time.Millisecond,
		timerStop:         make(chan struct{}),
		disconnectedTimer: make(map[int]*time.Timer),
		posCounts:         snap.PosCounts,
	}
	if room.posCounts == nil {
		room.posCounts = make(map[string]int)
	}
	if room.Board.Moves == nil {
		room.Board.Moves = []string{}
	}
	// Ricostruisci l'identità dei pezzi dalla FEN, poi riapplica gli effetti.
	room.Tracker = effects.NewTracker(snap.FEN)
	for _, e := range snap.Effects {
		room.Tracker.RestoreEffect(e.Square, e.Effects)
	}
	room.White.Room = room
	room.Black.Room = room
	return room
}

// normalizeFEN tiene solo i campi rilevanti per la ripetizione (posizione,
// lato al tratto, arrocchi, en passant), scartando i contatori di mosse.
func normalizeFEN(fen string) string {
	fields := strings.Fields(fen)
	if len(fields) >= 4 {
		return strings.Join(fields[:4], " ")
	}
	return fen
}

// recordPosition registra la posizione corrente per la regola della tripla
// ripetizione. Va chiamata dopo ogni cambio di Board.FEN, con r.mu tenuto.
func (r *Room) recordPosition() {
	if r.posCounts == nil {
		r.posCounts = make(map[string]int)
	}
	r.posCounts[normalizeFEN(r.Board.FEN)]++
}

// isThreefold indica se la posizione corrente è comparsa almeno 3 volte.
func (r *Room) isThreefold() bool {
	return r.posCounts[normalizeFEN(r.Board.FEN)] >= 3
}

// errGameOver è l'errore restituito a chi agisce su una partita conclusa.
func errGameOver() error {
	return gameerr.New(gameerr.GameOver, "La partita è terminata")
}

// HandleMessage smista i messaggi ricevuti dai client
func (r *Room) HandleMessage(sender *Client, msg models.WSMessage) {
	switch msg.Type {

	case models.MsgMove:
		var moveData struct {
			Move string `json:"move"` // mossa UCI, es. "e2e4" o "e7e8q"
		}
		if err := json.Unmarshal(msg.Payload, &moveData); err != nil {
			sender.sendErr(gameerr.New(gameerr.InvalidPayload, "Formato mossa non valido"))
			return
		}
		r.handleMove(sender, moveData.Move)

	case models.MsgPassPhase:
		r.handlePassPhase(sender)

	case models.MsgCastSpell:
		var spellData struct {
			SpellID string   `json:"spell_id"`
			Targets []string `json:"targets"`
		}
		if err := json.Unmarshal(msg.Payload, &spellData); err != nil {
			sender.sendErr(gameerr.New(gameerr.InvalidPayload, "Formato cast_spell non valido"))
			return
		}
		r.handleCastSpell(sender, spellData.SpellID, spellData.Targets)

	case models.MsgResign:
		r.handleResign(sender)

	case models.MsgDrawOffer:
		r.handleDrawOffer(sender)

	case models.MsgDrawAccepted:
		r.handleDrawResponse(sender, true)

	case models.MsgDrawDeclined:
		r.handleDrawResponse(sender, false)

	default:
		sender.sendErr(gameerr.Newf(gameerr.UnknownMessageType, "Tipo messaggio sconosciuto: %s", msg.Type).
			With("type", msg.Type))
	}
}

// captureSquare restituisce la casella del pezzo catturato dalla mossa (già
// validata come legale), oppure "" se la mossa non cattura. Per l'en passant è
// la casella del pedone catturato, non quella d'arrivo.
func captureSquare(fen, from, to string) string {
	if p, err := effects.PieceAt(fen, to); err == nil && p != 0 {
		return to
	}
	if p, err := effects.PieceAt(fen, from); err == nil && (p == 'P' || p == 'p') && from[0] != to[0] {
		return string(to[0]) + string(from[1])
	}
	return ""
}

func (r *Room) handleMove(sender *Client, move string) {
	r.mu.Lock()

	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	senderColor := r.getColor(sender)
	if senderColor != r.Board.Turn {
		r.mu.Unlock()
		sender.sendErr(gameerr.New(gameerr.NotYourTurn, "Non è il tuo turno"))
		return
	}

	if r.Match.CurrentPhase != phase.PhaseMove {
		r.mu.Unlock()
		sender.sendErr(gameerr.Newf(gameerr.WrongPhase, "Non puoi muovere nella fase %s", r.Match.CurrentPhase).
			With("phase", r.Match.CurrentPhase))
		return
	}

	if len(move) < 4 || !engine.SF.IsMoveLegal(r.Board.FEN, move) {
		r.mu.Unlock()
		sender.sendErr(gameerr.Newf(gameerr.IllegalMove, "Mossa illegale: %s", move).With("move", move))
		return
	}

	from, to := move[:2], move[2:4]

	// Effetto freeze: un pezzo congelato non può muoversi.
	if r.Tracker.IsFrozen(from) {
		r.mu.Unlock()
		sender.sendErr(gameerr.Newf(gameerr.PieceFrozen, "Il pezzo in %s è congelato", from).With("square", from))
		return
	}

	// Effetto shield: se la mossa cattura un pezzo protetto (anche en passant),
	// lo scudo assorbe il colpo — il pezzo sopravvive — ma la mossa
	// dell'attaccante è comunque consumata (il turno passa). Nessun pezzo si
	// sposta. Eccezione: se la mossa nulla lascerebbe sotto scacco il re
	// dell'attaccante (la cattura era l'unico modo di uscire dallo scacco), la
	// posizione sarebbe illegale, quindi lo scudo si rompe e la cattura avviene.
	captured := captureSquare(r.Board.FEN, from, to)
	shieldAbsorbed := captured != "" && r.Tracker.HasShield(captured)
	if shieldAbsorbed && effects.IsKingAttacked(effects.PassTurn(r.Board.FEN), effects.Color(senderColor)) {
		shieldAbsorbed = false
		logger.L.Info("Scudo rotto: la cattura risolve uno scacco",
			zap.String("room", r.ID), zap.String("square", captured))
	}

	// Il tempo scorre in tempo reale in runTimer (keyato su match.ActivePlayer);
	// qui aggiungiamo solo l'incremento per la mossa completata.
	if senderColor == "white" {
		r.WhiteTime += r.Increment
	} else {
		r.BlackTime += r.Increment
	}

	if shieldAbsorbed {
		// Nessun pezzo si muove: consuma lo scudo e passa il turno (null move
		// sulla FEN: cambia solo il lato al tratto).
		r.Tracker.ConsumeShield(captured)
		r.Board.FEN = effects.PassTurn(r.Board.FEN)
		r.Board.Moves = append(r.Board.Moves, NullMove)
	} else {
		r.Board.Moves = append(r.Board.Moves, move)
		// La FEN è la fonte di verità (le magie possono editarla fuori dalle mosse).
		r.Board.FEN = engine.SF.ApplyMove(r.Board.FEN, move)
		// Tieni allineata l'identità dei pezzi (gli effetti seguono il pezzo).
		var promo byte
		if len(move) >= 5 {
			promo = move[4]
		}
		r.Tracker.MovePiece(from, to, promo)
	}
	r.Board.Turn = sideToMove(r.Board.FEN)
	r.recordPosition()

	// Un'offerta di patta decade quando chi l'ha ricevuta gioca una mossa.
	var drawOfferExpiredFor *Client
	if r.drawOfferer != nil && r.drawOfferer.UserID != sender.UserID {
		r.drawOfferer = nil
		drawOfferExpiredFor = r.getOpponent(sender)
	}

	logger.L.Info("Mossa giocata",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
		zap.String("move", move),
		zap.Bool("shield_absorbed", shieldAbsorbed),
		zap.Duration("white_time", r.WhiteTime.Round(time.Second)),
		zap.Duration("black_time", r.BlackTime.Round(time.Second)),
	)

	status := engine.SF.GetGameStatus(r.Board.FEN)
	if status == engine.StatusOngoing && r.isThreefold() {
		status = engine.StatusDraw
	}

	var end *gameEnd
	var results []match.AdvanceResult
	var expired []effects.ExpiredEffect
	switch status {
	case engine.StatusCheckmate:
		result := models.ResultWhiteWins
		if senderColor == "black" {
			result = models.ResultBlackWins
		}
		end = r.finishLocked(result, "checkmate", StatusCheckmate)
	case engine.StatusStalemate:
		end = r.finishLocked(models.ResultDraw, "stalemate", StatusStalemate)
	case engine.StatusDraw:
		end = r.finishLocked(models.ResultDraw, "draw", StatusDraw)
	default:
		// La mossa è l'unica azione della fase move: avanza a main2, poi
		// auto-avanza (main2/draw/main1 si saltano da soli se non richiedono
		// input). Snapshot dei passaggi sotto lock, broadcast dopo.
		results = append([]match.AdvanceResult{r.Match.Advance()}, r.Match.AutoAdvance()...)
		expired = r.tickEffectsOnNewTurn(results)
		r.persist()
	}
	r.mu.Unlock()

	if shieldAbsorbed {
		// Lo scudo ha assorbito la cattura: notifica il consumo dello scudo.
		r.Broadcast(models.MsgEffectExpired, map[string]interface{}{
			"square":      captured,
			"effect_kind": effects.KindShield,
			"reason":      "shield_absorbed",
		})
	}
	if drawOfferExpiredFor != nil {
		drawOfferExpiredFor.SendMessage(models.MsgDrawDeclined, map[string]string{
			"message": sender.Username + " ha giocato una mossa: offerta di patta decaduta",
			"reason":  "move_played",
		})
	}
	// Lo stato viene inviato anche a fine partita, così i client vedono la
	// mossa decisiva prima del game_over.
	r.broadcastState()
	for _, res := range results {
		r.applyAdvanceBroadcasts(res)
	}
	r.broadcastExpired(expired)
	r.announceEnd(end)
}

// handlePassPhase gestisce il passaggio volontario alla fase successiva.
func (r *Room) handlePassPhase(sender *Client) {
	r.mu.Lock()

	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	senderColor := match.Player(r.getColor(sender))
	if !r.Match.IsActive(senderColor) {
		r.mu.Unlock()
		sender.sendErr(gameerr.New(gameerr.NotYourTurn, "Non è il tuo turno"))
		return
	}

	if !r.Match.Allows(phase.ActionPassPhase) {
		r.mu.Unlock()
		sender.sendErr(gameerr.Newf(gameerr.WrongPhase, "Non puoi passare nella fase %s", r.Match.CurrentPhase).
			With("phase", r.Match.CurrentPhase))
		return
	}

	// Passa la fase, poi auto-avanza le fasi che non richiedono input.
	results := append([]match.AdvanceResult{r.Match.Advance()}, r.Match.AutoAdvance()...)
	expired := r.tickEffectsOnNewTurn(results)
	end := r.checkRolloverGameEnd(results)
	if end == nil {
		r.persist()
	}

	logger.L.Info("Fase passata",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
		zap.String("phase", string(r.Match.CurrentPhase)),
		zap.Int("turn", r.Match.TurnNumber),
	)

	r.mu.Unlock()
	for _, res := range results {
		r.applyAdvanceBroadcasts(res)
	}
	r.broadcastExpired(expired)
	if end != nil {
		r.broadcastState()
	}
	r.announceEnd(end)
}

// handleCastSpell gestisce il gioco di una magia: il match valida turno, fase,
// carta e mana; gli effetti sulla scacchiera sono applicati da applySpellEffects.
func (r *Room) handleCastSpell(sender *Client, spellID string, targets []string) {
	r.mu.Lock()

	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	senderColor := match.Player(r.getColor(sender))
	boardChanged := false
	var drawnCards []match.DrawResult
	apply := func(def spells.Spell, t []string) ([]interface{}, error) {
		applied, changed, drawn, err := r.applySpellEffects(def, t, senderColor)
		boardChanged = changed
		drawnCards = drawn
		return applied, err
	}

	res, err := r.Match.CastSpell(senderColor, spellID, targets, apply)
	if err != nil {
		r.mu.Unlock()
		sender.sendErr(err)
		return
	}

	if boardChanged {
		r.recordPosition() // la board è cambiata: conta per la tripla ripetizione
	}
	// Dopo il cast il giocatore potrebbe essere rimasto senza mana/carte: la
	// fase main si auto-avanza di conseguenza.
	autoResults := r.Match.AutoAdvance()
	expired := r.tickEffectsOnNewTurn(autoResults)
	// Una magia che edita la board (es. Disintegrate/Teleport) può dare scacco
	// matto: se il cast chiude il turno, verifica la posizione dell'avversario.
	end := r.checkRolloverGameEnd(autoResults)
	if end == nil {
		r.persist()
	}

	logger.L.Info("Magia giocata",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
		zap.String("spell", res.Spell.ID),
		zap.Strings("targets", res.Targets),
		zap.Int("mana_after", res.ManaAfter),
	)
	// Audit: un log per ogni effetto applicato (utile per debug/bilanciamento).
	for _, e := range res.EffectsApplied {
		if m, ok := e.(map[string]interface{}); ok {
			logger.L.Info("Effetto applicato",
				zap.String("room", r.ID),
				zap.String("spell", res.Spell.ID),
				zap.Any("effect", m),
			)
		}
	}

	r.mu.Unlock()

	// spell_cast a entrambi: rivela solo la carta giocata e gli effetti applicati.
	r.Broadcast(models.MsgSpellCast, map[string]interface{}{
		"player":          senderColor,
		"spell_id":        res.Spell.ID,
		"targets":         res.Targets,
		"effects_applied": res.EffectsApplied,
	})
	r.broadcastMana(match.ManaState{Player: senderColor, Current: res.ManaAfter, Max: res.ManaMax})
	r.Broadcast(models.MsgHandSizeChanged, map[string]interface{}{
		"player": senderColor,
		"size":   res.HandSize,
	})
	// Carte pescate dall'effetto draw_card: gli ID vanno SOLO a chi le pesca.
	for _, d := range drawnCards {
		if c := r.clientOf(senderColor); c != nil {
			c.SendMessage(models.MsgCardDrawn, map[string]interface{}{
				"card_id":   d.CardID,
				"deck_size": d.DeckSize,
			})
		}
	}
	// Se un effetto ha modificato la scacchiera (es. destroy_piece), risincronizza
	// lo stato (FEN aggiornata) con entrambi i client.
	if boardChanged {
		r.broadcastState()
	}
	for _, ar := range autoResults {
		r.applyAdvanceBroadcasts(ar)
	}
	r.broadcastExpired(expired)
	if end != nil && !boardChanged {
		r.broadcastState()
	}
	r.announceEnd(end)
}

// validateBoardEdit rifiuta una posizione illegale prodotta da una magia: il re
// del lato che NON ha il tratto non può essere sotto scacco. Succede, ad
// esempio, se in main1 un Teleport dà scacco o un Disintegrate rimuove il pezzo
// che copriva il re avversario: toccherebbe a chi lancia muovere con il re
// avversario già attaccato.
func validateBoardEdit(fen string) error {
	waiting := effects.SideToMove(fen).Opponent()
	if effects.IsKingAttacked(fen, waiting) {
		return gameerr.Newf(gameerr.IllegalPosition,
			"posizione illegale: il re %s resterebbe sotto scacco senza avere il tratto", waiting).
			With("king", waiting)
	}
	return nil
}

// applySpellEffects esegue gli effetti di una magia sulla board (FEN). Ritorna
// gli effetti applicati (arricchiti per il broadcast), se la board è cambiata, e
// un eventuale errore (che annulla il cast senza spendere mana). Ogni modifica
// della board è validata prima di toccare il Tracker. Va invocata con r.mu
// tenuto.
func (r *Room) applySpellEffects(def spells.Spell, targets []string, caster match.Player) ([]interface{}, bool, []match.DrawResult, error) {
	casterColor := toEffectsColor(caster)

	applied := make([]interface{}, 0, len(def.Effects))
	var drawn []match.DrawResult
	fen := r.Board.FEN
	changed := false

	missingTarget := func(expected int) error {
		return gameerr.Newf(gameerr.InvalidTargetCount, "la magia %s richiede %d bersagli", def.Name, expected).
			With("expected", expected).With("received", len(targets))
	}

	for _, eff := range def.Effects {
		switch eff.Kind {
		case spells.EffectNoop:
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})

		case spells.EffectDestroyPiece:
			if len(targets) == 0 {
				return nil, false, nil, missingTarget(1)
			}
			newFEN, destroyed, err := effects.DestroyPiece(fen, targets[0], casterColor)
			if err != nil {
				return nil, false, nil, err
			}
			if err := validateBoardEdit(newFEN); err != nil {
				return nil, false, nil, err
			}
			fen = newFEN
			changed = true
			r.Tracker.RemoveAt(targets[0]) // l'identità del pezzo distrutto sparisce
			applied = append(applied, map[string]interface{}{
				"kind":            eff.Kind,
				"target":          targets[0],
				"piece_destroyed": destroyed,
			})

		case spells.EffectFreezePiece:
			if len(targets) == 0 {
				return nil, false, nil, missingTarget(1)
			}
			turns := paramInt(eff.Params, "turns", 1)
			if err := effects.FreezePiece(r.Tracker, targets[0], casterColor, turns, def.ID); err != nil {
				return nil, false, nil, err
			}
			applied = append(applied, map[string]interface{}{
				"kind": eff.Kind, "target": targets[0], "remaining_turns": turns,
			})

		case spells.EffectShieldPiece:
			if len(targets) == 0 {
				return nil, false, nil, missingTarget(1)
			}
			turns := paramInt(eff.Params, "turns", 1)
			if err := effects.ShieldPiece(r.Tracker, targets[0], casterColor, turns, def.ID); err != nil {
				return nil, false, nil, err
			}
			applied = append(applied, map[string]interface{}{
				"kind": eff.Kind, "target": targets[0], "remaining_turns": turns,
			})

		case spells.EffectDrawCard:
			count := paramInt(eff.Params, "count", 1)
			for i := 0; i < count; i++ {
				d := r.Match.DrawFor(caster)
				if d.CardID != "" {
					drawn = append(drawn, d)
				}
			}
			applied = append(applied, map[string]interface{}{"kind": eff.Kind, "count": len(drawn)})

		case spells.EffectGainMana:
			amount := paramInt(eff.Params, "amount", 1)
			m := r.Match.GainMana(caster, amount)
			applied = append(applied, map[string]interface{}{
				"kind": eff.Kind, "amount": amount, "mana": m.Current,
			})

		case spells.EffectMovePiece:
			if len(targets) < 2 {
				return nil, false, nil, missingTarget(2)
			}
			newFEN, err := effects.MovePieceFEN(fen, targets[0], targets[1], casterColor)
			if err != nil {
				return nil, false, nil, err
			}
			// La posizione risultante non deve lasciare il proprio re sotto scacco.
			if effects.IsKingAttacked(newFEN, casterColor) {
				return nil, false, nil, gameerr.New(gameerr.IllegalPosition,
					"mossa illegale: lascerebbe il re sotto scacco").With("king", casterColor)
			}
			if err := validateBoardEdit(newFEN); err != nil {
				return nil, false, nil, err
			}
			fen = newFEN
			changed = true
			// Spostamento magico: niente semantica di arrocco/en passant.
			r.Tracker.Relocate(targets[0], targets[1])
			applied = append(applied, map[string]interface{}{
				"kind": eff.Kind, "from": targets[0], "to": targets[1],
			})

		default:
			return nil, false, nil, gameerr.Newf(gameerr.Internal, "effetto non supportato: %s", eff.Kind)
		}
	}

	if changed {
		// Una magia non passa il turno: il lato al tratto della FEN resta invariato.
		r.Board.FEN = fen
	}
	return applied, changed, drawn, nil
}

// tickEffectsOnNewTurn, se nei risultati c'è un nuovo turno, decrementa gli
// effetti del giocatore che ha appena finito (così "freeze 2" dura 2 suoi turni)
// e restituisce gli effetti scaduti. Va invocata con r.mu tenuto.
func (r *Room) tickEffectsOnNewTurn(results []match.AdvanceResult) []effects.ExpiredEffect {
	for _, res := range results {
		if res.NewTurn {
			finishing := res.ActivePlayer.Opponent() // chi ha appena chiuso il turno
			return r.Tracker.TickColor(toEffectsColor(finishing))
		}
	}
	return nil
}

// checkRolloverGameEnd, dopo un rollover di turno, verifica se il nuovo
// giocatore attivo è sotto scacco matto/stallo (anche per effetto di una magia
// del turno precedente, es. Disintegrate/Teleport). Al rollover la FEN ha il
// lato al tratto del nuovo giocatore attivo, quindi GetGameStatus lo valuta
// correttamente. Se la partita è finita la conclude e ritorna l'esito da
// annunciare. Va invocata con r.mu tenuto; il chiamante chiama announceEnd dopo
// aver rilasciato il lock e fatto i broadcast.
func (r *Room) checkRolloverGameEnd(results []match.AdvanceResult) *gameEnd {
	rolled := false
	for _, res := range results {
		if res.NewTurn {
			rolled = true
			break
		}
	}
	if !rolled {
		return nil
	}

	switch engine.SF.GetGameStatus(r.Board.FEN) {
	case engine.StatusCheckmate:
		if r.Match.ActivePlayer == match.PlayerWhite {
			return r.finishLocked(models.ResultBlackWins, "checkmate", StatusCheckmate) // il Bianco è matto
		}
		return r.finishLocked(models.ResultWhiteWins, "checkmate", StatusCheckmate)
	case engine.StatusStalemate:
		return r.finishLocked(models.ResultDraw, "stalemate", StatusStalemate)
	case engine.StatusDraw:
		return r.finishLocked(models.ResultDraw, "draw", StatusDraw)
	}
	return nil
}

// broadcastExpired notifica entrambi i client degli effetti scaduti.
func (r *Room) broadcastExpired(expired []effects.ExpiredEffect) {
	for _, e := range expired {
		logger.L.Info("Effetto scaduto",
			zap.String("room", r.ID),
			zap.String("square", e.Square),
			zap.String("kind", e.Kind),
		)
		r.Broadcast(models.MsgEffectExpired, map[string]interface{}{
			"square":      e.Square,
			"effect_kind": e.Kind,
			"piece_id":    e.PieceID,
		})
	}
}

// toEffectsColor mappa il giocatore del match nel colore del package effects.
func toEffectsColor(p match.Player) effects.Color {
	if p == match.PlayerBlack {
		return effects.Black
	}
	return effects.White
}

// activeEffects restituisce gli effetti persistenti attivi (nil-safe).
func (r *Room) activeEffects() []effects.PieceEffectInfo {
	if r.Tracker == nil {
		return nil
	}
	return r.Tracker.ActiveEffects()
}

// paramInt legge un parametro intero da una mappa (gestendo int e float64).
func paramInt(params map[string]interface{}, key string, def int) int {
	if params == nil {
		return def
	}
	switch v := params[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return def
}

// applyAdvanceBroadcasts traduce un AdvanceResult in messaggi WebSocket.
// Usa lo snapshot nel risultato (non lo stato live di r.Match) perché una
// singola azione può produrre più passaggi calcolati prima del broadcast.
// Va invocato SENZA tenere il lock.
func (r *Room) applyAdvanceBroadcasts(res match.AdvanceResult) {
	r.Broadcast(models.MsgPhaseChanged, map[string]interface{}{
		"phase":         res.Phase,
		"active_player": res.ActivePlayer,
		"turn_number":   res.TurnNumber,
	})
	if !res.NewTurn {
		return
	}
	if res.Mana != nil {
		r.broadcastMana(*res.Mana)
	}
	if res.Draw != nil {
		r.broadcastDraw(*res.Draw)
	}
}

// broadcastMana notifica entrambi del nuovo mana di un giocatore (info pubblica).
func (r *Room) broadcastMana(m match.ManaState) {
	r.Broadcast(models.MsgManaChanged, map[string]interface{}{
		"player":  m.Player,
		"current": m.Current,
		"max":     m.Max,
	})
}

// broadcastDraw manda card_drawn solo a chi pesca (anti-cheat) e
// hand_size_changed a entrambi.
func (r *Room) broadcastDraw(d match.DrawResult) {
	if d.CardID != "" {
		if c := r.clientOf(d.Player); c != nil {
			c.SendMessage(models.MsgCardDrawn, map[string]interface{}{
				"card_id":   d.CardID,
				"deck_size": d.DeckSize,
			})
		}
	}
	r.Broadcast(models.MsgHandSizeChanged, map[string]interface{}{
		"player": d.Player,
		"size":   d.HandSize,
	})
}

// clientOf restituisce il client del colore dato.
func (r *Room) clientOf(p match.Player) *Client {
	if p == match.PlayerWhite {
		return r.White
	}
	return r.Black
}

// sendHand manda la mano completa (e il mana) solo al giocatore proprietario.
// Il chiamante deve tenere r.mu, oppure invocarla in fase di init.
func (r *Room) sendHand(p match.Player) {
	c := r.clientOf(p)
	if c == nil {
		return
	}
	ps := r.Match.White
	if p == match.PlayerBlack {
		ps = r.Match.Black
	}
	c.SendMessage(models.MsgHand, map[string]interface{}{
		"hand":      ps.Hand,
		"mana":      ps.Mana,
		"max_mana":  ps.MaxMana,
		"deck_size": len(ps.Deck),
	})
}

func (r *Room) Broadcast(msgType string, payload interface{}) {
	if r.White != nil {
		r.White.SendMessage(msgType, payload)
	}
	if r.Black != nil {
		r.Black.SendMessage(msgType, payload)
	}
}

// Leave gestisce la chiusura della connessione di un giocatore.
func (r *Room) Leave(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Se la partita è già finita non fare nulla
	if r.ended || r.Board.Status != StatusActive {
		return
	}

	// Una connessione già sostituita da una riconnessione (secondo tab, cambio
	// di rete) non conta come disconnessione del giocatore.
	if client != r.White && client != r.Black {
		return
	}

	opponent := r.getOpponent(client)
	logger.L.Warn("Giocatore disconnesso",
		zap.String("room", r.ID),
		zap.String("player", client.Username),
	)

	if opponent != nil {
		opponent.SendMessage(models.MsgOpponentDisconnected, map[string]string{
			"message": "L'avversario si è disconnesso, aspettando riconnessione...",
		})
	}

	// Avvia il timer d'abbandono — se non si riconnette in tempo perde
	userID := client.UserID
	if old, exists := r.disconnectedTimer[userID]; exists {
		old.Stop()
	}
	var timer *time.Timer
	timer = time.AfterFunc(config.C.ReconnectTimeout, func() {
		r.mu.Lock()
		// Il giocatore si è riconnesso (o il timer è stato sostituito) mentre
		// questa funzione aspettava il lock.
		if r.disconnectedTimer[userID] != timer {
			r.mu.Unlock()
			return
		}
		delete(r.disconnectedTimer, userID)

		result := models.ResultWhiteWins
		if r.getColor(client) == "white" {
			result = models.ResultBlackWins
		}
		end := r.finishLocked(result, "abandonment", StatusAbandoned)
		r.mu.Unlock()

		if end != nil {
			logger.L.Warn("Giocatore non si è riconnesso, partita terminata",
				zap.String("room", r.ID),
				zap.String("player", client.Username),
			)
		}
		r.announceEnd(end)
	})
	r.disconnectedTimer[userID] = timer
}

// Reconnect gestisce la riconnessione di un giocatore
func (r *Room) Reconnect(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Cancella il timer di disconnessione
	if timer, exists := r.disconnectedTimer[client.UserID]; exists {
		timer.Stop()
		delete(r.disconnectedTimer, client.UserID)
	}

	// Aggiorna il client nella room con la nuova connessione
	var replaced *Client
	if r.White != nil && r.White.UserID == client.UserID {
		replaced, r.White = r.White, client
	} else if r.Black != nil && r.Black.UserID == client.UserID {
		replaced, r.Black = r.Black, client
	}

	client.Room = r

	// Se la connessione precedente è ancora aperta (secondo tab), chiudila: non
	// deve poter continuare a giocare al posto di quella nuova.
	if replaced != nil && replaced != client && replaced.Conn != nil {
		replaced.sendErr(gameerr.New(gameerr.ReplacedByNewConnection,
			"La partita è stata ripresa da un'altra connessione"))
		replaced.closeWith(CloseReplaced, string(gameerr.ReplacedByNewConnection))
	}

	// Se la room è stata ripristinata dal DB (dormiente), avvia ora il timer.
	r.ensureTimer()

	// Avvia le goroutine per il nuovo client
	go client.WritePump()
	go client.ReadPump()

	logger.L.Info("Giocatore riconnesso",
		zap.String("room", r.ID),
		zap.String("player", client.Username),
	)

	// Manda lo stato pubblico completo al giocatore riconnesso
	state := r.publicState()
	state["reconnected"] = true
	client.SendMessage(models.MsgGameState, state)

	// Re-invia la mano privata (anti-cheat: solo la sua)
	r.sendHand(match.Player(r.getColor(client)))

	// Notifica l'avversario
	opponent := r.getOpponent(client)
	if opponent != nil {
		opponent.SendMessage(models.MsgOpponentReconnected, map[string]string{
			"message": client.Username + " si è riconnesso!",
		})
	}
}

// sideToMove ricava il colore di chi deve muovere dal 2° campo della FEN.
func sideToMove(fen string) string {
	fields := strings.Fields(fen)
	if len(fields) >= 2 && fields[1] == "b" {
		return "black"
	}
	return "white"
}

func (r *Room) getColor(client *Client) string {
	if r.White != nil && r.White.UserID == client.UserID {
		return "white"
	}
	return "black"
}

func (r *Room) getOpponent(client *Client) *Client {
	if r.White != nil && r.White.UserID == client.UserID {
		return r.Black
	}
	return r.White
}

// PGN restituisce le mosse numerate (UCI; "--" per una mossa assorbita da uno
// scudo).
func (r *Room) PGN() string {
	var sb strings.Builder
	for i, move := range r.Board.Moves {
		if i%2 == 0 {
			fmt.Fprintf(&sb, "%d. ", i/2+1)
		}
		if move == NullMove {
			move = "--"
		}
		sb.WriteString(move + " ")
	}
	return strings.TrimSpace(sb.String())
}

// TimeControl restituisce il time control nel formato "minuti+secondi" (es. "10+5").
func (r *Room) TimeControl() string {
	return strconv.FormatFloat(r.BaseTime.Minutes(), 'f', -1, 64) + "+" +
		strconv.FormatFloat(r.Increment.Seconds(), 'f', -1, 64)
}

// gameEnd è l'esito di una partita appena conclusa, catturato sotto lock e
// annunciato dopo averlo rilasciato.
type gameEnd struct {
	result, reason, winner string
	whiteID, blackID       int
	pgn, timeControl       string
}

// finishLocked conclude la partita: la segna come finita (una sola volta),
// imposta lo status terminale, ferma timer e offerte pendenti. Ritorna l'esito
// da passare ad announceEnd, oppure nil se la partita era già conclusa (così
// game_over, salvataggio ed ELO non vengono mai ripetuti). Va invocata con r.mu
// tenuto.
func (r *Room) finishLocked(result, reason, status string) *gameEnd {
	if r.ended {
		return nil
	}
	r.ended = true
	r.Board.Status = status
	r.drawOfferer = nil
	r.closeTimerLocked()
	for id, timer := range r.disconnectedTimer {
		timer.Stop()
		delete(r.disconnectedTimer, id)
	}

	end := &gameEnd{
		result:      result,
		reason:      reason,
		whiteID:     r.White.UserID,
		blackID:     r.Black.UserID,
		pgn:         r.PGN(),
		timeControl: r.TimeControl(),
	}
	switch result {
	case models.ResultWhiteWins:
		end.winner = r.White.Username
	case models.ResultBlackWins:
		end.winner = r.Black.Username
	}
	return end
}

// announceEnd manda game_over, salva la partita (ed ELO) e la rimuove dal
// manager e dai match live. Va invocata SENZA r.mu; con end nil non fa nulla.
func (r *Room) announceEnd(end *gameEnd) {
	if end == nil {
		return
	}

	// Salva nel DB in una goroutine per non bloccare
	go func() {
		if err := db.SaveGame(end.whiteID, end.blackID, end.pgn, end.result, end.timeControl); err != nil {
			logger.L.Warn("Errore salvataggio partita", zap.String("room", r.ID), zap.Error(err))
		} else {
			logger.L.Info("Partita salvata nel DB", zap.String("room", r.ID))
		}
		// La partita è finita: rimuovila dallo store dei match live.
		r.removeLiveMatch()
		GameManager.RemoveRoom(r.ID, end.whiteID, end.blackID)
	}()

	payload := map[string]string{
		"result": end.result,
		"reason": end.reason,
	}
	if end.winner != "" {
		payload["winner"] = end.winner
	}
	r.Broadcast(models.MsgGameOver, payload)
	logger.L.Info("Partita terminata",
		zap.String("room", r.ID),
		zap.String("result", end.result),
		zap.String("reason", end.reason),
	)
}

// runTimer fa scorrere in tempo reale il tempo del giocatore ATTIVO
// (match.ActivePlayer, non il lato al tratto degli scacchi) e termina la partita
// se scade. È l'unica autorità sul tempo: il tempo del giocatore attivo scorre
// per tutto il suo turno (tutte le fasi), non solo durante la mossa. Scala il
// tempo realmente trascorso, così i tick persi (lock occupato durante una
// chiamata a Stockfish) non regalano tempo.
func (r *Room) runTimer() {
	tickGame := time.NewTicker(100 * time.Millisecond)
	tickBroadcast := time.NewTicker(1 * time.Second)
	defer tickGame.Stop()
	defer tickBroadcast.Stop()

	last := time.Now()
	for {
		select {
		case <-r.timerStop:
			return

		case now := <-tickGame.C:
			elapsed := now.Sub(last)
			last = now

			r.mu.Lock()
			if r.ended {
				r.mu.Unlock()
				return
			}
			var end *gameEnd
			if r.Match.ActivePlayer == match.PlayerWhite {
				r.WhiteTime -= elapsed
				if r.WhiteTime <= 0 {
					r.WhiteTime = 0
					end = r.finishLocked(models.ResultBlackWins, "timeout", StatusTimeout)
				}
			} else {
				r.BlackTime -= elapsed
				if r.BlackTime <= 0 {
					r.BlackTime = 0
					end = r.finishLocked(models.ResultWhiteWins, "timeout", StatusTimeout)
				}
			}
			r.mu.Unlock()

			if end != nil {
				r.broadcastTimers()
				r.announceEnd(end)
				return
			}

		case <-tickBroadcast.C:
			r.broadcastTimers()
		}
	}
}

// broadcastTimers manda solo i tempi aggiornati ai client. "turn" è il giocatore
// attivo (di chi sta scorrendo il tempo), non il lato al tratto degli scacchi.
func (r *Room) broadcastTimers() {
	r.mu.Lock()
	white, black, active := r.WhiteTime.Milliseconds(), r.BlackTime.Milliseconds(), r.Match.ActivePlayer
	r.mu.Unlock()
	r.Broadcast(models.MsgTimerUpdate, map[string]interface{}{
		"white_time": white,
		"black_time": black,
		"turn":       active,
	})
}

// broadcastState manda lo stato completo inclusi i tempi. Va invocata SENZA r.mu.
func (r *Room) broadcastState() {
	r.mu.Lock()
	state := r.publicState()
	r.mu.Unlock()
	r.Broadcast(models.MsgGameState, state)
}

// playerInfo è l'identità pubblica di un giocatore in game_state.
type playerInfo struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

// publicState costruisce lo stato condiviso (nessuna identità di carta in mano:
// solo dimensioni, mana e fase — anti-cheat). Copia i dati mutabili, così il
// risultato può essere serializzato dopo aver rilasciato il lock. Va invocata
// con r.mu tenuto.
func (r *Room) publicState() map[string]interface{} {
	board := *r.Board
	board.Moves = append([]string{}, r.Board.Moves...)
	return map[string]interface{}{
		"board":        board,
		"white_player": playerInfo{ID: r.White.UserID, Username: r.White.Username},
		"black_player": playerInfo{ID: r.Black.UserID, Username: r.Black.Username},
		"time_control": map[string]int64{
			"base_ms":      r.BaseTime.Milliseconds(),
			"increment_ms": r.Increment.Milliseconds(),
		},
		"white_time":      r.WhiteTime.Milliseconds(),
		"black_time":      r.BlackTime.Milliseconds(),
		"phase":           r.Match.CurrentPhase,
		"active_player":   r.Match.ActivePlayer,
		"turn_number":     r.Match.TurnNumber,
		"white_mana":      r.Match.White.Mana,
		"white_max_mana":  r.Match.White.MaxMana,
		"black_mana":      r.Match.Black.Mana,
		"black_max_mana":  r.Match.Black.MaxMana,
		"white_hand_size": len(r.Match.White.Hand),
		"black_hand_size": len(r.Match.Black.Hand),
		"white_deck_size": len(r.Match.White.Deck),
		"black_deck_size": len(r.Match.Black.Deck),
		"active_effects":  r.activeEffects(),
	}
}

// handleResign gestisce la resa di un giocatore
func (r *Room) handleResign(sender *Client) {
	r.mu.Lock()
	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	result := models.ResultWhiteWins
	if r.getColor(sender) == "white" {
		result = models.ResultBlackWins
	}
	end := r.finishLocked(result, "resign", StatusResigned)
	r.mu.Unlock()

	logger.L.Info("Giocatore ha abbandonato",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
	)
	r.broadcastState()
	r.announceEnd(end)
}

// handleDrawOffer gestisce l'offerta di patta
func (r *Room) handleDrawOffer(sender *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.ended {
		sender.sendErr(errGameOver())
		return
	}

	// Controlla se c'è già un'offerta pendente
	if r.drawOfferer != nil {
		sender.sendErr(gameerr.New(gameerr.DrawOfferPending, "C'è già un'offerta di patta in corso"))
		return
	}

	opponent := r.getOpponent(sender)
	if opponent == nil {
		return
	}
	r.drawOfferer = sender

	logger.L.Info("Giocatore offre patta",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
	)

	// Notifica l'avversario
	opponent.SendMessage(models.MsgDrawOffer, map[string]string{
		"from": sender.Username,
	})

	// Conferma al mittente
	sender.SendMessage(models.MsgDrawOfferSent, map[string]string{
		"message": "Offerta di patta inviata",
	})
}

// handleDrawResponse gestisce l'accettazione o il rifiuto della patta
func (r *Room) handleDrawResponse(sender *Client, accepted bool) {
	r.mu.Lock()

	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	// Verifica che ci sia un'offerta pendente
	if r.drawOfferer == nil {
		r.mu.Unlock()
		sender.sendErr(gameerr.New(gameerr.NoDrawOffer, "Nessuna offerta di patta in corso"))
		return
	}

	// Solo chi ha RICEVUTO l'offerta può rispondere
	if r.drawOfferer.UserID == sender.UserID {
		r.mu.Unlock()
		sender.sendErr(gameerr.New(gameerr.OwnDrawOffer, "Non puoi rispondere alla tua stessa offerta"))
		return
	}

	r.drawOfferer = nil
	// Chi ha offerto è l'avversario di chi risponde: usa il client attuale (può
	// essersi riconnesso dopo l'offerta).
	offerer := r.getOpponent(sender)

	if accepted {
		end := r.finishLocked(models.ResultDraw, "agreement", StatusDraw)
		r.mu.Unlock()
		logger.L.Info("Patta accettata",
			zap.String("room", r.ID),
		)
		r.broadcastState()
		r.announceEnd(end)
		return
	}

	r.mu.Unlock()
	logger.L.Info("Patta rifiutata",
		zap.String("room", r.ID),
	)
	// Notifica chi aveva offerto
	if offerer != nil {
		offerer.SendMessage(models.MsgDrawDeclined, map[string]string{
			"message": sender.Username + " ha rifiutato la patta",
			"reason":  "declined",
		})
	}
}
