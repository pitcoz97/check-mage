package match

import (
	"fmt"
	"testing"

	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

func TestNew(t *testing.T) {
	s := New(42)
	if s.CurrentPhase != phase.PhaseDraw {
		t.Errorf("fase iniziale = %s, attesa draw", s.CurrentPhase)
	}
	if s.TurnNumber != 1 {
		t.Errorf("turno iniziale = %d, atteso 1", s.TurnNumber)
	}
	if s.ActivePlayer != PlayerWhite {
		t.Errorf("giocatore iniziale = %s, atteso white", s.ActivePlayer)
	}
	// Mano iniziale = 4 per entrambi.
	if len(s.White.Hand) != spells.StartingHand {
		t.Errorf("mano iniziale bianco = %d, attesa %d", len(s.White.Hand), spells.StartingHand)
	}
	if len(s.Black.Hand) != spells.StartingHand {
		t.Errorf("mano iniziale nero = %d, attesa %d", len(s.Black.Hand), spells.StartingHand)
	}
	if len(s.White.Deck) != spells.DeckSize-spells.StartingHand {
		t.Errorf("mazzo bianco = %d, atteso %d", len(s.White.Deck), spells.DeckSize-spells.StartingHand)
	}
	if s.White.Mana != 1 || s.White.MaxMana != 1 {
		t.Errorf("mana iniziale bianco = %d/%d, atteso 1/1", s.White.Mana, s.White.MaxMana)
	}
}

// advanceToNextTurn esegue un giro completo di fasi dal turno corrente fino al
// nuovo turno avversario, restituendo il risultato del rollover.
func advanceToNextTurn(s *State) AdvanceResult {
	// dovunque siamo, avanza finché non scatta NewTurn
	for i := 0; i < 10; i++ {
		res := s.Advance()
		if res.NewTurn {
			return res
		}
	}
	return AdvanceResult{}
}

func TestAdvance_FullTurnSequence(t *testing.T) {
	s := New(1)

	if r := s.Advance(); r.NewTurn || s.CurrentPhase != phase.PhaseMain1 {
		t.Fatalf("atteso main1 senza nuovo turno, ottenuto %s newTurn=%v", s.CurrentPhase, r.NewTurn)
	}
	if r := s.Advance(); r.NewTurn || s.CurrentPhase != phase.PhaseMove {
		t.Fatalf("atteso move, ottenuto %s", s.CurrentPhase)
	}
	if r := s.Advance(); r.NewTurn || s.CurrentPhase != phase.PhaseMain2 {
		t.Fatalf("atteso main2, ottenuto %s", s.CurrentPhase)
	}
	if s.ActivePlayer != PlayerWhite || s.TurnNumber != 1 {
		t.Errorf("giocatore/turno non devono cambiare prima di end_turn (%s, %d)", s.ActivePlayer, s.TurnNumber)
	}

	// main2 -> (end_turn) -> draw avversario, turno 2, con pesca e mana.
	r := s.Advance()
	if !r.NewTurn {
		t.Fatal("atteso nuovo turno dopo main2")
	}
	if s.CurrentPhase != phase.PhaseDraw || s.ActivePlayer != PlayerBlack || s.TurnNumber != 2 {
		t.Errorf("atteso draw/black/2, ottenuto %s/%s/%d", s.CurrentPhase, s.ActivePlayer, s.TurnNumber)
	}
	if r.Draw == nil || r.Draw.Player != PlayerBlack || r.Draw.CardID == "" {
		t.Errorf("attesa pesca per il nero, ottenuto %+v", r.Draw)
	}
	if r.Mana == nil || r.Mana.Max != 1 {
		t.Errorf("atteso mana nero 1 al primo turno, ottenuto %+v", r.Mana)
	}
}

func TestAdvance_NeverRestsInEndTurn(t *testing.T) {
	s := New(1)
	for i := 0; i < 40; i++ {
		s.Advance()
		if s.CurrentPhase == phase.PhaseEndTurn {
			t.Fatalf("il match non deve mai fermarsi in end_turn (iterazione %d)", i)
		}
	}
}

// TestManaGrowth verifica i mana attesi dai criteri di accettazione:
// turno 1 (bianco) = 1, turno 3 = 2, turno 5 = 3.
func TestManaGrowth(t *testing.T) {
	s := New(1)

	if s.White.MaxMana != 1 {
		t.Fatalf("turno 1: max mana bianco = %d, atteso 1", s.White.MaxMana)
	}

	advanceToNextTurn(s) // -> turno 2 (nero)
	if s.TurnNumber != 2 || s.Black.MaxMana != 1 {
		t.Fatalf("turno 2: nero max mana = %d (turn %d), atteso 1", s.Black.MaxMana, s.TurnNumber)
	}

	advanceToNextTurn(s) // -> turno 3 (bianco)
	if s.TurnNumber != 3 || s.White.MaxMana != 2 {
		t.Fatalf("turno 3: bianco max mana = %d, atteso 2", s.White.MaxMana)
	}

	advanceToNextTurn(s) // -> turno 4 (nero)
	if s.Black.MaxMana != 2 {
		t.Fatalf("turno 4: nero max mana = %d, atteso 2", s.Black.MaxMana)
	}

	advanceToNextTurn(s) // -> turno 5 (bianco)
	if s.White.MaxMana != 3 {
		t.Fatalf("turno 5: bianco max mana = %d, atteso 3", s.White.MaxMana)
	}
}

func TestManaCap(t *testing.T) {
	s := New(1)
	// Avanza molti turni e verifica il tetto a 10.
	for i := 0; i < 60; i++ {
		s.Advance()
	}
	if s.White.MaxMana > spells.MaxManaCap || s.Black.MaxMana > spells.MaxManaCap {
		t.Errorf("il mana ha superato il cap: bianco %d, nero %d", s.White.MaxMana, s.Black.MaxMana)
	}
}

// TestDeterminism: stesso seed => stessi mazzi e stessa sequenza di pesca.
func TestDeterminism(t *testing.T) {
	a := New(12345)
	b := New(12345)

	if len(a.White.Deck) != len(b.White.Deck) {
		t.Fatal("mazzi di lunghezza diversa con lo stesso seed")
	}
	for i := range a.White.Deck {
		if a.White.Deck[i] != b.White.Deck[i] {
			t.Fatalf("mazzo bianco diverge all'indice %d con lo stesso seed", i)
		}
	}
	for i := range a.White.Hand {
		if a.White.Hand[i] != b.White.Hand[i] {
			t.Fatalf("mano bianco diverge all'indice %d con lo stesso seed", i)
		}
	}

	// La sequenza di pesca deve coincidere.
	for i := 0; i < 5; i++ {
		da := advanceToNextTurn(a)
		db := advanceToNextTurn(b)
		if da.Draw.CardID != db.Draw.CardID {
			t.Fatalf("pesca diversa al passo %d: %s vs %s", i, da.Draw.CardID, db.Draw.CardID)
		}
	}
}

// noApply è una callback di applicazione effetti che non fa nulla (per i test
// del solo livello card game).
func noApply(def spells.Spell, targets []string) ([]interface{}, error) {
	return nil, nil
}

func TestCastSpell_Success(t *testing.T) {
	s := New(1)
	s.CurrentPhase = phase.PhaseMain1 // bianco può castare
	// Metti una carta nota e mana sufficiente.
	s.White.Hand = []string{"spark"}
	s.White.Mana = 5

	res, err := s.CastSpell(PlayerWhite, "spark", nil, noApply)
	if err != nil {
		t.Fatalf("cast fallito inatteso: %v", err)
	}
	if res.ManaAfter != 4 { // spark costa 1
		t.Errorf("mana dopo cast = %d, atteso 4", res.ManaAfter)
	}
	if s.White.HandIndex("spark") != -1 {
		t.Error("la carta dovrebbe essere uscita dalla mano")
	}
	if len(s.White.Discard) != 1 || s.White.Discard[0] != "spark" {
		t.Error("la carta dovrebbe essere nello scarto")
	}
}

func TestCastSpell_Rejections(t *testing.T) {
	base := func() *State {
		s := New(1)
		s.CurrentPhase = phase.PhaseMain1
		s.White.Hand = []string{"nova"} // costa 5
		s.White.Mana = 5
		return s
	}

	// Fase sbagliata.
	s := base()
	s.CurrentPhase = phase.PhaseMove
	if _, err := s.CastSpell(PlayerWhite, "nova", nil, noApply); err == nil {
		t.Error("cast in fase move dovrebbe fallire")
	}

	// Non è il tuo turno.
	s = base()
	if _, err := s.CastSpell(PlayerBlack, "nova", nil, noApply); err == nil {
		t.Error("cast fuori turno dovrebbe fallire")
	}

	// Mana insufficiente.
	s = base()
	s.White.Mana = 1
	if _, err := s.CastSpell(PlayerWhite, "nova", nil, noApply); err == nil {
		t.Error("cast con mana insufficiente dovrebbe fallire")
	}

	// Carta non in mano.
	s = base()
	if _, err := s.CastSpell(PlayerWhite, "surge", nil, noApply); err == nil {
		t.Error("cast di carta non in mano dovrebbe fallire")
	}

	// Magia sconosciuta.
	s = base()
	if _, err := s.CastSpell(PlayerWhite, "boom", nil, noApply); err == nil {
		t.Error("cast di magia sconosciuta dovrebbe fallire")
	}

	// Effetto fallito (apply ritorna errore) => cast annullato senza costi.
	s = base()
	failApply := func(def spells.Spell, targets []string) ([]interface{}, error) {
		return nil, fmt.Errorf("bersaglio non valido")
	}
	if _, err := s.CastSpell(PlayerWhite, "nova", nil, failApply); err == nil {
		t.Error("se apply fallisce il cast deve fallire")
	}
	if s.White.Mana != 5 {
		t.Errorf("mana speso nonostante apply fallito: %d, atteso 5", s.White.Mana)
	}
	if s.White.HandIndex("nova") < 0 {
		t.Error("la carta deve restare in mano se apply fallisce")
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
	s := New(1) // draw, white

	if !s.IsActive(PlayerWhite) || s.IsActive(PlayerBlack) {
		t.Error("all'inizio deve essere attivo solo il bianco")
	}
	if !s.Allows(phase.ActionPassPhase) {
		t.Error("la fase draw deve permettere pass_phase")
	}

	s.CurrentPhase = phase.PhaseMove
	if s.Allows(phase.ActionPassPhase) {
		t.Error("la fase move non deve permettere pass_phase")
	}
	if !s.Allows(phase.ActionMakeMove) {
		t.Error("la fase move deve permettere make_move")
	}
}
