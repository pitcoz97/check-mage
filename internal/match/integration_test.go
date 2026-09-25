package match

import (
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// paramInt legge un parametro intero (int o float64) dai Params di un effetto.
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

// applyEffects replica, per il solo livello non scacchistico, la logica di
// game.Room.applySpellEffects: valida i bersagli, applica gelo e scudo al
// tracker, distrugge sulla FEN, pesca e guadagna mana sul match. Serve a guidare
// CastSpell in un test end-to-end senza Stockfish.
func applyEffects(s *State, fen *string, tr *effects.Tracker, caster Player, def spells.Spell, targets []string) ([]interface{}, error) {
	col := effects.White
	if caster == PlayerBlack {
		col = effects.Black
	}
	if err := effects.ValidateTargets(*fen, tr, def.Targets, targets, col); err != nil {
		return nil, err
	}
	var applied []interface{}
	for _, eff := range def.Effects {
		switch eff.Kind {
		case spells.EffectDestroyPiece:
			newFEN, _, err := effects.DestroyPiece(*fen, targets[0])
			if err != nil {
				return nil, err
			}
			*fen = newFEN
			tr.RemoveAt(targets[0])
		case spells.EffectFreezePiece:
			if err := effects.FreezePiece(tr, targets[0], col, paramInt(eff.Params, "duration", 1), def.ID); err != nil {
				return nil, err
			}
		case spells.EffectShieldPiece:
			if err := effects.ShieldPiece(tr, targets[0], col, paramInt(eff.Params, "duration", 1), def.ID); err != nil {
				return nil, err
			}
		case spells.EffectDrawCard:
			for i := 0; i < paramInt(eff.Params, "amount", 1); i++ {
				s.DrawFor(caster)
			}
		case spells.EffectGainMana:
			s.GainMana(caster, paramInt(eff.Params, "amount", 1), false)
		}
		applied = append(applied, map[string]interface{}{"kind": eff.Kind})
	}
	return applied, nil
}

// TestIntegration_MagicGame guida una partita attraverso il card game: combo di
// mana col Patto di sangue e suo limite per turno, Brina → Frantumare, durata
// del gelo, scudo, esaurimento del mazzo. Copre l'integrazione match + effects
// + spells.
func TestIntegration_MagicGame(t *testing.T) {
	s := New(7)
	fen := startFEN
	tr := effects.NewTracker(fen)
	apply := func(def spells.Spell, targets []string) ([]interface{}, error) {
		return applyEffects(s, &fen, tr, s.ActivePlayer, def, targets)
	}

	// Apertura: 4 carte a testa, tocca al Bianco.
	if len(s.White.Hand) != 4 || len(s.Black.Hand) != 4 {
		t.Fatalf("mani iniziali %d/%d, attese 4/4", len(s.White.Hand), len(s.Black.Hand))
	}

	// --- Bianco: il Patto di sangue sblocca una magia altrimenti inaccessibile ---
	s.CurrentPhase = phase.PhaseMain1
	s.White.Hand = []string{"blood_pact", "blood_pact", "ice_chain"}
	s.White.Mana = 1

	// ice_chain (costo 3) non è castabile con 1 mana.
	if _, err := s.CastSpell(PlayerWhite, "ice_chain", []string{"b8"}, apply); err == nil {
		t.Fatal("ice_chain non dovrebbe essere castabile con 1 mana")
	}
	// Patto di sangue sul pedone a2: +2 mana.
	if _, err := s.CastSpell(PlayerWhite, "blood_pact", []string{"a2"}, apply); err != nil {
		t.Fatalf("patto di sangue fallito: %v", err)
	}
	if s.White.Mana != 3 {
		t.Fatalf("dopo il patto mana = %d, atteso 3", s.White.Mana)
	}
	if p, _ := effects.PieceAt(fen, "a2"); p != 0 {
		t.Error("il pedone sacrificato deve sparire dalla scacchiera")
	}
	// Il secondo patto nello stesso turno è rifiutato.
	if _, err := s.CastSpell(PlayerWhite, "blood_pact", []string{"b2"}, apply); err == nil {
		t.Error("il secondo patto di sangue nello stesso turno dovrebbe fallire")
	}
	// Ora la Catena di ghiaccio è castabile (combo) sul cavallo nero in b8.
	if _, err := s.CastSpell(PlayerWhite, "ice_chain", []string{"b8"}, apply); err != nil {
		t.Fatalf("ice_chain dopo il patto fallita: %v", err)
	}
	if s.White.Mana != 0 || !tr.IsFrozen("b8") {
		t.Fatalf("dopo la catena: mana %d, b8 congelato %v", s.White.Mana, tr.IsFrozen("b8"))
	}

	// --- Brina → Frantumare nello stesso turno ---
	s.White.Hand = []string{"frost", "shatter"}
	s.White.Mana = 5
	if _, err := s.CastSpell(PlayerWhite, "shatter", []string{"e7"}, apply); err == nil {
		t.Fatal("Frantumare su un pezzo non congelato dovrebbe fallire")
	}
	if _, err := s.CastSpell(PlayerWhite, "frost", []string{"e7"}, apply); err != nil {
		t.Fatalf("brina fallita: %v", err)
	}
	if _, err := s.CastSpell(PlayerWhite, "shatter", []string{"e7"}, apply); err != nil {
		t.Fatalf("frantumare dopo la brina fallito: %v", err)
	}
	if p, _ := effects.PieceAt(fen, "e7"); p != 0 {
		t.Error("il pedone frantumato deve sparire")
	}

	// --- Durata del gelo: freeze 1 copre il turno del pezzo colpito ---
	tr.TickTurnEnd(effects.White) // fine del turno del bianco
	if !tr.IsFrozen("b8") {
		t.Error("b8 deve restare congelato durante il turno del nero")
	}
	exp := tr.TickTurnEnd(effects.Black) // fine del turno del nero
	if tr.IsFrozen("b8") {
		t.Error("b8 deve tornare mobile all'inizio del turno dopo")
	}
	if len(exp) != 1 || exp[0].Square != "b8" {
		t.Errorf("atteso 1 effetto scaduto su b8, ottenuto %+v", exp)
	}

	// --- Scudo: il Nero protegge un proprio pezzo, poi lo scudo è consumato ---
	s.ActivePlayer = PlayerBlack
	s.CurrentPhase = phase.PhaseMain1
	s.Black.Hand = []string{"shield"}
	s.Black.Mana = 2
	if _, err := s.CastSpell(PlayerBlack, "shield", []string{"d7"}, apply); err != nil {
		t.Fatalf("scudo fallito: %v", err)
	}
	if !tr.HasShield("d7") {
		t.Fatal("d7 dovrebbe avere lo scudo")
	}
	tr.ConsumeShield("d7")
	if tr.HasShield("d7") {
		t.Error("lo scudo dovrebbe essere consumato")
	}

	// --- Esaurimento mazzo: pescare oltre il mazzo non crasha e CardID è vuoto ---
	for len(s.Black.Deck) > 0 {
		s.DrawFor(PlayerBlack)
	}
	if d := s.DrawFor(PlayerBlack); d.CardID != "" {
		t.Errorf("con mazzo vuoto la pesca non deve dare carte, ottenuto %q", d.CardID)
	}
}

// TestIntegration_ManaGrowthOverTurns verifica la progressione del mana lungo
// più turni reali (via Advance/AutoAdvance-less rollover).
func TestIntegration_ManaGrowthOverTurns(t *testing.T) {
	s := New(3)
	want := []struct {
		turn int
		max  int
	}{{1, 1}, {3, 2}, {5, 3}, {7, 4}}
	// Turno 1 già impostato.
	if s.White.MaxMana != 1 {
		t.Fatalf("turno 1 max mana = %d, atteso 1", s.White.MaxMana)
	}
	idx := 1
	for idx < len(want) {
		advanceToNextTurn(s) // -> turno pari (nero)
		advanceToNextTurn(s) // -> turno dispari (bianco)
		if s.TurnNumber == want[idx].turn && s.White.MaxMana != want[idx].max {
			t.Errorf("turno %d: max mana bianco = %d, atteso %d", s.TurnNumber, s.White.MaxMana, want[idx].max)
		}
		idx++
	}
}
