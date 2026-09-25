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
	"sort"
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
	// Stati delle case; assenti negli snapshot precedenti allo Step 3.
	SquareEffects []effects.SquareEffectInfo `json:"square_effects,omitempty"`
}

// buildSnapshot cattura lo stato corrente. Va invocata con r.mu tenuto (o in
// fase di init).
func (r *Room) buildSnapshot() roomSnapshot {
	return roomSnapshot{
		RoomID:        r.ID,
		WhiteID:       r.White.UserID,
		BlackID:       r.Black.UserID,
		WhiteName:     r.White.Username,
		BlackName:     r.Black.Username,
		FEN:           r.Board.FEN,
		Moves:         r.Board.Moves,
		Turn:          r.Board.Turn,
		Status:        r.Board.Status,
		WhiteTimeMs:   r.WhiteTime.Milliseconds(),
		BlackTimeMs:   r.BlackTime.Milliseconds(),
		BaseTimeMs:    r.BaseTime.Milliseconds(),
		IncrementMs:   r.Increment.Milliseconds(),
		Match:         r.Match.Snapshot(),
		Effects:       r.Tracker.ActiveEffects(),
		SquareEffects: r.Tracker.SquareEffects(),
		PosCounts:     r.posCounts,
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
	// Le carte di un catalogo precedente non esistono più: si tolgono, così la
	// partita riprende senza carte che nessuno può lanciare.
	for _, ps := range []*spells.PlayerState{room.Match.White, room.Match.Black} {
		if ps == nil {
			continue
		}
		if removed := ps.DropUnknownCards(); removed > 0 {
			logger.L.Warn("Carte fuori catalogo tolte al ripristino",
				zap.String("room", room.ID), zap.Int("removed", removed))
		}
	}
	// Ricostruisci l'identità dei pezzi dalla FEN, poi riapplica gli effetti.
	room.Tracker = effects.NewTracker(snap.FEN)
	for _, e := range snap.Effects {
		room.Tracker.RestoreEffect(e.Square, e.Effects)
	}
	for _, s := range snap.SquareEffects {
		room.Tracker.RestoreSquareEffects(s.Square, s.Effects)
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
			SpellID string        `json:"spell_id"`
			Targets []string      `json:"targets"`
			Choice  spells.Choice `json:"choice"`
		}
		if err := json.Unmarshal(msg.Payload, &spellData); err != nil {
			sender.sendErr(gameerr.New(gameerr.InvalidPayload, "Formato cast_spell non valido"))
			return
		}
		r.handleCastSpell(sender, spellData.SpellID, spellData.Targets, spellData.Choice)

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

	// Stati delle case: un muro sul percorso o una cattura su un santuario.
	// Prima dello scudo: una mossa bloccata non lo consuma.
	if square, reason := effects.MoveBlock(r.Board.FEN, r.Tracker, move); reason != "" {
		r.mu.Unlock()
		sender.sendErr(gameerr.Newf(gameerr.MoveBlocked, "La mossa %s è bloccata in %s", move, square).
			With("square", square).With("reason", reason))
		return
	}

	// Effetto shield: se la mossa cattura un pezzo protetto (anche en passant),
	// lo scudo assorbe il colpo — il pezzo sopravvive — ma la mossa
	// dell'attaccante è comunque consumata (il turno passa). Nessun pezzo si
	// sposta. Eccezione: se la mossa nulla lascerebbe sotto scacco il re
	// dell'attaccante (la cattura era l'unico modo di uscire dallo scacco), la
	// posizione sarebbe illegale, quindi lo scudo si rompe e la cattura avviene.
	captured := effects.CaptureSquare(r.Board.FEN, from, to)
	var graveyards []graveyardUpdate
	var trig *runeTrigger
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
		// Il pezzo catturato (anche en passant) va nel cimitero del proprietario.
		var buried []match.Player
		if captured != "" {
			if owner, ok := r.buryCaptured(captured); ok {
				buried = append(buried, owner)
			}
		}
		fenBefore := r.Board.FEN
		r.Board.Moves = append(r.Board.Moves, move)
		// La FEN è la fonte di verità (le magie possono editarla fuori dalle mosse).
		r.Board.FEN = engine.SF.ApplyMove(r.Board.FEN, move)
		// Tieni allineata l'identità dei pezzi (gli effetti seguono il pezzo).
		var promo byte
		if len(move) >= 5 {
			promo = move[4]
		}
		r.Tracker.MovePiece(from, to, promo)
		// Una runa dell'avversario sulla casa d'arrivo: l'esito della partita si
		// calcola sulla posizione dopo la runa.
		if trig = r.triggerRune(fenBefore, move, match.Player(senderColor)); trig != nil {
			buried = append(buried, trig.graves...)
		}
		if len(buried) > 0 {
			graveyards = r.graveyardUpdates(buried)
		}
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

	status := r.gameStatus()
	if status == engine.StatusOngoing && r.isThreefold() {
		status = engine.StatusDraw
	}

	var end *gameEnd
	var results []match.AdvanceResult
	var expired []effects.ExpiredEffect
	var squares squareViews
	if trig != nil {
		squares = r.squareViewsNow() // la runa consumata sparisce dalle liste
	}
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
		var ticked squareViews
		expired, ticked = r.tickEffectsOnNewTurn(results)
		if ticked != nil {
			squares = ticked
		}
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
	if trig != nil {
		r.Broadcast(models.MsgRuneTriggered, trig)
	}
	r.broadcastGraveyards(graveyards)
	for _, res := range results {
		r.applyAdvanceBroadcasts(res)
	}
	r.broadcastExpired(expired)
	r.broadcastSquareEffects(squares)
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
	expired, squares := r.tickEffectsOnNewTurn(results)
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
	r.broadcastSquareEffects(squares)
	if end != nil {
		r.broadcastState()
	}
	r.announceEnd(end)
}

// handleCastSpell gestisce il gioco di una magia: il match valida turno, fase,
// carta e mana; gli effetti sulla scacchiera sono applicati da applySpellEffects.
func (r *Room) handleCastSpell(sender *Client, spellID string, targets []string, choice spells.Choice) {
	r.mu.Lock()

	if r.ended {
		r.mu.Unlock()
		sender.sendErr(errGameOver())
		return
	}

	senderColor := match.Player(r.getColor(sender))
	var outcome spellOutcome
	apply := func(def spells.Spell, t []string) ([]interface{}, error) {
		out, err := r.applySpellEffects(def, t, senderColor, choice)
		outcome = out
		return out.applied, err
	}

	res, err := r.Match.CastSpell(senderColor, spellID, targets, apply)
	if err != nil {
		r.mu.Unlock()
		sender.sendErr(err)
		return
	}

	boardChanged, drawnCards := outcome.changed, outcome.drawn
	graveyards := r.graveyardUpdates(outcome.graves)
	if boardChanged {
		r.recordPosition() // la board è cambiata: conta per la tripla ripetizione
	}
	// Dopo il cast il giocatore potrebbe essere rimasto senza mana/carte: la
	// fase main si auto-avanza di conseguenza.
	autoResults := r.Match.AutoAdvance()
	// Gli stati delle case creati dal cast partono prima delle scadenze del
	// rollover: il client applica le liste nell'ordine in cui arrivano.
	var castSquares squareViews
	if outcome.squares {
		castSquares = r.squareViewsNow()
	}
	expired, squares := r.tickEffectsOnNewTurn(autoResults)
	// Se il cast chiude il turno, verifica la posizione del nuovo giocatore
	// attivo (una magia può avergli tolto le mosse). Se invece chi lancia ha
	// ancora il tratto (main1) e la scacchiera o le case sono cambiate, verifica
	// la sua: un Patto di sangue o un muro possono lasciarlo senza mosse.
	end := r.checkRolloverGameEnd(autoResults)
	if end == nil && (boardChanged || outcome.squares) && sideToMove(r.Board.FEN) == string(r.Match.ActivePlayer) {
		end = r.checkActivePlayerEnd()
	}
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
	// Una magia nascosta (una runa) arriva all'avversario senza carta né
	// bersagli (M42).
	full := map[string]interface{}{
		"player":          senderColor,
		"spell_id":        res.Spell.ID,
		"targets":         res.Targets,
		"effects_applied": res.EffectsApplied,
	}
	if res.Spell.HiddenFromOpponent() {
		if c := r.clientOf(senderColor); c != nil {
			c.SendMessage(models.MsgSpellCast, full)
		}
		if c := r.clientOf(senderColor.Opponent()); c != nil {
			c.SendMessage(models.MsgSpellCast, hiddenSpellCast(senderColor))
		}
	} else {
		r.Broadcast(models.MsgSpellCast, full)
	}
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
	r.broadcastGraveyards(graveyards)
	r.broadcastSquareEffects(castSquares)
	for _, ar := range autoResults {
		r.applyAdvanceBroadcasts(ar)
	}
	r.broadcastExpired(expired)
	r.broadcastSquareEffects(squares)
	if end != nil && !boardChanged {
		r.broadcastState()
	}
	r.announceEnd(end)
}

/// validateNoCheck applica la regola globale "niente scacco da magia" alla
// posizione prodotta dagli effetti di una magia, in main1 come in main2:
//   - il re di chi lancia non può restare sotto scacco (se lo era già, la magia
//     deve risolvere lo scacco);
//   - la magia non può dare scacco al re avversario. Se era già sotto scacco
//     (gliel'ha dato una mossa, prima della main2) la magia è ammessa: lo
//     scacco non viene da lei.
//
// Il matto arriva quindi solo da una mossa.
func validateNoCheck(before, after string, caster effects.Color) error {
	if effects.IsKingAttacked(after, caster) {
		return gameerr.Newf(gameerr.IllegalPosition, "il re %s resterebbe sotto scacco", caster).
			With("king", caster)
	}
	opponent := caster.Opponent()
	if effects.IsKingAttacked(after, opponent) && !effects.IsKingAttacked(before, opponent) {
		return gameerr.Newf(gameerr.IllegalPosition, "una magia non può dare scacco al re %s", opponent).
			With("king", opponent)
	}
	return nil
}

// spellOutcome è l'esito di applySpellEffects: gli effetti applicati (per il
// broadcast), se la scacchiera è cambiata, le carte pescate e i giocatori il cui
// cimitero è cambiato.
type spellOutcome struct {
	applied []interface{}
	changed bool
	drawn   []match.DrawResult
	graves  []match.Player
	squares bool // gli stati delle case sono cambiati
}

// applySpellEffects esegue gli effetti di una magia. Un errore annulla il cast
// senza spendere mana.
//
// Prima valida i bersagli contro i TargetSpec; poi applica gli effetti in
// ordine su una copia della FEN, del Tracker e dei cimiteri e controlla la
// posizione finale. Solo se tutto riesce le copie sostituiscono lo stato della
// partita e si applicano pesca e mana: un cast rifiutato non lascia tracce. Va
// invocata con r.mu tenuto.
func (r *Room) applySpellEffects(def spells.Spell, targets []string, caster match.Player, choice spells.Choice) (spellOutcome, error) {
	casterColor := toEffectsColor(caster)
	if err := effects.ValidateTargets(r.Board.FEN, r.Tracker, def.Targets, targets, casterColor); err != nil {
		return spellOutcome{}, err
	}

	fen := r.Board.FEN
	tracker := r.Tracker.Clone()
	graves := map[match.Player][]spells.GraveEntry{
		match.PlayerWhite: r.Match.White.CopyGraveyard(),
		match.PlayerBlack: r.Match.Black.CopyGraveyard(),
	}
	gravesChanged := map[match.Player]bool{}
	changed, squaresChanged := false, false
	applied := make([]interface{}, 0, len(def.Effects))
	var deferred []func() // pesca e mana: dopo che la scacchiera è convalidata
	var drawn []match.DrawResult

	target := func() (string, error) {
		if len(targets) == 0 {
			return "", gameerr.Newf(gameerr.InvalidTargetCount, "la magia %s richiede un bersaglio", def.Name).
				With("expected", 1).With("received", 0)
		}
		return targets[0], nil
	}
	noEffect := func(reason string) error {
		return gameerr.Newf(gameerr.NoEffect, "la magia %s non avrebbe effetto", def.Name).With("reason", reason)
	}
	invalidChoice := func(reason string) error {
		return gameerr.Newf(gameerr.InvalidChoice, "scelta non valida per %s: %q", def.Name, choice.Piece).
			With("reason", reason)
	}
	// bury manda al cimitero del proprietario il pezzo nella casa (prima che
	// sparisca dalla FEN e dal Tracker).
	bury := func(square string) {
		id, piece, ok := tracker.Info(square)
		if !ok {
			p, err := effects.PieceAt(fen, square)
			if err != nil || p == 0 {
				return
			}
			piece = p
		}
		owner := toMatchPlayer(effects.ColorOf(piece))
		graves[owner] = append(graves[owner], spells.GraveEntry{Piece: spells.PieceKind(effects.PieceKindName(piece)), PieceID: id})
		gravesChanged[owner] = true
	}

	for _, eff := range def.Effects {
		entry := map[string]interface{}{"kind": eff.Kind}
		switch eff.Kind {
		case spells.EffectDestroyPiece:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			// Santuario: nessun pezzo nemico sparisce da quella casa (il sacrificio
			// di un proprio pezzo resta ammesso).
			if tracker.HasSquareEffect(sq, effects.KindNoCapture) {
				if p, _ := effects.PieceAt(fen, sq); p != 0 && effects.ColorOf(p) != casterColor {
					return spellOutcome{}, gameerr.Newf(gameerr.InvalidTarget, "%s è su una casa dove non si cattura", sq).
						With("index", 0).With("reason", effects.ReasonNoCapture).With("square", sq)
				}
			}
			bury(sq) // to_graveyard: ogni pezzo distrutto va nel cimitero
			newFEN, destroyed, err := effects.DestroyPiece(fen, sq)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.RemoveAt(sq) // l'identità del pezzo distrutto sparisce
			entry["target"], entry["piece_destroyed"] = sq, destroyed

		case spells.EffectFreezePiece, spells.EffectShieldPiece:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			duration := paramInt(eff.Params, "duration", 1)
			apply := effects.FreezePiece
			if eff.Kind == spells.EffectShieldPiece {
				apply = effects.ShieldPiece
			}
			if err := apply(tracker, sq, casterColor, duration, def.ID); err != nil {
				return spellOutcome{}, err
			}
			entry["target"], entry["remaining_turns"] = sq, duration

		case spells.EffectFreezeAll:
			side := casterColor.Opponent()
			if s, _ := eff.Params["side"].(string); s == "own" {
				side = casterColor
			}
			squares := effects.PiecesOf(fen, side, paramStrings(eff.Params, "pieces"))
			if len(squares) == 0 {
				return spellOutcome{}, noEffect("no_pieces")
			}
			duration := paramInt(eff.Params, "duration", 1)
			for _, sq := range squares {
				if err := effects.FreezePiece(tracker, sq, casterColor, duration, def.ID); err != nil {
					return spellOutcome{}, err
				}
			}
			entry["targets"], entry["remaining_turns"] = squares, duration

		case spells.EffectShieldArea:
			var squares []string
			if around, _ := eff.Params["around"].(string); around == "own_king" {
				squares = effects.AroundKing(fen, casterColor, paramInt(eff.Params, "radius", 1))
			} else if filter, _ := eff.Params["filter"].(string); filter == "own_pawns_side_by_side" {
				squares = effects.PawnsSideBySide(fen, casterColor)
			} else {
				return spellOutcome{}, gameerr.Newf(gameerr.Internal, "shield_area senza un filtro noto (%s)", def.ID)
			}
			if len(squares) == 0 {
				return spellOutcome{}, noEffect("no_pieces")
			}
			duration := paramInt(eff.Params, "duration", 1)
			for _, sq := range squares {
				if err := effects.ShieldPiece(tracker, sq, casterColor, duration, def.ID); err != nil {
					return spellOutcome{}, err
				}
			}
			entry["targets"], entry["remaining_turns"] = squares, duration

		case spells.EffectDrawCard:
			amount := paramInt(eff.Params, "amount", 1)
			deferred = append(deferred, func() {
				count := 0
				for i := 0; i < amount; i++ {
					if d := r.Match.DrawFor(caster); d.CardID != "" {
						drawn = append(drawn, d)
						count++
					}
				}
				entry["count"] = count
			})

		case spells.EffectGainMana:
			amount := paramInt(eff.Params, "amount", 1)
			exceedCap := paramBool(eff.Params, "can_exceed_cap")
			deferred = append(deferred, func() {
				m := r.Match.GainMana(caster, amount, exceedCap)
				entry["amount"], entry["mana"] = amount, m.Current
			})

		case spells.EffectMovePiece:
			from, to, err := moveEndpoints(fen, eff.Params, targets, casterColor)
			if err != nil {
				return spellOutcome{}, err
			}
			if tracker.HasSquareEffect(to, effects.KindWall) {
				return spellOutcome{}, gameerr.Newf(gameerr.InvalidTarget, "in %s c'è un muro", to).
					With("index", 0).With("reason", effects.ReasonWall).With("square", to)
			}
			newFEN, err := effects.MovePieceFEN(fen, from, to, casterColor)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			// Spostamento magico: niente semantica di arrocco/en passant.
			tracker.Relocate(from, to)
			entry["from"], entry["to"] = from, to

		case spells.EffectSwapPieces:
			if len(targets) < 2 {
				return spellOutcome{}, gameerr.Newf(gameerr.InvalidTargetCount, "la magia %s richiede due bersagli", def.Name).
					With("expected", 2).With("received", len(targets))
			}
			newFEN, err := effects.SwapPieces(fen, targets[0], targets[1])
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.Swap(targets[0], targets[1]) // id ed effetti seguono i pezzi
			entry["targets"] = []string{targets[0], targets[1]}

		case spells.EffectTransformPiece:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			p, err := effects.PieceAt(fen, sq)
			if err != nil {
				return spellOutcome{}, err
			}
			to := paramStringMap(eff.Params, "map")[effects.PieceKindName(p)]
			letter := effects.PieceLetter(to, effects.ColorOf(p))
			if letter == 0 {
				return spellOutcome{}, gameerr.Newf(gameerr.InvalidTarget, "%s non si può trasformare", sq).
					With("index", 0).With("reason", effects.ReasonPieceKind).With("square", sq)
			}
			newFEN, err := effects.SetPiece(fen, sq, letter)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.SetType(sq, letter) // stesso PieceID, stessi effetti
			entry["target"], entry["piece"] = sq, to

		case spells.EffectPromotePiece:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			if choice.Piece == "" {
				return spellOutcome{}, invalidChoice("missing")
			}
			if !containsString(paramStrings(eff.Params, "choices"), string(choice.Piece)) {
				return spellOutcome{}, invalidChoice("not_allowed")
			}
			p, err := effects.PieceAt(fen, sq)
			if err != nil {
				return spellOutcome{}, err
			}
			letter := effects.PieceLetter(string(choice.Piece), effects.ColorOf(p))
			newFEN, err := effects.SetPiece(fen, sq, letter)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.SetType(sq, letter)
			entry["target"], entry["piece"] = sq, string(choice.Piece)

		case spells.EffectRevivePiece:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			var available []string
			for _, kind := range paramStrings(eff.Params, "pieces") {
				if graveHas(graves[caster], kind) {
					available = append(available, kind)
				}
			}
			if len(available) == 0 {
				return spellOutcome{}, noEffect("empty_graveyard")
			}
			kind := string(choice.Piece)
			if kind == "" {
				if len(available) > 1 {
					return spellOutcome{}, invalidChoice("missing")
				}
				kind = available[0]
			}
			if !containsString(available, kind) {
				return spellOutcome{}, invalidChoice("not_allowed")
			}
			letter := effects.PieceLetter(kind, casterColor)
			newFEN, err := effects.PlacePiece(fen, sq, letter)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.Add(sq, letter) // PieceID nuovo, nessun effetto
			graves[caster] = removeFirstGrave(graves[caster], kind)
			gravesChanged[caster] = true
			entry["target"], entry["piece"] = sq, kind

		case spells.EffectRestoreCastling:
			newFEN, ok := effects.RestoreCastling(fen, casterColor)
			if !ok {
				return spellOutcome{}, noEffect("no_castling")
			}
			fen, changed = newFEN, true

		case spells.EffectCreateWall, spells.EffectCreateSquareEffect:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			kind := effects.KindWall
			if eff.Kind == spells.EffectCreateSquareEffect {
				kind, _ = eff.Params["effect"].(string)
				if kind != effects.KindNoCapture {
					return spellOutcome{}, gameerr.Newf(gameerr.Internal, "stato della casa non supportato: %q (%s)", kind, def.ID)
				}
				entry["effect"] = kind
			}
			duration := paramInt(eff.Params, "duration", 1)
			tracker.AddSquareEffect(sq, kind, duration, def.ID, casterColor)
			squaresChanged = true
			entry["target"], entry["remaining_turns"] = sq, duration

		case spells.EffectPlaceRune:
			if len(targets) == 0 {
				return spellOutcome{}, gameerr.Newf(gameerr.InvalidTargetCount, "la magia %s richiede un bersaglio", def.Name).
					With("expected", 1).With("received", 0)
			}
			spec := runeSpecFrom(eff.Params)
			for _, sq := range targets {
				if err := tracker.AddRune(sq, casterColor, spec, def.ID); err != nil {
					return spellOutcome{}, err
				}
			}
			squaresChanged = true
			entry["targets"], entry["on_enter"] = append([]string{}, targets...), spec.OnEnter

		case spells.EffectRevealRunes:
			side := casterColor.Opponent()
			if s, _ := eff.Params["side"].(string); s == "own" {
				side = casterColor
			}
			if n := tracker.RevealRunes(side); n > 0 {
				squaresChanged = true
			}
			entry["side"] = toMatchPlayer(side)

		case spells.EffectDetonateRunes:
			if do, _ := eff.Params["do"].(string); do != spells.EffectFreezePiece {
				return spellOutcome{}, gameerr.Newf(gameerr.Internal, "detonate_runes: effetto non supportato %q (%s)", do, def.ID)
			}
			runes := tracker.RunesOf(casterColor)
			if len(runes) == 0 {
				return spellOutcome{}, noEffect(effects.ReasonNoRunes)
			}
			radius := paramInt(eff.Params, "radius", 1)
			duration := paramInt(eff.Params, "duration", 1)
			// Congela i nemici attorno a ogni runa (il re escluso), poi consuma le rune.
			frozen := []string{}
			seen := map[string]bool{}
			for _, rsq := range runes {
				for _, sq := range effects.AroundSquares(rsq, radius) {
					p, _ := effects.PieceAt(fen, sq)
					if p == 0 || seen[sq] || effects.ColorOf(p) == casterColor || effects.PieceKindName(p) == string(spells.King) {
						continue
					}
					if err := effects.FreezePiece(tracker, sq, casterColor, duration, def.ID); err != nil {
						return spellOutcome{}, err
					}
					seen[sq] = true
					frozen = append(frozen, sq)
				}
			}
			for _, rsq := range runes {
				tracker.RemoveRune(rsq, casterColor)
			}
			sort.Strings(frozen)
			squaresChanged = true
			entry["runes"], entry["targets"], entry["remaining_turns"] = runes, frozen, duration

		case spells.EffectSummonPawn:
			sq, err := target()
			if err != nil {
				return spellOutcome{}, err
			}
			pawn := byte('P')
			if casterColor == effects.Black {
				pawn = 'p'
			}
			if limit := paramInt(eff.Params, "max_pawns", 0); limit > 0 && effects.CountPieces(fen, pawn) >= limit {
				return spellOutcome{}, gameerr.Newf(gameerr.InvalidTarget, "hai già %d pedoni", limit).
					With("index", 0).With("reason", reasonMaxPawns).With("square", sq)
			}
			newFEN, err := effects.PlacePiece(fen, sq, pawn)
			if err != nil {
				return spellOutcome{}, err
			}
			fen, changed = newFEN, true
			tracker.Add(sq, pawn)
			entry["target"], entry["piece"] = sq, "pawn"

		default:
			return spellOutcome{}, gameerr.Newf(gameerr.Internal, "effetto non supportato: %s", eff.Kind)
		}
		applied = append(applied, entry)
	}

	if changed {
		fen = effects.ClearStaleEnPassant(fen)
		if err := validateNoCheck(r.Board.FEN, fen, casterColor); err != nil {
			return spellOutcome{}, err
		}
		// Una magia non passa il turno: il lato al tratto della FEN resta invariato.
		r.Board.FEN = fen
	}
	r.Tracker = tracker
	var gravesOut []match.Player
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		if gravesChanged[p] {
			r.playerState(p).Graveyard = graves[p]
			gravesOut = append(gravesOut, p)
		}
	}
	for _, apply := range deferred {
		apply()
	}
	return spellOutcome{applied: applied, changed: changed, drawn: drawn, graves: gravesOut, squares: squaresChanged}, nil
}

// hiddenSpellCast è lo spell_cast di una magia nascosta visto dall'avversario di
// chi la lancia: né carta né bersagli (M42).
func hiddenSpellCast(caster match.Player) map[string]interface{} {
	return map[string]interface{}{
		"player":          caster,
		"hidden":          true,
		"effects_applied": []interface{}{map[string]interface{}{"kind": hiddenEffect}},
	}
}

// hiddenEffect è il kind dell'unico effetto di uno spell_cast nascosto.
const hiddenEffect = "hidden_effect"

// playerState restituisce le risorse del giocatore dato.
func (r *Room) playerState(p match.Player) *spells.PlayerState {
	if p == match.PlayerBlack {
		return r.Match.Black
	}
	return r.Match.White
}

// toMatchPlayer mappa il colore del package effects nel giocatore del match.
func toMatchPlayer(c effects.Color) match.Player {
	if c == effects.Black {
		return match.PlayerBlack
	}
	return match.PlayerWhite
}

// buryCaptured mette nel cimitero del proprietario il pezzo catturato da una
// mossa, prima che la mossa lo tolga da FEN e Tracker. Restituisce il
// proprietario. Va invocata con r.mu tenuto.
func (r *Room) buryCaptured(square string) (match.Player, bool) {
	id, piece, ok := r.Tracker.Info(square)
	if !ok {
		p, err := effects.PieceAt(r.Board.FEN, square)
		if err != nil || p == 0 {
			return "", false
		}
		piece = p
	}
	owner := toMatchPlayer(effects.ColorOf(piece))
	ps := r.playerState(owner)
	ps.Graveyard = append(ps.Graveyard, spells.GraveEntry{Piece: spells.PieceKind(effects.PieceKindName(piece)), PieceID: id})
	return owner, true
}

// graveyardUpdate è il payload di graveyard_changed, copiato sotto lock.
type graveyardUpdate struct {
	Player    match.Player       `json:"player"`
	Graveyard []spells.PieceKind `json:"graveyard"`
}

// graveyardUpdates fotografa i cimiteri cambiati. Va invocata con r.mu tenuto.
func (r *Room) graveyardUpdates(players []match.Player) []graveyardUpdate {
	out := make([]graveyardUpdate, 0, len(players))
	for _, p := range players {
		out = append(out, graveyardUpdate{Player: p, Graveyard: r.playerState(p).GraveyardKinds()})
	}
	return out
}

// broadcastGraveyards manda graveyard_changed a entrambi. Va invocata SENZA r.mu.
func (r *Room) broadcastGraveyards(updates []graveyardUpdate) {
	for _, u := range updates {
		r.Broadcast(models.MsgGraveyardChanged, u)
	}
}

// squareViews è la lista degli stati delle case vista da ciascun giocatore: le
// rune nascoste dell'avversario non ci sono. nil = nessun cambiamento.
type squareViews map[match.Player][]effects.SquareEffectInfo

// squareViewsNow fotografa le liste dei due giocatori. Va invocata con r.mu tenuto.
func (r *Room) squareViewsNow() squareViews {
	return squareViews{
		match.PlayerWhite: r.squareEffects(match.PlayerWhite),
		match.PlayerBlack: r.squareEffects(match.PlayerBlack),
	}
}

// broadcastSquareEffects manda a ciascun giocatore la sua lista completa degli
// stati delle case, se è cambiata (nil = nessun cambiamento). Va invocata senza r.mu.
func (r *Room) broadcastSquareEffects(views squareViews) {
	if views == nil {
		return
	}
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		if c := r.clientOf(p); c != nil {
			c.SendMessage(models.MsgSquareEffectsChanged, map[string]interface{}{"square_effects": views[p]})
		}
	}
}

// squareEffects restituisce gli stati attivi sulle case visti dal giocatore dato
// (nil-safe).
func (r *Room) squareEffects(viewer match.Player) []effects.SquareEffectInfo {
	if r.Tracker == nil {
		return []effects.SquareEffectInfo{}
	}
	return r.Tracker.SquareEffectsFor(toEffectsColor(viewer))
}

// runeSpecFrom legge i params di place_rune.
func runeSpecFrom(params map[string]interface{}) effects.RuneSpec {
	onEnter, _ := params["on_enter"].(string)
	fallback, _ := params["fallback"].(string)
	return effects.RuneSpec{
		OnEnter:          onEnter,
		Duration:         paramInt(params, "duration", 0),
		Only:             paramStrings(params, "only"),
		Fallback:         fallback,
		FallbackDuration: paramInt(params, "fallback_duration", 0),
	}
}

// runeTrigger è il payload di rune_triggered, più i cimiteri cambiati.
type runeTrigger struct {
	Square  string                 `json:"square"`
	Owner   match.Player           `json:"owner"`
	OnEnter string                 `json:"on_enter"`
	Result  map[string]interface{} `json:"result"`
	graves  []match.Player
}

// triggerRune controlla, dopo una mossa già applicata a FEN e Tracker, se il
// pezzo che è entrato in una casa fa scattare una runa dell'avversario di chi ha
// mosso (docs/BRIEFING-MAGIE.md, Step 4). fenBefore è la FEN prima della mossa.
//
//   - Entra la casa d'arrivo della mossa; nell'arrocco quella della torre, perché
//     il re non fa scattare le rune (M36). Un pezzo arrivato per magia non passa
//     da qui (M34).
//   - Gelo: il pezzo è congelato per `duration` turni suoi, come M9 con Caster =
//     proprietario della runa; il turno in corso non conta (M44). Ritorno: il
//     pezzo torna com'era sulla casa di partenza, la cattura fatta entrando resta
//     (M40). Distruzione: solo i tipi in `only`, gli altri subiscono il fallback;
//     su un santuario il pezzo è congelato invece (M26, M40).
//   - Se l'effetto lascerebbe sotto scacco il re di chi ha mosso, la runa non
//     scatta e resta nascosta (M35).
//
// Gli effetti si applicano su copie di FEN, Tracker e cimitero, che sostituiscono
// lo stato solo se la runa scatta; allora la runa si consuma. Va invocata con r.mu
// tenuto; nil se non scatta nulla.
func (r *Room) triggerRune(fenBefore, move string, mover match.Player) *runeTrigger {
	square, origin, before, ok := effects.RuneEntry(fenBefore, move)
	if !ok {
		return nil
	}
	moverColor := toEffectsColor(mover)
	owner := moverColor.Opponent()
	rn, ok := r.Tracker.RuneAt(square, owner)
	if !ok || rn.Rune == nil {
		return nil
	}

	fen := r.Board.FEN
	tracker := r.Tracker.Clone()
	id, now, known := tracker.Info(square)
	if !known {
		now, _ = effects.PieceAt(fen, square)
	}
	if now == 0 {
		return nil
	}
	kind, duration := rn.Rune.Strike(now)
	if kind == effects.RuneDestroy && tracker.HasSquareEffect(square, effects.KindNoCapture) {
		kind, duration = effects.RuneFreeze, rn.Rune.FallbackDuration
		if duration <= 0 {
			duration = 1
		}
	}

	result := map[string]interface{}{"kind": kind}
	var grave *spells.GraveEntry
	switch kind {
	case effects.RuneFreeze:
		// +1: il gelo scatta nel turno di chi è entrato, che non conta (M44).
		turns := duration + 1
		if err := effects.FreezePiece(tracker, square, owner, turns, rn.SourceSpellID); err != nil {
			return nil
		}
		result["target"], result["remaining_turns"] = square, turns
	case effects.RuneReturn:
		newFEN, err := effects.ReturnPiece(fen, square, origin, before)
		if err != nil {
			logger.L.Warn("Runa di ritorno non applicabile", zap.String("room", r.ID), zap.Error(err))
			return nil
		}
		fen = newFEN
		tracker.Relocate(square, origin)
		tracker.SetType(origin, before) // un pedone promosso torna pedone
		result["from"], result["to"] = square, origin
	case effects.RuneDestroy:
		newFEN, destroyed, err := effects.DestroyPiece(fen, square)
		if err != nil {
			return nil
		}
		fen = effects.ClearStaleEnPassant(newFEN)
		tracker.RemoveAt(square)
		grave = &spells.GraveEntry{Piece: spells.PieceKind(effects.PieceKindName(now)), PieceID: id}
		result["target"], result["piece_destroyed"] = square, destroyed
	default:
		return nil
	}

	if effects.IsKingAttacked(fen, moverColor) {
		logger.L.Info("Runa non scattata: lascerebbe il re sotto scacco",
			zap.String("room", r.ID), zap.String("square", square))
		return nil
	}
	tracker.RemoveRune(square, owner)
	r.Board.FEN = fen
	r.Tracker = tracker
	trig := &runeTrigger{Square: square, Owner: toMatchPlayer(owner), OnEnter: rn.Rune.OnEnter, Result: result}
	if grave != nil {
		ps := r.playerState(mover)
		ps.Graveyard = append(ps.Graveyard, *grave)
		trig.graves = []match.Player{mover}
	}
	logger.L.Info("Runa scattata",
		zap.String("room", r.ID),
		zap.String("square", square),
		zap.String("owner", string(owner)),
		zap.Any("result", result),
	)
	return trig
}

// graveHas indica se nel cimitero c'è un pezzo del tipo dato.
func graveHas(graves []spells.GraveEntry, kind string) bool {
	for _, e := range graves {
		if string(e.Piece) == kind {
			return true
		}
	}
	return false
}

// removeFirstGrave toglie dal cimitero la prima occorrenza del tipo dato.
func removeFirstGrave(graves []spells.GraveEntry, kind string) []spells.GraveEntry {
	for i, e := range graves {
		if string(e.Piece) == kind {
			return append(append([]spells.GraveEntry{}, graves[:i]...), graves[i+1:]...)
		}
	}
	return graves
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// paramStrings legge un parametro lista di stringhe (anche []spells.PieceKind o
// []interface{}, come arriva da JSON).
func paramStrings(params map[string]interface{}, key string) []string {
	var out []string
	switch v := params[key].(type) {
	case []string:
		out = append(out, v...)
	case []spells.PieceKind:
		for _, k := range v {
			out = append(out, string(k))
		}
	case []interface{}:
		for _, x := range v {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

// paramStringMap legge un parametro mappa stringa → stringa.
func paramStringMap(params map[string]interface{}, key string) map[string]string {
	out := map[string]string{}
	switch v := params[key].(type) {
	case map[string]string:
		for k, x := range v {
			out[k] = x
		}
	case map[string]interface{}:
		for k, x := range v {
			if s, ok := x.(string); ok {
				out[k] = s
			}
		}
	}
	return out
}

// reasonMaxPawns: summon_pawn rifiutato perché il lanciatore ha già il numero
// massimo di pedoni (details.reason di invalid_target).
const reasonMaxPawns = "max_pawns"

// reasonPromotion: movimento rifiutato perché porterebbe un pedone all'ultima
// traversa con no_promotion.
const reasonPromotion = "promotion"

// moveEndpoints ricava partenza e arrivo di un move_piece: dai due bersagli
// ([pezzo, casa]) oppure, con "relative": "forward", dal solo pezzo e dal numero
// di passi ("squares") in avanti per chi lancia. Il movimento relativo non
// cattura (la casa d'arrivo deve essere vuota) e con "no_promotion" non può
// arrivare all'ultima traversa.
func moveEndpoints(fen string, params map[string]interface{}, targets []string, caster effects.Color) (string, string, error) {
	relative, _ := params["relative"].(string)
	if relative == "" {
		if len(targets) < 2 {
			return "", "", gameerr.New(gameerr.InvalidTargetCount, "lo spostamento richiede pezzo e casa d'arrivo").
				With("expected", 2).With("received", len(targets))
		}
		return targets[0], targets[1], nil
	}
	if relative != "forward" || len(targets) == 0 {
		return "", "", gameerr.Newf(gameerr.Internal, "movimento relativo non supportato: %q", relative)
	}
	from := targets[0]
	to, err := effects.ForwardSquare(from, caster, paramInt(params, "squares", 1))
	if err != nil {
		return "", "", err
	}
	if p, _ := effects.PieceAt(fen, to); p != 0 {
		return "", "", gameerr.Newf(gameerr.InvalidTarget, "la casa %s davanti al pezzo è occupata", to).
			With("index", 0).With("reason", effects.ReasonNotEmpty).With("square", to)
	}
	if paramBool(params, "no_promotion") && effects.RelativeRank(to, caster) == 8 {
		return "", "", gameerr.Newf(gameerr.InvalidTarget, "%s porterebbe il pedone alla promozione", to).
			With("index", 0).With("reason", reasonPromotion).With("square", to)
	}
	return from, to, nil
}

// tickEffectsOnNewTurn, se nei risultati c'è un nuovo turno, aggiorna le durate
// degli effetti alla fine del turno di chi ha appena chiuso. Restituisce gli
// effetti scaduti sui pezzi e, se uno stato di una casa è scaduto, le nuove
// liste degli stati delle case per ciascun giocatore (nil altrimenti). Va invocata con r.mu tenuto.
func (r *Room) tickEffectsOnNewTurn(results []match.AdvanceResult) ([]effects.ExpiredEffect, squareViews) {
	for _, res := range results {
		if res.NewTurn {
			finishing := toEffectsColor(res.ActivePlayer.Opponent()) // chi ha appena chiuso il turno
			expired := r.Tracker.TickTurnEnd(finishing)
			if r.Tracker.TickSquares(finishing) {
				return expired, r.squareViewsNow()
			}
			return expired, nil
		}
	}
	return nil, nil
}

// gameStatus valuta la posizione per il lato al tratto della FEN. Le mosse dei
// pezzi congelati non contano come giocabili: se non ne resta nessuna valgono le
// regole degli scacchi (re sotto scacco = matto, altrimenti stallo). Va
// invocata con r.mu tenuto.
func (r *Room) gameStatus() engine.GameStatus {
	return engine.SF.GetGameStatusFiltered(r.Board.FEN, r.isPlayable)
}

// isPlayable indica se una mossa legale per gli scacchi è ammessa dagli stati
// delle magie, con gli stessi controlli di handleMove: un pezzo congelato non
// muove, un muro sbarra il percorso, su un santuario non si cattura.
func (r *Room) isPlayable(move string) bool {
	if len(move) < 4 {
		return true
	}
	if r.Tracker.IsFrozen(move[:2]) {
		return false
	}
	_, reason := effects.MoveBlock(r.Board.FEN, r.Tracker, move)
	return reason == ""
}

// checkRolloverGameEnd, dopo un rollover di turno, verifica se il nuovo
// giocatore attivo è in matto o stallo, anche per effetto di una magia del turno
// precedente (es. un pezzo congelato o un pedone evocato che blocca). Va
// invocata con r.mu tenuto; il chiamante chiama announceEnd dopo aver rilasciato
// il lock e fatto i broadcast.
func (r *Room) checkRolloverGameEnd(results []match.AdvanceResult) *gameEnd {
	for _, res := range results {
		if res.NewTurn {
			return r.checkActivePlayerEnd()
		}
	}
	return nil
}

// checkActivePlayerEnd valuta la posizione del giocatore attivo, che deve
// essere il lato al tratto della FEN: all'inizio del suo turno, oppure in main1
// dopo una sua magia che ha cambiato la scacchiera (un Patto di sangue può
// lasciarlo senza mosse). Se la partita è finita la conclude e ritorna l'esito.
// Va invocata con r.mu tenuto.
func (r *Room) checkActivePlayerEnd() *gameEnd {
	switch r.gameStatus() {
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

// paramBool legge un parametro booleano (false se assente o di altro tipo).
func paramBool(params map[string]interface{}, key string) bool {
	v, _ := params[key].(bool)
	return v
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
			r.broadcastState()
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
	state := r.publicState(match.Player(r.getColor(client)))
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
				r.broadcastState()
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

// broadcastState manda a ciascun giocatore lo stato completo inclusi i tempi,
// visto da lui (le rune nascoste dell'avversario non ci sono). Va invocata SENZA r.mu.
func (r *Room) broadcastState() {
	r.mu.Lock()
	white, black := r.publicState(match.PlayerWhite), r.publicState(match.PlayerBlack)
	r.mu.Unlock()
	if r.White != nil {
		r.White.SendMessage(models.MsgGameState, white)
	}
	if r.Black != nil {
		r.Black.SendMessage(models.MsgGameState, black)
	}
}

// playerInfo è l'identità pubblica di un giocatore in game_state.
type playerInfo struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

// publicState costruisce lo stato mandato a viewer (nessuna identità di carta in
// mano: solo dimensioni, mana e fase; nessuna runa nascosta dell'avversario —
// anti-cheat). Copia i dati mutabili, così il risultato può essere serializzato
// dopo aver rilasciato il lock. Va invocata con r.mu tenuto.
func (r *Room) publicState(viewer match.Player) map[string]interface{} {
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
		"white_graveyard": r.Match.White.GraveyardKinds(),
		"black_graveyard": r.Match.Black.GraveyardKinds(),
		"square_effects":  r.squareEffects(viewer),
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
