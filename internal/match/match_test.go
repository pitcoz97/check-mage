package match

import (
	"testing"

	"chess-server/internal/phase"
)

func TestNew(t *testing.T) {
	s := New()
	if s.CurrentPhase != phase.PhaseDraw {
		t.Errorf("fase iniziale = %s, attesa draw", s.CurrentPhase)
	}
	if s.TurnNumber != 1 {
		t.Errorf("turno iniziale = %d, atteso 1", s.TurnNumber)
	}
	if s.ActivePlayer != PlayerWhite {
		t.Errorf("giocatore iniziale = %s, atteso white", s.ActivePlayer)
	}
}

// TestAdvance_FullTurnSequence verifica la sequenza completa di un turno e il
// passaggio all'avversario, come da criteri di accettazione dello Step 1.
func TestAdvance_FullTurnSequence(t *testing.T) {
	s := New()
	var noHooks Hooks

	// draw -> main1
	s.Advance(noHooks)
	if s.CurrentPhase != phase.PhaseMain1 {
		t.Fatalf("atteso main1, ottenuto %s", s.CurrentPhase)
	}

	// main1 -> move
	s.Advance(noHooks)
	if s.CurrentPhase != phase.PhaseMove {
		t.Fatalf("atteso move, ottenuto %s", s.CurrentPhase)
	}

	// move -> main2 (la mossa scacchistica fa avanzare qui)
	s.Advance(noHooks)
	if s.CurrentPhase != phase.PhaseMain2 {
		t.Fatalf("atteso main2, ottenuto %s", s.CurrentPhase)
	}
	if s.ActivePlayer != PlayerWhite {
		t.Errorf("il giocatore non deve cambiare prima di end_turn, è %s", s.ActivePlayer)
	}
	if s.TurnNumber != 1 {
		t.Errorf("il turno non deve cambiare prima di end_turn, è %d", s.TurnNumber)
	}

	// main2 -> (end_turn) -> draw avversario, turno 2
	s.Advance(noHooks)
	if s.CurrentPhase != phase.PhaseDraw {
		t.Fatalf("atteso draw avversario, ottenuto %s", s.CurrentPhase)
	}
	if s.ActivePlayer != PlayerBlack {
		t.Errorf("atteso black attivo, è %s", s.ActivePlayer)
	}
	if s.TurnNumber != 2 {
		t.Errorf("atteso turno 2, è %d", s.TurnNumber)
	}
}

// TestAdvance_NeverRestsInEndTurn verifica che end_turn non sia mai osservabile.
func TestAdvance_NeverRestsInEndTurn(t *testing.T) {
	s := New()
	for i := 0; i < 40; i++ {
		s.Advance(Hooks{})
		if s.CurrentPhase == phase.PhaseEndTurn {
			t.Fatalf("il match non deve mai fermarsi in end_turn (iterazione %d)", i)
		}
	}
}

// TestAdvance_RolloverFiresHooksInOrder verifica che gli hook scattino nel giusto
// ordine e vedano il giocatore corretto.
func TestAdvance_RolloverFiresHooksInOrder(t *testing.T) {
	s := New()
	s.CurrentPhase = phase.PhaseMain2 // pronti a chiudere il turno del bianco

	var order []string
	hooks := Hooks{
		OnEndTurn: func(st *State) {
			order = append(order, "endturn")
			if st.ActivePlayer != PlayerWhite {
				t.Errorf("OnEndTurn deve vedere il giocatore uscente (white), visto %s", st.ActivePlayer)
			}
		},
		OnDraw: func(st *State) {
			order = append(order, "draw")
			if st.ActivePlayer != PlayerBlack {
				t.Errorf("OnDraw deve vedere il nuovo giocatore (black), visto %s", st.ActivePlayer)
			}
		},
	}

	s.Advance(hooks)

	if len(order) != 2 || order[0] != "endturn" || order[1] != "draw" {
		t.Errorf("ordine hook = %v, atteso [endturn draw]", order)
	}
}

func TestOpponent(t *testing.T) {
	if PlayerWhite.Opponent() != PlayerBlack {
		t.Error("l'avversario del bianco deve essere il nero")
	}
	if PlayerBlack.Opponent() != PlayerWhite {
		t.Error("l'avversario del nero deve essere il bianco")
	}
}

func TestIsActiveAndAllows(t *testing.T) {
	s := New() // draw, white

	if !s.IsActive(PlayerWhite) {
		t.Error("white deve essere attivo all'inizio")
	}
	if s.IsActive(PlayerBlack) {
		t.Error("black non deve essere attivo all'inizio")
	}
	if !s.Allows(phase.ActionPassPhase) {
		t.Error("la fase draw deve permettere pass_phase")
	}
	if s.Allows(phase.ActionMakeMove) {
		t.Error("la fase draw non deve permettere make_move")
	}

	s.CurrentPhase = phase.PhaseMove
	if s.Allows(phase.ActionPassPhase) {
		t.Error("la fase move non deve permettere pass_phase")
	}
	if !s.Allows(phase.ActionMakeMove) {
		t.Error("la fase move deve permettere make_move")
	}
}
