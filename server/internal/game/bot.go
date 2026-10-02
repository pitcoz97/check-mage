package game

import (
	"chess-server/internal/bot"
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/engine"
	"chess-server/internal/gameerr"
	"chess-server/internal/logger"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"encoding/json"
	"fmt"
	mrand "math/rand/v2"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Partite contro il bot (/ws?bot=<livello>&color=white|black|random): una room
// amichevole in cui un lato è giocato dal server. Il bot è un Client senza
// connessione: una goroutine legge i messaggi che la room gli manda e, quando
// tocca a lui, sceglie l'azione (internal/bot) e la manda con HandleMessage,
// passando per le stesse validazioni di un giocatore.

// botSeat è il lato giocato dal bot e il suo livello (salvato nello snapshot).
type botSeat struct {
	Level bot.Level    `json:"level"`
	Color match.Player `json:"color"`
}

// Dipendenze del bot, sostituibili nei test.
var (
	// botAvailable dice se il motore del bot è partito.
	botAvailable = func() bool { return engine.Bot != nil }
	// botEngine è il motore che sceglie le mosse (nil = mosse a caso). Si legge a
	// ogni mossa: le partite ripristinate dal DB ripartono prima del motore.
	botEngine = func() bot.Engine {
		if engine.Bot == nil {
			return nil
		}
		return engine.Bot
	}
	// botLegalMoves elenca le mosse legali degli scacchi (Stockfish delle regole).
	// Senza motore (test) nessuna mossa: il bot aspetta invece di andare in panic.
	botLegalMoves = func(fen string) []string {
		if engine.SF == nil {
			return nil
		}
		return engine.SF.LegalMoves(fen)
	}
	// botDelay è la pausa prima di ogni azione: più naturale di una risposta istantanea.
	botDelay = func(rng *mrand.Rand) time.Duration {
		return 600*time.Millisecond + time.Duration(rng.IntN(900))*time.Millisecond
	}
)

// JoinBot avvia una partita contro il bot. Come JoinQueue ritorna true se è
// una riconnessione a una partita in corso; valgono il mazzo attivo valido (D6)
// e la sostituzione della connessione in coda. Un livello sconosciuto, o il
// motore del bot non avviato, chiudono con bot_unavailable (4004).
func (m *Manager) JoinBot(client *Client, levelName, colorName string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.tryReconnectLocked(client) {
		return true
	}

	level, known := bot.ParseLevel(levelName)
	botID, hasAccount := db.BotAccountID(string(level))
	if !known || !hasAccount || !botAvailable() {
		client.sendErr(gameerr.New(gameerr.BotUnavailable, "Il bot non è disponibile"))
		client.closeWith(CloseBot, string(gameerr.BotUnavailable))
		return false
	}
	if client.DeckInvalid {
		client.sendErr(gameerr.New(gameerr.DeckInvalid, "Il mazzo attivo non è valido"))
		client.closeWith(CloseDeckInvalid, string(gameerr.DeckInvalid))
		return false
	}

	// Una connessione dello stesso utente rimasta in coda esce dalla coda.
	if m.waiting != nil && m.waiting.UserID == client.UserID && m.waiting != client {
		old := m.waiting
		m.waiting = nil
		replaceConnection(old, "Hai iniziato una partita contro il bot da un'altra connessione")
	}

	botClient := &Client{UserID: botID, Username: db.BotUsername(string(level)), Send: make(chan []byte, 256)}
	seat := &botSeat{Level: level, Color: botColorFor(colorName)}
	white, black := client, botClient
	if seat.Color == match.PlayerWhite {
		white, black = botClient, client
	}
	roomID := "bot-" + newChallengeID()
	room := newRoom(roomID, white, black, config.C.DefaultBaseTime, config.C.DefaultIncrement, true, seat)
	m.rooms[roomID] = room
	// Solo il giocatore: lo stesso bot gioca più partite insieme, e non è mai «in partita».
	m.userRooms[client.UserID] = roomID
	m.closeChallengesOfLocked(client.UserID)
	startBot(room, botClient, *seat)

	logger.L.Info("Partita contro il bot creata",
		zap.String("room", roomID),
		zap.String("player", client.Username),
		zap.String("level", string(level)),
		zap.String("bot_color", string(seat.Color)),
	)
	return false
}

// botColorFor è il colore del bot dato quello chiesto dal giocatore: "white" o
// "black" sono il colore del giocatore, qualunque altro valore è casuale.
func botColorFor(humanColor string) match.Player {
	switch humanColor {
	case "white":
		return match.PlayerBlack
	case "black":
		return match.PlayerWhite
	}
	if mrand.IntN(2) == 0 {
		return match.PlayerWhite
	}
	return match.PlayerBlack
}

// botDriver gioca il lato del bot in una room.
type botDriver struct {
	room   *Room
	client *Client
	level  bot.Level
	color  match.Player

	mu       sync.Mutex
	rng      *mrand.Rand
	pending  bool            // un'azione è già in programma
	phaseKey string          // turno e fase a cui valgono rejected e casts
	rejected map[string]bool // magie (per id) e mosse ("move:"+mossa) rifiutate in questa fase
	casts    int             // tentativi di magia in questa fase
}

// startBot fa giocare il bot sul client dato, il lato seat.Color della room.
func startBot(room *Room, client *Client, seat botSeat) *botDriver {
	d := &botDriver{
		room:     room,
		client:   client,
		level:    seat.Level,
		color:    seat.Color,
		rng:      mrand.New(mrand.NewPCG(uint64(time.Now().UnixNano()), uint64(client.UserID))),
		rejected: map[string]bool{},
	}
	go d.listen()
	return d
}

// listen legge i messaggi della room fino alla fine della partita. Ogni
// messaggio può voler dire che tocca al bot: act controlla lo stato.
func (d *botDriver) listen() {
	for raw := range d.client.Send {
		var msg models.WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case models.MsgGameOver:
			return
		case models.MsgDrawOffer:
			// Il bot non accetta patte.
			time.AfterFunc(d.delay(), func() { d.send(models.MsgDrawDeclined, nil) })
		default:
			d.schedule()
		}
	}
}

func (d *botDriver) delay() time.Duration {
	d.mu.Lock()
	defer d.mu.Unlock()
	return botDelay(d.rng)
}

// schedule programma un'azione dopo la pausa, se non ce n'è già una.
func (d *botDriver) schedule() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.scheduleLocked()
}

// scheduleLocked è schedule con d.mu tenuto.
func (d *botDriver) scheduleLocked() {
	if d.pending {
		return
	}
	d.pending = true
	time.AfterFunc(botDelay(d.rng), d.act)
}

// send manda un messaggio alla room come farebbe il client del bot.
func (d *botDriver) send(msgType string, payload interface{}) {
	var raw json.RawMessage
	if payload != nil {
		raw, _ = json.Marshal(payload)
	}
	d.room.HandleMessage(d.client, models.WSMessage{Type: msgType, Payload: raw})
}

// botTurn è ciò che il bot vede quando tocca a lui.
type botTurn struct {
	phase    phase.Phase
	key      string   // turno e fase
	view     bot.View // fasi main
	playable []string // fase move: mosse degli scacchi ammesse dalle magie
	special  []string // fase move: mosse speciali delle magie
	extra    bool     // fase move: la seconda mossa di Fretta, che il bot salta
	discards int      // carte scartate: crescono solo se un cast riesce
	moves    int      // mosse giocate: crescono solo se la mossa riesce
}

// observe legge lo stato sotto r.mu; false se non tocca al bot.
func (d *botDriver) observe() (botTurn, bool) {
	r := d.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ended || r.Match.ActivePlayer != d.color {
		return botTurn{}, false
	}
	ps := r.playerState(d.color)
	turn := botTurn{
		phase:    r.Match.CurrentPhase,
		key:      fmt.Sprintf("%d/%s", r.Match.TurnNumber, r.Match.CurrentPhase),
		discards: len(ps.Discard),
		moves:    len(r.Board.Moves),
	}
	switch r.Match.CurrentPhase {
	case phase.PhaseMain1, phase.PhaseMain2:
		casts := make(map[string]int, len(ps.CastsThisTurn))
		for id, n := range ps.CastsThisTurn {
			casts[id] = n
		}
		turn.view = bot.View{
			FEN:       r.Board.FEN,
			Color:     toEffectsColor(d.color),
			Phase:     r.Match.CurrentPhase,
			Hand:      append([]string{}, ps.Hand...),
			Mana:      ps.Mana,
			Casts:     casts,
			Graveyard: ps.GraveyardKinds(),
			Tracker:   r.Tracker.Clone(),
		}
	case phase.PhaseMove:
		if r.extraActive() && r.extra.Player == d.color {
			turn.extra = true
			break
		}
		turn.view.FEN = r.Board.FEN
		for _, m := range botLegalMoves(r.Board.FEN) {
			if r.isPlayable(m) {
				turn.playable = append(turn.playable, m)
			}
		}
		turn.special = r.specialMoves()
	default:
		return botTurn{}, false
	}
	return turn, true
}

// progress dice se dall'osservazione before il bot ha scartato una carta o
// giocato una mossa: così si capisce se la room ha accettato l'azione.
func (d *botDriver) progress(before botTurn) (cast, moved bool) {
	r := d.room
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.playerState(d.color).Discard) > before.discards, len(r.Board.Moves) > before.moves
}

// act fa una sola azione del bot, se tocca a lui, e se ne serve un'altra la
// riprogramma. Una magia o una mossa rifiutate non si ritentano nella stessa
// fase; dopo troppe magie si passa, così il bot non resta mai bloccato.
func (d *botDriver) act() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pending = false

	turn, ok := d.observe()
	if !ok {
		return
	}
	if turn.key != d.phaseKey {
		d.phaseKey, d.rejected, d.casts = turn.key, map[string]bool{}, 0
	}

	switch turn.phase {
	case phase.PhaseMain1, phase.PhaseMain2:
		var cast bot.Cast
		chosen := false
		if d.casts < bot.MaxCastsPerPhase {
			cast, chosen = bot.ChooseSpell(d.level, turn.view, d.rejected, d.rng)
		}
		if !chosen {
			d.send(models.MsgPassPhase, nil)
			return
		}
		d.casts++
		payload := map[string]interface{}{"spell_id": cast.SpellID, "targets": cast.Targets}
		if cast.Choice.Piece != "" {
			payload["choice"] = cast.Choice
		}
		d.send(models.MsgCastSpell, payload)
		if accepted, _ := d.progress(turn); !accepted {
			d.rejected[cast.SpellID] = true
		}
		d.scheduleLocked()

	case phase.PhaseMove:
		if turn.extra {
			d.send(models.MsgPassPhase, nil)
			return
		}
		playable, special := d.untried(turn.playable), d.untried(turn.special)
		move := bot.ChooseMove(d.level, turn.view.FEN, playable, special, botEngine(), d.rng)
		if move == "" {
			return
		}
		d.send(models.MsgMove, map[string]string{"move": move})
		if _, moved := d.progress(turn); !moved {
			logger.L.Warn("Mossa del bot rifiutata", zap.String("room", d.room.ID), zap.String("move", move))
			d.rejected["move:"+move] = true
			d.scheduleLocked()
		}
	}
}

// untried toglie le mosse già rifiutate in questa fase.
func (d *botDriver) untried(moves []string) []string {
	out := make([]string, 0, len(moves))
	for _, m := range moves {
		if !d.rejected["move:"+m] {
			out = append(out, m)
		}
	}
	return out
}

// restoreBot riattacca il bot a una room ripristinata dal DB: gioca sul
// segnaposto del suo lato, e riparte al primo messaggio dopo la riconnessione
// del giocatore.
func restoreBot(room *Room) {
	if room.Bot == nil {
		return
	}
	startBot(room, room.clientOf(room.Bot.Color), *room.Bot)
}
