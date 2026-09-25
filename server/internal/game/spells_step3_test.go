package game

import (
	"encoding/json"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/phase"
)

// Muro di ghiaccio: cast valido, bersaglio non valido, mana, fase; il muro
// toglie le mosse giocabili e scade dopo 2 turni dell'avversario.
func TestIceWall(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "ice_wall", "e5"); err != nil {
		t.Fatalf("muro di ghiaccio: %v", err)
	}
	if !r.Tracker.HasSquareEffect("e5", effects.KindWall) || r.Match.White.Mana != 8 {
		t.Fatalf("muro in e5 e mana 8: %+v, mana %d", r.Tracker.SquareEffects(), r.Match.White.Mana)
	}
	if r.Board.FEN != startFEN {
		t.Error("il muro non cambia la FEN")
	}
	if r.isPlayable("e7e5") || !r.isPlayable("e7e6") {
		t.Error("il pedone nero non entra nel muro ma avanza di uno")
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "ice_wall", "e5"); reasonOf(err) != effects.ReasonWall {
		t.Errorf("un muro sul muro: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "ice_wall", "e2"); reasonOf(err) != effects.ReasonNotEmpty {
		t.Errorf("muro su una casa occupata: %v", err)
	}
	poor := roomWithMana(startFEN)
	poor.Match.White.Mana = 1
	if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, "ice_wall", "e5"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMove, "ice_wall", "e5"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}

	// Scadenza: il tick del bianco non conta, due turni del nero sì.
	newTurn := func(next match.Player) squareViews {
		_, squares := r.tickEffectsOnNewTurn([]match.AdvanceResult{{NewTurn: true, ActivePlayer: next}})
		return squares
	}
	if newTurn(match.PlayerBlack) != nil || newTurn(match.PlayerWhite) != nil || newTurn(match.PlayerBlack) != nil {
		t.Fatal("il muro non deve scadere prima del secondo turno del nero")
	}
	if squares := newTurn(match.PlayerWhite); squares == nil || len(squares[match.PlayerWhite]) != 0 || len(squares[match.PlayerBlack]) != 0 {
		t.Errorf("alla scadenza parte la lista vuota: %v", squares)
	}
}

// Il muro sbarra anche le magie: niente pezzi evocati o spinti dentro.
func TestIceWall_BlocksSpells(t *testing.T) {
	r := richRoom(startFEN)
	r.Tracker.AddSquareEffect("e3", effects.KindWall, 2, "ice_wall", effects.Black)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "forced_march", "e2"); reasonOf(err) != effects.ReasonWall {
		t.Errorf("marcia forzata nel muro: %v", err)
	}
	r = richRoom("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
	r.Tracker.AddSquareEffect("c2", effects.KindWall, 2, "ice_wall", effects.Black)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "conscription", "c2"); reasonOf(err) != effects.ReasonWall {
		t.Errorf("leva militare nel muro: %v", err)
	}
}

// Santuario: nessuna cattura con le mosse né con Frantumare; il Patto di sangue
// sul proprio pedone resta ammesso.
func TestSanctuary(t *testing.T) {
	const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"
	r := richRoom(fen)
	if err := castIn(r, match.PlayerBlack, phase.PhaseMain1, "sanctuary", "d5"); err != nil {
		t.Fatalf("santuario: %v", err)
	}
	if !r.Tracker.HasSquareEffect("d5", effects.KindNoCapture) || r.Match.Black.Mana != 5 {
		t.Fatalf("santuario in d5 e mana 5: %+v", r.Tracker.SquareEffects())
	}
	if r.isPlayable("e4d5") || !r.isPlayable("e4e5") {
		t.Error("il pedone bianco non cattura in d5 ma avanza")
	}

	effects.FreezePiece(r.Tracker, "d5", effects.White, 1, "frost")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "shatter", "d5"); reasonOf(err) != effects.ReasonNoCapture {
		t.Errorf("frantumare sul santuario: %v", err)
	}
	if r.Match.White.Mana != 10 {
		t.Error("il cast rifiutato non costa mana")
	}
	if err := castIn(r, match.PlayerBlack, phase.PhaseMain1, "blood_pact", "d5"); err != nil {
		t.Errorf("patto di sangue sul proprio pedone nel santuario: %v", err)
	}

	// Una casa qualsiasi: anche occupata o col muro.
	r = richRoom(startFEN)
	r.Tracker.AddSquareEffect("e4", effects.KindWall, 2, "ice_wall", effects.White)
	for _, sq := range []string{"e2", "e4"} {
		if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "sanctuary", sq); err != nil {
			t.Errorf("santuario in %s: %v", sq, err)
		}
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMove, "sanctuary", "e4"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}
	poor := roomWithMana(startFEN)
	poor.Match.White.Mana = 4
	if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, "sanctuary", "e4"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
}

// Gli stati delle case sono nel game_state e sopravvivono a salvataggio e
// ripristino; uno snapshot senza square_effects vale come case senza stati.
func TestSquareEffects_StateAndSnapshot(t *testing.T) {
	r := richRoom(startFEN)
	r.Tracker.AddSquareEffect("d4", effects.KindWall, 2, "ice_wall", effects.White)
	if got, ok := r.publicState(match.PlayerWhite)["square_effects"].([]effects.SquareEffectInfo); !ok || len(got) != 1 || got[0].Square != "d4" {
		t.Errorf("square_effects = %v", r.publicState(match.PlayerWhite)["square_effects"])
	}
	data, err := json.Marshal(r.buildSnapshot())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	restored := roomFromSnapshot(snap)
	if !restored.Tracker.HasSquareEffect("d4", effects.KindWall) {
		t.Fatal("il muro salvato deve tornare")
	}
	if e := restored.Tracker.SquareEffects()[0].Effects[0]; e.RemainingTurns != 2 || e.Caster != effects.White {
		t.Errorf("muro ripristinato: %+v", e)
	}

	snap.SquareEffects = nil
	if got := roomFromSnapshot(snap).Tracker.SquareEffects(); len(got) != 0 {
		t.Errorf("snapshot senza stati delle case: %v", got)
	}
}

// Senza mosse giocabili per colpa dei muri vale lo stallo (o il matto): lo
// decide engine.classify sulle mosse che isPlayable lascia passare.
func TestIsPlayable_Walls(t *testing.T) {
	r := richRoom("k7/8/8/8/8/8/8/K7 w - - 0 1")
	for _, sq := range []string{"a2", "b1", "b2"} {
		r.Tracker.AddSquareEffect(sq, effects.KindWall, 2, "ice_wall", effects.Black)
	}
	for _, move := range []string{"a1a2", "a1b1", "a1b2"} {
		if r.isPlayable(move) {
			t.Errorf("%s deve essere bloccata dal muro", move)
		}
	}
}
