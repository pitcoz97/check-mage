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

// applyEffects replica la logica di game.Room.applySpellEffects per il livello
// non-scacchistico degli effetti (freeze/shield sul tracker, draw/mana sul
// match). Serve a guidare CastSpell in un test end-to-end senza Stockfish.
func applyEffects(s *State, tr *effects.Tracker, caster Player, def spells.Spell, targets []string) ([]interface{}, error) {
	col := effects.White
	if caster == PlayerBlack {
		col = effects.Black
	}
	var applied []interface{}
	for _, eff := range def.Effects {
		switch eff.Kind {
		case spells.EffectNoop:
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		case spells.EffectFreezePiece:
			if err := effects.FreezePiece(tr, targets[0], col, paramInt(eff.Params, "turns", 1), def.ID); err != nil {
				return nil, err
			}
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		case spells.EffectShieldPiece:
			if err := effects.ShieldPiece(tr, targets[0], col, paramInt(eff.Params, "turns", 1), def.ID); err != nil {
				return nil, err
			}
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		case spells.EffectDrawCard:
			for i := 0; i < paramInt(eff.Params, "count", 1); i++ {
				s.DrawFor(caster)
			}
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		case spells.EffectGainMana:
			s.GainMana(caster, paramInt(eff.Params, "amount", 1))
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		default:
			applied = append(applied, map[string]interface{}{"kind": eff.Kind})
		}
	}
	return applied, nil
}

// TestIntegration_MagicGame guida una partita completa attraverso il card game:
// apertura, crescita mana, combo gain_mana, pesca, freeze con scadenza, shield,
// esaurimento mazzo. Copre l'integrazione match + effects + spells.
func TestIntegration_MagicGame(t *testing.T) {
	s := New(7)
	tr := effects.NewTracker(startFEN)
	apply := func(def spells.Spell, targets []string) ([]interface{}, error) {
		return applyEffects(s, tr, s.ActivePlayer, def, targets)
	}

	// Apertura: 4 carte a testa, tocca al Bianco.
	if len(s.White.Hand) != 4 || len(s.Black.Hand) != 4 {
		t.Fatalf("mani iniziali %d/%d, attese 4/4", len(s.White.Hand), len(s.Black.Hand))
	}

	// --- Turno 1 Bianco: combo gain_mana + magia altrimenti inaccessibile ---
	s.CurrentPhase = phase.PhaseMain1
	s.White.Hand = []string{"channel", "surge", "insight"}
	s.White.Mana = 1

	// surge (costo 3) non è castabile con 1 mana.
	if _, err := s.CastSpell(PlayerWhite, "surge", nil, apply); err == nil {
		t.Fatal("surge non dovrebbe essere castabile con 1 mana")
	}
	// channel (+2) porta il mana a 3.
	if _, err := s.CastSpell(PlayerWhite, "channel", nil, apply); err != nil {
		t.Fatalf("channel fallito: %v", err)
	}
	if s.White.Mana != 3 {
		t.Fatalf("dopo channel mana = %d, atteso 3", s.White.Mana)
	}
	// Ora surge è castabile (combo).
	if _, err := s.CastSpell(PlayerWhite, "surge", nil, apply); err != nil {
		t.Fatalf("surge dopo channel fallito: %v", err)
	}
	if s.White.Mana != 0 {
		t.Fatalf("dopo surge mana = %d, atteso 0", s.White.Mana)
	}

	// --- Pesca: insight fa crescere la mano ---
	s.White.Mana = 5
	handBefore, deckBefore := len(s.White.Hand), len(s.White.Deck)
	if _, err := s.CastSpell(PlayerWhite, "insight", nil, apply); err != nil {
		t.Fatalf("insight fallito: %v", err)
	}
	// insight esce dalla mano (-1) ma pesca 1 (+1) → dimensione invariata, mazzo -1.
	if len(s.White.Hand) != handBefore {
		t.Errorf("mano dopo insight = %d, attesa %d", len(s.White.Hand), handBefore)
	}
	if len(s.White.Deck) != deckBefore-1 {
		t.Errorf("mazzo dopo insight = %d, atteso %d", len(s.White.Deck), deckBefore-1)
	}

	// --- Freeze con scadenza dopo 2 turni del proprietario ---
	// Il Nero congela il pedone bianco in e2.
	s.ActivePlayer = PlayerBlack
	s.CurrentPhase = phase.PhaseMain1
	s.Black.Hand = []string{"frostbolt"}
	s.Black.Mana = 2
	if _, err := s.CastSpell(PlayerBlack, "frostbolt", []string{"e2"}, apply); err != nil {
		t.Fatalf("frostbolt fallito: %v", err)
	}
	if !tr.IsFrozen("e2") {
		t.Fatal("e2 dovrebbe essere congelato dopo frostbolt")
	}
	tr.TickColor(effects.White) // fine 1° turno bianco: 2 -> 1
	if !tr.IsFrozen("e2") {
		t.Error("e2 dovrebbe restare congelato dopo 1 turno bianco")
	}
	exp := tr.TickColor(effects.White) // fine 2° turno bianco: 1 -> 0
	if tr.IsFrozen("e2") {
		t.Error("e2 dovrebbe tornare mobile dopo 2 turni bianchi")
	}
	if len(exp) != 1 || exp[0].Square != "e2" {
		t.Errorf("atteso 1 effetto scaduto su e2, ottenuto %+v", exp)
	}

	// --- Shield: il Nero protegge un proprio pezzo, poi lo scudo è consumato ---
	s.Black.Hand = []string{"aegis"}
	s.Black.Mana = 3
	if _, err := s.CastSpell(PlayerBlack, "aegis", []string{"e7"}, apply); err != nil {
		t.Fatalf("aegis fallito: %v", err)
	}
	if !tr.HasShield("e7") {
		t.Fatal("e7 dovrebbe avere lo scudo")
	}
	tr.ConsumeShield("e7")
	if tr.HasShield("e7") {
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
