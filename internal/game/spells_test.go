package game

import (
	"encoding/json"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// castIn lancia una magia nella room passando da match.CastSpell (turno, fase,
// mano, mana, limiti, numero di bersagli) e da applySpellEffects, come fa
// handleCastSpell ma senza broadcast né Stockfish. Mette la carta in mano al
// giocatore e lo rende attivo nella fase data.
func castIn(room *Room, p match.Player, ph phase.Phase, id string, targets ...string) error {
	room.Match.ActivePlayer = p
	room.Match.CurrentPhase = ph
	ps := room.Match.White
	if p == match.PlayerBlack {
		ps = room.Match.Black
	}
	ps.Hand = append(ps.Hand, id)
	_, err := room.Match.CastSpell(p, id, targets, func(def spells.Spell, t []string) ([]interface{}, error) {
		applied, _, _, err := room.applySpellEffects(def, t, p)
		return applied, err
	})
	return err
}

// roomWithMana costruisce una room di test con 5 mana per entrambi.
func roomWithMana(fen string) *Room {
	room, _, _ := newTestRoom(fen)
	room.Match.White.Mana = 5
	room.Match.Black.Mana = 5
	return room
}

func code(err error) gameerr.Code {
	if err == nil {
		return ""
	}
	return gameerr.From(err).Code
}

func pieceAt(t *testing.T, fen, square string) byte {
	t.Helper()
	p, err := effects.PieceAt(fen, square)
	if err != nil {
		t.Fatalf("PieceAt(%s): %v", square, err)
	}
	return p
}

// Ogni magia dello step 1: cast valido con lo stato atteso, bersaglio non
// valido, mana insufficiente, fase sbagliata. I rifiuti non cambiano la FEN.
func TestSpells_Step1(t *testing.T) {
	const kings = "4k3/8/8/8/8/8/8/4K3 w - - 0 1"
	cases := []struct {
		id      string
		fen     string
		setup   func(r *Room)
		valid   []string
		invalid []string
		check   func(t *testing.T, r *Room)
	}{
		{id: "frost", fen: startFEN, valid: []string{"e7"}, invalid: []string{"b8"},
			check: func(t *testing.T, r *Room) {
				if !r.Tracker.IsFrozen("e7") {
					t.Error("e7 deve essere congelato")
				}
			}},
		{id: "ice_chain", fen: startFEN, valid: []string{"b8"}, invalid: []string{"e7"},
			check: func(t *testing.T, r *Room) {
				if !r.Tracker.IsFrozen("b8") {
					t.Error("b8 deve essere congelato")
				}
			}},
		{id: "shatter", fen: startFEN, valid: []string{"e7"}, invalid: []string{"d7"},
			setup: func(r *Room) { effects.FreezePiece(r.Tracker, "e7", effects.White, 1, "frost") },
			check: func(t *testing.T, r *Room) {
				if pieceAt(t, r.Board.FEN, "e7") != 0 {
					t.Error("il pedone congelato in e7 deve sparire")
				}
			}},
		{id: "blood_pact", fen: startFEN, valid: []string{"a2"}, invalid: []string{"a7"},
			check: func(t *testing.T, r *Room) {
				if pieceAt(t, r.Board.FEN, "a2") != 0 {
					t.Error("il pedone sacrificato deve sparire")
				}
				if r.Match.White.Mana != 7 {
					t.Errorf("mana = %d, atteso 7 (5 + 2, costo 0)", r.Match.White.Mana)
				}
			}},
		{id: "blink", fen: "4k3/8/8/8/8/8/8/1N2K3 w - - 0 1", valid: []string{"b1", "c3"}, invalid: []string{"b1", "b4"},
			check: func(t *testing.T, r *Room) {
				if pieceAt(t, r.Board.FEN, "c3") != 'N' || pieceAt(t, r.Board.FEN, "b1") != 0 {
					t.Errorf("il cavallo deve passare da b1 a c3: %s", r.Board.FEN)
				}
			}},
		{id: "shield", fen: startFEN, valid: []string{"d2"}, invalid: []string{"d1"},
			check: func(t *testing.T, r *Room) {
				if !r.Tracker.HasShield("d2") {
					t.Error("d2 deve avere lo scudo")
				}
			}},
		{id: "royal_shield", fen: startFEN, valid: []string{"d1"}, invalid: []string{"d2"},
			check: func(t *testing.T, r *Room) {
				if !r.Tracker.HasShield("d1") {
					t.Error("la regina in d1 deve avere lo scudo")
				}
			}},
		{id: "forced_march", fen: startFEN, valid: []string{"e2"}, invalid: []string{"e7"},
			check: func(t *testing.T, r *Room) {
				if pieceAt(t, r.Board.FEN, "e3") != 'P' || pieceAt(t, r.Board.FEN, "e2") != 0 {
					t.Errorf("il pedone deve avanzare da e2 a e3: %s", r.Board.FEN)
				}
			}},
		{id: "conscription", fen: kings, valid: []string{"b2"}, invalid: []string{"b3"},
			check: func(t *testing.T, r *Room) {
				if pieceAt(t, r.Board.FEN, "b2") != 'P' {
					t.Errorf("un pedone bianco deve comparire in b2: %s", r.Board.FEN)
				}
			}},
	}

	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			def := spells.Catalog[c.id]
			fresh := func() *Room {
				r := roomWithMana(c.fen)
				if c.setup != nil {
					c.setup(r)
				}
				return r
			}

			r := fresh()
			if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, c.id, c.valid...); err != nil {
				t.Fatalf("cast valido rifiutato: %v", err)
			}
			c.check(t, r)

			r = fresh()
			if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, c.id, c.invalid...); code(err) != gameerr.InvalidTarget {
				t.Errorf("bersaglio non valido: code = %q, atteso invalid_target (%v)", code(err), err)
			}
			if r.Board.FEN != c.fen {
				t.Error("un cast rifiutato non deve cambiare la FEN")
			}

			if def.ManaCost > 0 {
				r = fresh()
				r.Match.White.Mana = def.ManaCost - 1
				if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, c.id, c.valid...); code(err) != gameerr.InsufficientMana {
					t.Errorf("mana insufficiente: code = %q", code(err))
				}
			}

			r = fresh()
			if err := castIn(r, match.PlayerWhite, phase.PhaseMove, c.id, c.valid...); code(err) != gameerr.WrongPhase {
				t.Errorf("fase sbagliata: code = %q", code(err))
			}
		})
	}
}

// Il secondo Patto di sangue nello stesso turno è rifiutato con limit_reached.
func TestBloodPact_OncePerTurn(t *testing.T) {
	r := roomWithMana(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "a2"); err != nil {
		t.Fatalf("primo patto: %v", err)
	}
	fen := r.Board.FEN
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "b2"); code(err) != gameerr.LimitReached {
		t.Errorf("secondo patto: code = %q, atteso limit_reached", code(err))
	}
	if r.Board.FEN != fen || r.Match.White.Mana != 7 {
		t.Error("il secondo patto non deve cambiare scacchiera né mana")
	}
}

// Regola globale (M5): nessuna magia dà scacco né lascia sotto scacco il
// proprio re, in main1 come in main2. Un cast rifiutato non lascia tracce.
func TestSpells_NoCheckRule(t *testing.T) {
	// Blink che darebbe scacco: il cavallo in f6 attaccherebbe il re in e8.
	for _, ph := range []phase.Phase{phase.PhaseMain1, phase.PhaseMain2} {
		fen := "4k3/8/8/8/5N2/8/8/7K w - - 0 1"
		if ph == phase.PhaseMain2 {
			fen = "4k3/8/8/8/5N2/8/8/7K b - - 0 1" // dopo la mossa il tratto è al nero
		}
		r := roomWithMana(fen)
		err := castIn(r, match.PlayerWhite, ph, "blink", "f4", "f6")
		if code(err) != gameerr.IllegalPosition {
			t.Errorf("%s: blink che dà scacco, code = %q, atteso illegal_position", ph, code(err))
		}
		if r.Board.FEN != fen || r.Match.White.Mana != 5 {
			t.Errorf("%s: il cast rifiutato non deve cambiare stato né mana", ph)
		}
	}

	// Frantumare che scopre il re nero (cavallo congelato inchiodato in e7).
	const pinned = "4k3/4n3/8/8/8/8/8/4R2K w - - 0 1"
	r := roomWithMana(pinned)
	effects.FreezePiece(r.Tracker, "e7", effects.White, 1, "frost")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "shatter", "e7"); code(err) != gameerr.IllegalPosition {
		t.Errorf("frantumare che scopre il re: code = %q", code(err))
	}
	if !r.Tracker.IsFrozen("e7") || r.Board.FEN != pinned {
		t.Error("un cast rifiutato non deve toccare Tracker e FEN")
	}

	// Blink dell'alfiere inchiodato: il proprio re resterebbe sotto scacco.
	const ownPin = "4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1"
	r = roomWithMana(ownPin)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blink", "e2", "c4"); code(err) != gameerr.IllegalPosition {
		t.Errorf("blink che scopre il proprio re: code = %q", code(err))
	}

	// Re nero già sotto scacco per la mossa appena giocata: una magia che non
	// c'entra resta ammessa in main2.
	const checked = "4k3/8/8/8/8/8/8/4R2K b - - 0 1"
	r = roomWithMana(checked)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain2, "conscription", "b2"); err != nil {
		t.Errorf("magia con lo scacco dato da una mossa: %v", err)
	}
}

func TestForcedMarch_Rejections(t *testing.T) {
	// Casa davanti occupata: il movimento relativo non cattura.
	const blocked = "rnbqkbnr/pppppppp/8/8/8/4N3/PPPPPPPP/R1BQKBNR w KQkq - 0 1"
	r := roomWithMana(blocked)
	err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "forced_march", "e2")
	if code(err) != gameerr.InvalidTarget || gameerr.From(err).Details["reason"] != effects.ReasonNotEmpty {
		t.Errorf("casa occupata: %v", err)
	}

	// Niente promozione.
	const seventh = "k7/4P3/8/8/8/8/8/4K3 w - - 0 1"
	r = roomWithMana(seventh)
	err = castIn(r, match.PlayerWhite, phase.PhaseMain1, "forced_march", "e7")
	if gameerr.From(err).Details["reason"] != reasonPromotion {
		t.Errorf("marcia verso la promozione: %v", err)
	}
}

func TestConscription_MaxPawns(t *testing.T) {
	const eightPawns = "4k3/8/8/8/8/PPPPPPPP/8/4K3 w - - 0 1"
	r := roomWithMana(eightPawns)
	err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "conscription", "b2")
	if gameerr.From(err).Details["reason"] != reasonMaxPawns {
		t.Errorf("nono pedone: %v", err)
	}
	if r.Board.FEN != eightPawns {
		t.Error("il cast rifiutato non deve cambiare la FEN")
	}
}

// Combo del brief: Brina → Frantumare nello stesso turno, Leva militare → Patto
// di sangue.
func TestSpells_Combos(t *testing.T) {
	r := roomWithMana(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "frost", "d7"); err != nil {
		t.Fatalf("brina: %v", err)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "shatter", "d7"); err != nil {
		t.Fatalf("frantumare dopo la brina: %v", err)
	}
	if pieceAt(t, r.Board.FEN, "d7") != 0 || r.Match.White.Mana != 0 {
		t.Errorf("dopo la combo: d7 vuota e mana 0, ottenuto %s mana %d", r.Board.FEN, r.Match.White.Mana)
	}

	r = roomWithMana("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "conscription", "c2"); err != nil {
		t.Fatalf("leva militare: %v", err)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "c2"); err != nil {
		t.Fatalf("patto di sangue sul pedone evocato: %v", err)
	}
	if pieceAt(t, r.Board.FEN, "c2") != 0 || r.Match.White.Mana != 3 {
		t.Errorf("dopo la combo: c2 vuota e mana 3 (5 - 4 + 2), ottenuto mana %d", r.Match.White.Mana)
	}
}

// Una magia che toglie il pedone appena spinto di due azzera l'en passant.
func TestSpells_ClearStaleEnPassant(t *testing.T) {
	const pushed = "4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1" // il bianco ha giocato e2e4
	r := roomWithMana(pushed)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain2, "blood_pact", "e4"); err != nil {
		t.Fatalf("patto in main2: %v", err)
	}
	if r.Board.FEN != "4k3/8/8/8/8/8/8/4K3 b - - 0 1" {
		t.Errorf("en passant non azzerato: %s", r.Board.FEN)
	}
}

// Le mosse dei pezzi congelati non contano come giocabili (matto e stallo da
// gelo: l'esito lo decide engine.classify, testato nel suo package).
func TestIsPlayable_FrozenPieces(t *testing.T) {
	r := roomWithMana(startFEN)
	effects.FreezePiece(r.Tracker, "e2", effects.Black, 1, "frost")
	if r.isPlayable("e2e4") {
		t.Error("un pezzo congelato non deve avere mosse giocabili")
	}
	if !r.isPlayable("d2d4") {
		t.Error("un pezzo libero deve poter muovere")
	}
}

// Una partita salvata con il catalogo precedente si ricarica: le carte che non
// esistono più spariscono e gli effetti senza caster lo ricavano dal tipo.
func TestRestore_PreMigrationSnapshot(t *testing.T) {
	const legacy = `{
		"room_id": "room-1-2", "white_id": 1, "black_id": 2, "white_name": "alice", "black_name": "bob",
		"fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
		"moves": ["e2e4"], "turn": "black", "status": "active",
		"white_time_ms": 60000, "black_time_ms": 60000, "increment_ms": 5000,
		"match": {"current_phase": "main1", "turn_number": 2, "active_player": "black", "seed": 7,
			"white": {"hand": ["spark", "aegis"], "deck": ["nova", "frostbolt"], "discard": ["jolt"], "mana": 1, "max_mana": 1},
			"black": {"hand": ["teleport"], "deck": ["insight"], "discard": [], "mana": 1, "max_mana": 1}},
		"effects": [{"square": "e7", "effects": [{"kind": "freeze", "remaining_turns": 2, "source_spell_id": "frostbolt"}]}],
		"pos_counts": {}
	}`
	var snap roomSnapshot
	if err := json.Unmarshal([]byte(legacy), &snap); err != nil {
		t.Fatalf("snapshot vecchio non leggibile: %v", err)
	}
	room := roomFromSnapshot(snap)
	if n := len(room.Match.White.Hand) + len(room.Match.White.Deck) + len(room.Match.Black.Hand); n != 0 {
		t.Errorf("le carte del vecchio catalogo devono sparire, ne restano %d", n)
	}
	if !room.Tracker.IsFrozen("e7") {
		t.Fatal("il gelo salvato deve tornare")
	}
	for _, info := range room.Tracker.ActiveEffects() {
		if info.Effects[0].Caster != effects.White {
			t.Errorf("caster ricavato = %q, atteso white", info.Effects[0].Caster)
		}
	}
}
