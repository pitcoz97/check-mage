package game

import (
	"encoding/json"
	"testing"
	"time"

	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// clockRoom è una room di test col Bianco attivo nella fase data.
func clockRoom(t *testing.T, fen string, current phase.Phase) (*Room, *Client, *Client) {
	t.Helper()
	resetManager()
	room, white, black := newTestRoom(fen)
	room.Match.ActivePlayer, room.Match.CurrentPhase = match.PlayerWhite, current
	return room, white, black
}

// payloadOf restituisce il payload dell'ultimo messaggio del tipo dato.
func payloadOf(t *testing.T, msgs []models.WSMessage, typ string) map[string]interface{} {
	t.Helper()
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Type == typ {
			var p map[string]interface{}
			if err := json.Unmarshal(msgs[i].Payload, &p); err != nil {
				t.Fatalf("%s non valido: %v", typ, err)
			}
			return p
		}
	}
	t.Fatalf("nessun %s", typ)
	return nil
}

func expire(r *Room) {
	r.mu.Lock()
	key := r.currentPhaseKey()
	r.mu.Unlock()
	r.expirePhase(key)
}

func TestPhaseClock_RestartsAtEveryPhase(t *testing.T) {
	room, _, _ := clockRoom(t, startFEN, phase.PhaseMain1)
	room.mu.Lock()
	defer room.mu.Unlock()
	if left := room.syncedPhaseLeft(); left != 90*time.Second {
		t.Errorf("Magie 1 = %v, attesi 90s", left)
	}
	room.PhaseLeft = 10 * time.Second
	room.Match.CurrentPhase = phase.PhaseMove
	if left := room.syncedPhaseLeft(); left != 120*time.Second {
		t.Errorf("Mossa = %v, attesi 120s", left)
	}
	room.PhaseLeft = 5 * time.Second
	if left := room.syncedPhaseLeft(); left != 5*time.Second {
		t.Errorf("stessa fase: il tempo non riparte (%v)", left)
	}
}

func TestPhaseTimeout_MainPassesAndCounts(t *testing.T) {
	room, _, black := clockRoom(t, startFEN, phase.PhaseMain1)
	expire(room)
	if room.Match.CurrentPhase != phase.PhaseMove || room.strikes[match.PlayerWhite] != 1 {
		t.Fatalf("fase %s, scadenze %d: Magie 1 scaduta va passata e contata", room.Match.CurrentPhase, room.strikes[match.PlayerWhite])
	}
	p := payloadOf(t, drain(black), models.MsgPhaseTimeout)
	if p["player"] != "white" || p["phase"] != "main1" || p["strikes"] != float64(1) {
		t.Errorf("phase_timeout = %v", p)
	}
	if !room.isActive() {
		t.Error("una scadenza non fa perdere")
	}
}

func TestPhaseTimeout_ThirdStrikeLoses(t *testing.T) {
	room, _, black := clockRoom(t, startFEN, phase.PhaseMain2)
	room.strikes[match.PlayerWhite] = MaxStrikes - 1
	expire(room)
	if room.isActive() || room.Board.Status != StatusTimeout {
		t.Fatalf("la terza scadenza di fila fa perdere (status %s)", room.Board.Status)
	}
	over := payloadOf(t, drain(black), models.MsgGameOver)
	if over["result"] != models.ResultBlackWins || over["reason"] != ReasonTimeoutStrikes {
		t.Errorf("game_over = %v", over)
	}
}

func TestPhaseTimeout_ActionsResetStrikes(t *testing.T) {
	// Un passa volontario in Magie azzera.
	room, white, _ := clockRoom(t, startFEN, phase.PhaseMain1)
	room.strikes[match.PlayerWhite] = 2
	room.handlePassPhase(white)
	if room.strikes[match.PlayerWhite] != 0 {
		t.Errorf("dopo un passa: %d scadenze", room.strikes[match.PlayerWhite])
	}

	// Una magia lanciata azzera: Scudo sulla torre in a1.
	room, white, _ = clockRoom(t, "4k2b/7p/8/8/8/8/4P3/R3K3 w - - 0 1", phase.PhaseMain1)
	room.Match.White.Hand, room.Match.White.Mana = []string{"shield"}, 5
	room.strikes[match.PlayerWhite] = 2
	room.handleCastSpell(white, "shield", []string{"a1"}, spells.Choice{})
	if room.strikes[match.PlayerWhite] != 0 {
		t.Errorf("dopo una magia: %d scadenze", room.strikes[match.PlayerWhite])
	}
}

func TestPhaseTimeout_MoveLoses(t *testing.T) {
	room, _, black := clockRoom(t, startFEN, phase.PhaseMove)
	expire(room)
	if room.isActive() {
		t.Fatal("la mossa scaduta fa perdere")
	}
	over := payloadOf(t, drain(black), models.MsgGameOver)
	if over["result"] != models.ResultBlackWins || over["reason"] != ReasonTimeout {
		t.Errorf("game_over = %v", over)
	}
}

// Con la sola seconda mossa di Fretta in sospeso il tempo scaduto la salta.
func TestPhaseTimeout_HasteSecondMoveSkipped(t *testing.T) {
	room, _, _ := clockRoom(t, startFEN, phase.PhaseMove)
	room.extra = &extraMove{Player: match.PlayerWhite, Turn: 1, Active: true, FENAfterFirst: startFEN}
	// Una carta da 0 mana: la main2 non passa da sola, quindi niente cambio di turno (che chiederebbe Stockfish).
	room.Match.White.Hand = []string{"blood_pact"}
	expire(room)
	if !room.isActive() || room.extra != nil || room.Match.CurrentPhase == phase.PhaseMove {
		t.Errorf("attiva %v, extra %v, fase %s: la seconda mossa va saltata", room.isActive(), room.extra, room.Match.CurrentPhase)
	}
}

// Se il giocatore ha appena agito, lo scadere della fase precedente non fa nulla.
func TestPhaseTimeout_StaleKeyIgnored(t *testing.T) {
	room, _, _ := clockRoom(t, startFEN, phase.PhaseMain1)
	room.expirePhase("1/white/draw")
	if room.Match.CurrentPhase != phase.PhaseMain1 || room.strikes[match.PlayerWhite] != 0 {
		t.Errorf("fase %s, scadenze %d: nulla doveva cambiare", room.Match.CurrentPhase, room.strikes[match.PlayerWhite])
	}
}

// Il timer scala il tempo della fase e la passa quando scade.
func TestPhaseTimer_RunsAndExpires(t *testing.T) {
	room, _, black := clockRoom(t, startFEN, phase.PhaseMain1)
	room.MainTime = 150 * time.Millisecond
	room.mu.Lock()
	room.ensureTimer()
	room.mu.Unlock()
	time.Sleep(400 * time.Millisecond)
	room.stopTimer()
	if countType(drain(black), models.MsgPhaseTimeout) == 0 {
		t.Error("atteso phase_timeout dal timer")
	}
}
