package game

import (
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/logger"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

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
	Increment         time.Duration       // incremento per mossa (es. 5 secondi)
	timerStop         chan struct{}       // canale per fermare il timer
	lastMoveAt        time.Time           // quando è stata fatta l'ultima mossa
	drawOfferer       *Client             // chi ha offerto la patta (nil se nessuna offerta)
	disconnectedTimer map[int]*time.Timer // userID -> timer di disconnessione
	posCounts         map[string]int      // FEN normalizzata -> occorrenze (tripla ripetizione)
	mu                sync.Mutex          // protegge lo stato durante il timer
}

// Board rappresenta lo stato della partita
type Board struct {
	FEN    string   `json:"fen"`    // FEN = notazione standard per lo stato della board
	Moves  []string `json:"moves"`  // lista delle mosse in notazione algebrica
	Turn   string   `json:"turn"`   // "white" o "black"
	Status string   `json:"status"` // "active", "checkmate", "draw"
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
			Status: "active",
		},
		Match:             match.New(time.Now().UnixNano()), // draw / turno 1 / Bianco, mazzi mischiati
		WhiteTime:         baseTime,
		BlackTime:         baseTime,
		Increment:         increment,
		timerStop:         make(chan struct{}),
		lastMoveAt:        time.Now(),
		disconnectedTimer: make(map[int]*time.Timer),
		posCounts:         make(map[string]int),
	}
	room.Tracker = effects.NewTracker(room.Board.FEN) // identità pezzi per gli effetti
	room.recordPosition()                             // conta la posizione iniziale (tripla ripetizione)

	white.Room = room
	black.Room = room

	// Manda lo stato iniziale con i tempi e la fase
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
	go room.runTimer()

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

// HandleMessage smista i messaggi ricevuti dai client
func (r *Room) HandleMessage(sender *Client, msg models.WSMessage) {
	switch msg.Type {

	case models.MsgMove:
		var moveData struct {
			Move string `json:"move"` // es. "e2e4" o "e4" in notazione algebrica
		}
		if err := json.Unmarshal(msg.Payload, &moveData); err != nil {
			sender.sendError("Formato mossa non valido")
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
			sender.sendError("Formato cast_spell non valido")
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
		sender.sendError(fmt.Sprintf("Tipo messaggio sconosciuto: %s", msg.Type))
	}
}

func (r *Room) handleMove(sender *Client, move string) {
	r.mu.Lock()

	senderColor := r.getColor(sender)
	if senderColor != r.Board.Turn {
		r.mu.Unlock()
		sender.sendError("Non è il tuo turno")
		return
	}

	if r.Match.CurrentPhase != phase.PhaseMove {
		r.mu.Unlock()
		sender.sendError(fmt.Sprintf("Non puoi muovere nella fase %s", r.Match.CurrentPhase))
		return
	}

	if !engine.SF.IsMoveLegal(r.Board.FEN, move) {
		r.mu.Unlock()
		sender.sendError(fmt.Sprintf("Mossa illegale: %s", move))
		return
	}

	from, to := move[:2], move[2:4]

	// Effetto freeze: un pezzo congelato non può muoversi.
	if r.Tracker.IsFrozen(from) {
		r.mu.Unlock()
		sender.sendError(fmt.Sprintf("Il pezzo in %s è congelato", from))
		return
	}

	// Effetto shield: se la mossa cattura un pezzo protetto, lo scudo assorbe il
	// colpo — il pezzo sopravvive — ma la mossa dell'attaccante è comunque
	// consumata (il turno passa). Nessun pezzo si sposta.
	shieldAbsorbed := r.Tracker.HasShield(to)

	// Calcola il tempo impiegato
	elapsed := time.Since(r.lastMoveAt)

	if senderColor == "white" {
		r.WhiteTime -= elapsed
		r.WhiteTime += r.Increment
		if r.WhiteTime < 0 {
			r.mu.Unlock()
			r.endGame(models.ResultBlackWins, "timeout")
			return
		}
	} else {
		r.BlackTime -= elapsed
		r.BlackTime += r.Increment
		if r.BlackTime < 0 {
			r.mu.Unlock()
			r.endGame(models.ResultWhiteWins, "timeout")
			return
		}
	}

	r.lastMoveAt = time.Now()

	if shieldAbsorbed {
		// Nessun pezzo si muove: consuma lo scudo e passa il turno (null move
		// sulla FEN: cambia solo il lato al tratto).
		r.Tracker.ConsumeShield(to)
		r.Board.FEN = effects.PassTurn(r.Board.FEN)
		r.Board.Turn = sideToMove(r.Board.FEN)
	} else {
		r.Board.Moves = append(r.Board.Moves, move)
		// La FEN è la fonte di verità (le magie possono editarla fuori dalle mosse).
		r.Board.FEN = engine.SF.ApplyMove(r.Board.FEN, move)
		r.Board.Turn = sideToMove(r.Board.FEN)
		// Tieni allineata l'identità dei pezzi (gli effetti seguono il pezzo).
		var promo byte
		if len(move) >= 5 {
			promo = move[4]
		}
		r.Tracker.MovePiece(from, to, promo)
	}
	r.recordPosition()

	logger.L.Info("Mossa giocata",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
		zap.String("move", move),
		zap.Bool("shield_absorbed", shieldAbsorbed),
		zap.Duration("white_time", r.WhiteTime.Round(time.Second)),
		zap.Duration("black_time", r.BlackTime.Round(time.Second)),
	)

	// Controlla fine partita — sblocca il mutex PRIMA di chiamare endGame
	// perché endGame chiama Broadcast che potrebbe bloccarsi
	status := engine.SF.GetGameStatus(r.Board.FEN)
	if status == engine.StatusOngoing && r.isThreefold() {
		status = engine.StatusDraw
	}

	switch status {
	case engine.StatusCheckmate:
		result := models.ResultWhiteWins
		if senderColor == "black" {
			result = models.ResultBlackWins
		}
		r.Board.Status = "checkmate"
		r.mu.Unlock()
		r.endGame(result, "checkmate")

	case engine.StatusStalemate:
		r.Board.Status = "stalemate"
		r.mu.Unlock()
		r.endGame(models.ResultDraw, "stalemate")

	case engine.StatusDraw:
		r.Board.Status = "draw"
		r.mu.Unlock()
		r.endGame(models.ResultDraw, "draw")

	default:
		// La mossa è l'unica azione della fase move: avanza a main2, poi
		// auto-avanza (main2/draw/main1 si saltano da soli se non richiedono
		// input). Snapshot dei passaggi sotto lock, broadcast dopo.
		results := append([]match.AdvanceResult{r.Match.Advance()}, r.Match.AutoAdvance()...)
		expired := r.tickEffectsOnNewTurn(results)
		r.mu.Unlock()
		if shieldAbsorbed {
			// Lo scudo ha assorbito la cattura: notifica il consumo dello scudo.
			r.Broadcast(models.MsgEffectExpired, map[string]interface{}{
				"square":      to,
				"effect_kind": effects.KindShield,
				"reason":      "shield_absorbed",
			})
		}
		r.broadcastState()
		for _, res := range results {
			r.applyAdvanceBroadcasts(res)
		}
		r.broadcastExpired(expired)
	}
}

// handlePassPhase gestisce il passaggio volontario alla fase successiva.
func (r *Room) handlePassPhase(sender *Client) {
	r.mu.Lock()

	senderColor := match.Player(r.getColor(sender))
	if !r.Match.IsActive(senderColor) {
		r.mu.Unlock()
		sender.sendError("Non è il tuo turno")
		return
	}

	if !r.Match.Allows(phase.ActionPassPhase) {
		r.mu.Unlock()
		sender.sendError(fmt.Sprintf("Non puoi passare nella fase %s", r.Match.CurrentPhase))
		return
	}

	// Passa la fase, poi auto-avanza le fasi che non richiedono input.
	results := append([]match.AdvanceResult{r.Match.Advance()}, r.Match.AutoAdvance()...)
	expired := r.tickEffectsOnNewTurn(results)

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
}

// handleCastSpell gestisce il gioco di una magia. In Step 2 gli effetti sono
// noop: scala il mana e manda la carta nello scarto senza toccare la board.
func (r *Room) handleCastSpell(sender *Client, spellID string, targets []string) {
	r.mu.Lock()

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
		sender.sendError(err.Error())
		return
	}

	if boardChanged {
		r.recordPosition() // la board è cambiata: conta per la tripla ripetizione
	}
	// Dopo il cast il giocatore potrebbe essere rimasto senza mana/carte: la
	// fase main si auto-avanza di conseguenza.
	autoResults := r.Match.AutoAdvance()
	expired := r.tickEffectsOnNewTurn(autoResults)

	logger.L.Info("Magia giocata",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
		zap.String("spell", res.Spell.ID),
		zap.Int("mana_after", res.ManaAfter),
	)

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
}

// applySpellEffects esegue gli effetti di una magia sulla board (FEN). Ritorna
// gli effetti applicati (arricchiti per il broadcast), se la board è cambiata, e
// un eventuale errore (che annulla il cast senza spendere mana). Va invocata con
// r.mu tenuto.
func (r *Room) applySpellEffects(def spells.Spell, targets []string, caster match.Player) ([]interface{}, bool, []match.DrawResult, error) {
	casterColor := toEffectsColor(caster)

	applied := make([]interface{}, 0, len(def.Effects))
	var drawn []match.DrawResult
	fen := r.Board.FEN
	changed := false

	for _, eff := range def.Effects {
		switch eff.Kind {
		case spells.EffectNoop:
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})

		case spells.EffectDestroyPiece:
			if len(targets) == 0 {
				return nil, false, nil, fmt.Errorf("la magia %s richiede un bersaglio", def.Name)
			}
			newFEN, destroyed, err := effects.DestroyPiece(fen, targets[0], casterColor)
			if err != nil {
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
				return nil, false, nil, fmt.Errorf("la magia %s richiede un bersaglio", def.Name)
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
				return nil, false, nil, fmt.Errorf("la magia %s richiede un bersaglio", def.Name)
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
				return nil, false, nil, fmt.Errorf("la magia %s richiede casella di partenza e arrivo", def.Name)
			}
			newFEN, err := effects.MovePieceFEN(fen, targets[0], targets[1], casterColor)
			if err != nil {
				return nil, false, nil, err
			}
			// La posizione risultante non deve lasciare il proprio re sotto scacco.
			if engine.SF.IsInCheck(effects.WithSideToMove(newFEN, casterColor)) {
				return nil, false, nil, fmt.Errorf("mossa illegale: lascerebbe il re sotto scacco")
			}
			fen = newFEN
			changed = true
			r.Tracker.MovePiece(targets[0], targets[1], 0)
			applied = append(applied, map[string]interface{}{
				"kind": eff.Kind, "from": targets[0], "to": targets[1],
			})

		default:
			return nil, false, nil, fmt.Errorf("effetto non supportato: %s", eff.Kind)
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

// broadcastExpired notifica entrambi i client degli effetti scaduti.
func (r *Room) broadcastExpired(expired []effects.ExpiredEffect) {
	for _, e := range expired {
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

func (r *Room) Leave(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Se la partita è già finita non fare nulla
	if r.Board.Status != "active" {
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

	// Avvia un timer di 30 secondi — se non si riconnette perde
	r.disconnectedTimer[client.UserID] = time.AfterFunc(config.C.ReconnectTimeout, func() {
		logger.L.Warn("Giocatore non si è riconnesso, partita terminata",
			zap.String("room", r.ID),
			zap.String("player", client.Username),
		)

		color := r.getColor(client)
		result := models.ResultWhiteWins
		if color == "white" {
			result = models.ResultBlackWins
		}
		r.endGame(result, "abandonment")
	})
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
	if r.White != nil && r.White.UserID == client.UserID {
		r.White = client
	} else if r.Black != nil && r.Black.UserID == client.UserID {
		r.Black = client
	}

	client.Room = r

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
		opponent.SendMessage("opponent_reconnected", map[string]string{
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

// PGN restituisce le mosse in formato PGN standard
func (r *Room) PGN() string {
	var sb strings.Builder
	for i, move := range r.Board.Moves {
		if i%2 == 0 {
			fmt.Fprintf(&sb, "%d. ", i/2+1)
		}
		sb.WriteString(move + " ")
	}
	return strings.TrimSpace(sb.String())
}

// endGame salva la partita e notifica i giocatori
func (r *Room) endGame(result, reason string) {
	// Ferma il timer
	select {
	case <-r.timerStop: // già chiuso
	default:
		close(r.timerStop)
	}

	// Cancella eventuali timer di disconnessione pendenti
	for _, timer := range r.disconnectedTimer {
		timer.Stop()
	}

	winner := ""
	switch result {
	case models.ResultWhiteWins:
		winner = r.White.Username
	case models.ResultBlackWins:
		winner = r.Black.Username
	}

	// Salva nel DB in una goroutine per non bloccare
	go func() {
		err := db.SaveGame(
			r.White.UserID,
			r.Black.UserID,
			r.PGN(),
			result,
			"10+0", // time control — lo renderemo dinamico in seguito
		)
		if err != nil {
			logger.L.Warn("Errore salvataggio partita",
				zap.String("room", r.ID),
			)
		} else {
			logger.L.Info("Partita salvata nel DB",
				zap.String("room", r.ID))
		}
		// Rimuovi la room dal manager dopo il salvataggio
		GameManager.RemoveRoom(r.ID, r.White.UserID, r.Black.UserID)
	}()

	// Notifica i client
	payload := map[string]string{
		"result": result,
		"reason": reason,
	}
	if winner != "" {
		payload["winner"] = winner
	}
	r.Broadcast(models.MsgGameOver, payload)
	logger.L.Info("Partita terminata",
		zap.String("room", r.ID),
		zap.String("result", result),
		zap.String("reason", reason),
	)
}

// runTimer fa scorrere il tempo del giocatore di turno
// e termina la partita se scade.
//
// NOTA: l'orologio segue Board.Turn (il lato che deve muovere negli scacchi),
// che si ribalta alla mossa, non Match.ActivePlayer. In Step 1 è ininfluente
// (i giocatori passano le fasi main istantaneamente); andrà rivisto quando le
// magie daranno durata reale alle fasi main.
func (r *Room) runTimer() {
	tickGame := time.NewTicker(100 * time.Millisecond) // aggiorna ogni 100ms
	tickBroadcast := time.NewTicker(1 * time.Second)   // aggiorna ogni 100ms
	defer tickGame.Stop()
	defer tickBroadcast.Stop()

	for {
		select {
		case <-r.timerStop:
			return

		case <-tickGame.C:
			r.mu.Lock()

			if r.Board.Turn == "white" {
				r.WhiteTime -= 100 * time.Millisecond
				if r.WhiteTime <= 0 {
					r.WhiteTime = 0
					r.mu.Unlock()
					r.endGame(models.ResultBlackWins, "timeout")
					return
				}
			} else {
				r.BlackTime -= 100 * time.Millisecond
				if r.BlackTime <= 0 {
					r.BlackTime = 0
					r.mu.Unlock()
					r.endGame(models.ResultWhiteWins, "timeout")
					return
				}
			}

			r.mu.Unlock()

		case <-tickBroadcast.C:
			r.broadcastTimers()
		}
	}
}

// broadcastTimers manda solo i tempi aggiornati ai client
func (r *Room) broadcastTimers() {
	r.Broadcast("timer_update", map[string]interface{}{
		"white_time": r.WhiteTime.Milliseconds(),
		"black_time": r.BlackTime.Milliseconds(),
		"turn":       r.Board.Turn,
	})
}

// broadcastState manda lo stato completo inclusi i tempi
func (r *Room) broadcastState() {
	r.Broadcast(models.MsgGameState, r.publicState())
}

// publicState costruisce lo stato condiviso (nessuna identità di carta in mano:
// solo dimensioni, mana e fase — anti-cheat).
func (r *Room) publicState() map[string]interface{} {
	return map[string]interface{}{
		"board":           r.Board,
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
	defer r.mu.Unlock()

	senderColor := r.getColor(sender)

	result := models.ResultWhiteWins
	if senderColor == "white" {
		result = models.ResultBlackWins
	}

	logger.L.Info("Giocatore ha abbandonato",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
	)
	r.mu.Unlock()
	r.endGame(result, "resign")
	r.mu.Lock() // il defer si aspetta il lock
}

// handleDrawOffer gestisce l'offerta di patta
func (r *Room) handleDrawOffer(sender *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Controlla se c'è già un'offerta pendente
	if r.drawOfferer != nil {
		sender.sendError("C'è già un'offerta di patta in corso")
		return
	}

	r.drawOfferer = sender
	opponent := r.getOpponent(sender)

	logger.L.Info("Giocatore offre patta",
		zap.String("room", r.ID),
		zap.String("player", sender.Username),
	)

	// Notifica l'avversario
	opponent.SendMessage(models.MsgDrawOffer, map[string]string{
		"from": sender.Username,
	})

	// Conferma al mittente
	sender.SendMessage("draw_offer_sent", map[string]string{
		"message": "Offerta di patta inviata",
	})
}

// handleDrawResponse gestisce l'accettazione o il rifiuto della patta
func (r *Room) handleDrawResponse(sender *Client, accepted bool) {
	r.mu.Lock()

	// Verifica che ci sia un'offerta pendente
	if r.drawOfferer == nil {
		r.mu.Unlock()
		sender.sendError("Nessuna offerta di patta in corso")
		return
	}

	// Solo chi ha RICEVUTO l'offerta può rispondere
	if r.drawOfferer.UserID == sender.UserID {
		r.mu.Unlock()
		sender.sendError("Non puoi rispondere alla tua stessa offerta")
		return
	}

	offerer := r.drawOfferer
	r.drawOfferer = nil

	if accepted {
		r.Board.Status = "draw"
		r.mu.Unlock()
		logger.L.Info("Patta accettata",
			zap.String("room", r.ID),
		)
		r.endGame(models.ResultDraw, "agreement")
	} else {
		r.mu.Unlock()
		logger.L.Info("Patta rifiutata",
			zap.String("room", r.ID),
		)
		// Notifica chi aveva offerto
		offerer.SendMessage(models.MsgDrawDeclined, map[string]string{
			"message": sender.Username + " ha rifiutato la patta",
		})
	}
}
