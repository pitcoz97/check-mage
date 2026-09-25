package game

import (
	"encoding/json"
	"testing"
	"time"

	"chess-server/internal/config"
	"chess-server/internal/effects"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
)

const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// newTestClient crea un client senza connessione con un buffer ampio.
func newTestClient(id int, name string) *Client {
	return &Client{UserID: id, Username: name, Send: make(chan []byte, 512)}
}

// newTestRoom costruisce una room senza Stockfish né timer.
func newTestRoom(fen string) (*Room, *Client, *Client) {
	white, black := newTestClient(1, "alice"), newTestClient(2, "bob")
	room := &Room{
		ID:                "room-1-2",
		White:             white,
		Black:             black,
		Board:             &Board{FEN: fen, Moves: []string{}, Turn: sideToMove(fen), Status: StatusActive},
		Match:             match.New(1),
		Tracker:           effects.NewTracker(fen),
		WhiteTime:         10 * time.Minute,
		BlackTime:         10 * time.Minute,
		BaseTime:          10 * time.Minute,
		Increment:         5 * time.Second,
		timerStop:         make(chan struct{}),
		disconnectedTimer: map[int]*time.Timer{},
		posCounts:         map[string]int{},
	}
	white.Room, black.Room = room, room
	return room, white, black
}

func countType(msgs []models.WSMessage, typ string) int {
	n := 0
	for _, m := range msgs {
		if m.Type == typ {
			n++
		}
	}
	return n
}

func lastErrorCode(t *testing.T, msgs []models.WSMessage) string {
	t.Helper()
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Type == models.MsgError {
			var p struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(msgs[i].Payload, &p); err != nil {
				t.Fatalf("payload error non valido: %v", err)
			}
			return p.Code
		}
	}
	t.Fatal("nessun messaggio error ricevuto")
	return ""
}

func resetManager() {
	GameManager = &Manager{rooms: map[string]*Room{}, userRooms: map[int]string{}}
}

// B1: dopo una resa la partita è conclusa; la disconnessione successiva non
// deve produrre un secondo game_over (né un secondo salvataggio/ELO).
func TestResignThenDisconnect_SingleGameOver(t *testing.T) {
	resetManager()
	config.C = &config.Config{ReconnectTimeout: 20 * time.Millisecond}
	room, white, black := newTestRoom(startFEN)

	room.handleResign(white)
	if room.Board.Status != StatusResigned {
		t.Errorf("status = %s, atteso %s", room.Board.Status, StatusResigned)
	}

	room.Leave(white)
	time.Sleep(80 * time.Millisecond)

	if n := countType(drain(black), models.MsgGameOver); n != 1 {
		t.Errorf("game_over ricevuti dal nero = %d, atteso 1", n)
	}
}

// B4: nessuna azione di gioco è accettata dopo la fine della partita.
func TestActionsRejectedAfterGameOver(t *testing.T) {
	resetManager()
	room, white, black := newTestRoom(startFEN)
	room.handleResign(black)
	drain(white)

	room.HandleMessage(white, models.WSMessage{Type: models.MsgPassPhase})
	if code := lastErrorCode(t, drain(white)); code != string(gameerr.GameOver) {
		t.Errorf("code = %s, atteso game_over", code)
	}

	room.handleResign(white)
	msgs := drain(white)
	if countType(msgs, models.MsgGameOver) != 0 {
		t.Error("una seconda resa non deve produrre un altro game_over")
	}
}

// Chiudere la partita due volte restituisce l'esito solo la prima volta.
func TestFinishLocked_Idempotent(t *testing.T) {
	room, _, _ := newTestRoom(startFEN)
	room.mu.Lock()
	first := room.finishLocked(models.ResultWhiteWins, "timeout", StatusTimeout)
	second := room.finishLocked(models.ResultBlackWins, "abandonment", StatusAbandoned)
	room.mu.Unlock()
	if first == nil || second != nil {
		t.Fatalf("atteso esito solo alla prima chiusura: %v %v", first, second)
	}
	if room.Board.Status != StatusTimeout {
		t.Errorf("status = %s, atteso timeout", room.Board.Status)
	}
}

// Il timeout chiude la partita con lo status "timeout".
func TestTimerTimeout(t *testing.T) {
	resetManager()
	room, _, black := newTestRoom(startFEN)
	room.WhiteTime = 150 * time.Millisecond
	room.mu.Lock()
	room.ensureTimer()
	room.mu.Unlock()
	time.Sleep(500 * time.Millisecond)

	if room.isActive() {
		t.Fatal("la partita dovrebbe essere finita per timeout")
	}
	room.mu.Lock()
	status := room.Board.Status
	room.mu.Unlock()
	if status != StatusTimeout {
		t.Errorf("status = %s, atteso timeout", status)
	}
	if n := countType(drain(black), models.MsgGameOver); n != 1 {
		t.Errorf("game_over = %d, atteso 1", n)
	}
}

// B2: la chiusura della connessione vecchia, dopo una riconnessione, non avvia
// il timer d'abbandono.
func TestLeave_IgnoresReplacedConnection(t *testing.T) {
	resetManager()
	config.C = &config.Config{ReconnectTimeout: 20 * time.Millisecond}
	room, oldWhite, black := newTestRoom(startFEN)

	room.Reconnect(newTestClient(1, "alice"))
	drain(black)

	room.Leave(oldWhite)
	time.Sleep(80 * time.Millisecond)

	if !room.isActive() {
		t.Fatal("la partita non deve finire per la chiusura di una connessione già sostituita")
	}
	if countType(drain(black), models.MsgOpponentDisconnected) != 0 {
		t.Error("l'avversario non deve ricevere opponent_disconnected")
	}
}

// Un giocatore che si riconnette entro il timeout annulla l'abbandono.
func TestLeaveThenReconnect_NoAbandonment(t *testing.T) {
	resetManager()
	config.C = &config.Config{ReconnectTimeout: 50 * time.Millisecond}
	room, white, _ := newTestRoom(startFEN)

	room.Leave(white)
	room.Reconnect(newTestClient(1, "alice"))
	time.Sleep(120 * time.Millisecond)

	if !room.isActive() {
		t.Error("la riconnessione deve annullare il timer d'abbandono")
	}
}

// P0-5 e P2-9: game_state porta identità dei giocatori e time control.
func TestPublicState_PlayersAndTimeControl(t *testing.T) {
	room, _, _ := newTestRoom(startFEN)
	room.mu.Lock()
	data, err := json.Marshal(room.publicState())
	room.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		WhitePlayer playerInfo `json:"white_player"`
		BlackPlayer playerInfo `json:"black_player"`
		TimeControl struct {
			BaseMs      int64 `json:"base_ms"`
			IncrementMs int64 `json:"increment_ms"`
		} `json:"time_control"`
	}
	if err := json.Unmarshal(data, &st); err != nil {
		t.Fatal(err)
	}
	if st.WhitePlayer != (playerInfo{ID: 1, Username: "alice"}) || st.BlackPlayer != (playerInfo{ID: 2, Username: "bob"}) {
		t.Errorf("giocatori = %+v / %+v", st.WhitePlayer, st.BlackPlayer)
	}
	if st.TimeControl.BaseMs != 600000 || st.TimeControl.IncrementMs != 5000 {
		t.Errorf("time_control = %+v", st.TimeControl)
	}
	if room.TimeControl() != "10+5" {
		t.Errorf("TimeControl() = %s, atteso 10+5", room.TimeControl())
	}
}

// B11: la casella catturata en passant è quella del pedone, non quella d'arrivo.
func TestCaptureSquare(t *testing.T) {
	const epFEN = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"
	if got := captureSquare(epFEN, "e5", "d6"); got != "d5" {
		t.Errorf("en passant: %q, atteso d5", got)
	}
	if got := captureSquare(startFEN, "e2", "e4"); got != "" {
		t.Errorf("mossa senza cattura: %q", got)
	}
	const capFEN = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"
	if got := captureSquare(capFEN, "e4", "d5"); got != "d5" {
		t.Errorf("cattura normale: %q, atteso d5", got)
	}
}

// B7: una mossa assorbita da uno scudo compare come "--" nel PGN.
func TestPGN_NullMove(t *testing.T) {
	room, _, _ := newTestRoom(startFEN)
	room.Board.Moves = []string{"e2e4", NullMove, "d2d4"}
	if got := room.PGN(); got != "1. e2e4 -- 2. d2d4" {
		t.Errorf("PGN = %q", got)
	}
}

// B10: lo stesso utente che rientra in coda sostituisce la connessione vecchia.
func TestJoinQueue_SameUserReplacesWaiting(t *testing.T) {
	resetManager()
	first, second := newTestClient(7, "carol"), newTestClient(7, "carol")
	GameManager.JoinQueue(first)
	GameManager.JoinQueue(second)

	if GameManager.waiting != second {
		t.Fatal("la connessione nuova deve prendere il posto in coda")
	}
	if code := lastErrorCode(t, drain(first)); code != string(gameerr.ReplacedByNewConnection) {
		t.Errorf("code = %s, atteso replaced_by_new_connection", code)
	}

	// La chiusura della connessione vecchia non toglie dalla coda quella nuova.
	GameManager.LeaveQueue(first)
	if GameManager.waiting != second {
		t.Error("LeaveQueue della connessione vecchia non deve rimuovere quella nuova")
	}
}

// RemoveRoom non cancella l'associazione di un utente già entrato in un'altra partita.
func TestRemoveRoom_KeepsNewerMapping(t *testing.T) {
	resetManager()
	GameManager.rooms["old"] = &Room{ID: "old"}
	GameManager.userRooms[1] = "new"
	GameManager.userRooms[2] = "old"

	GameManager.RemoveRoom("old", 1, 2)
	if GameManager.userRooms[1] != "new" {
		t.Error("l'associazione alla room nuova deve restare")
	}
	if _, ok := GameManager.userRooms[2]; ok {
		t.Error("l'associazione alla room rimossa deve sparire")
	}
}

// Un pass_phase fuori fase restituisce wrong_phase con la fase nei dettagli.
func TestPassPhase_WrongPhaseCode(t *testing.T) {
	room, white, _ := newTestRoom(startFEN)
	room.Match.CurrentPhase = phase.PhaseMove
	room.handlePassPhase(white)
	if code := lastErrorCode(t, drain(white)); code != string(gameerr.WrongPhase) {
		t.Errorf("code = %s, atteso wrong_phase", code)
	}
}
