package effects

import (
	"testing"

	"chess-server/internal/gameerr"
	"chess-server/internal/spells"
)

// reason estrae details.reason da un invalid_target ("" se l'errore è diverso).
func reason(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	ge := gameerr.From(err)
	if ge.Code != gameerr.InvalidTarget {
		t.Fatalf("code = %s, atteso invalid_target (%v)", ge.Code, err)
	}
	r, _ := ge.Details["reason"].(string)
	return r
}

func TestValidateTargets(t *testing.T) {
	// Bianco: re e1, regina d1, cavallo c3, pedoni a2 e h6; nero: re e8, pedone
	// d7, alfiere f5.
	const fen = "4k3/3p4/7P/5b2/8/2N5/P7/3QK3 w - - 0 1"
	tr := NewTracker(fen)
	if err := FreezePiece(tr, "d7", White, 1, "frost"); err != nil {
		t.Fatalf("setup: %v", err)
	}

	enemyPawn := []spells.TargetSpec{{Type: spells.TargetEnemyPiece, Pieces: []spells.PieceKind{spells.Pawn}}}
	enemyAny := []spells.TargetSpec{{Type: spells.TargetEnemyPiece}}
	ownAny := []spells.TargetSpec{{Type: spells.TargetOwnPiece}}
	ownKing := []spells.TargetSpec{{Type: spells.TargetOwnPiece, Pieces: []spells.PieceKind{spells.King}}}
	frozenEnemy := []spells.TargetSpec{{Type: spells.TargetEnemyPiece, RequireEffect: KindFreeze}}
	emptySquare := []spells.TargetSpec{{Type: spells.TargetSquare, EmptySquare: true}}
	anySquare := []spells.TargetSpec{{Type: spells.TargetSquare}}
	blink := []spells.TargetSpec{
		{Type: spells.TargetOwnPiece, Pieces: []spells.PieceKind{spells.Knight, spells.Bishop}},
		{Type: spells.TargetSquare, EmptySquare: true, MaxDistance: 2},
	}
	secondRank := []spells.TargetSpec{{Type: spells.TargetSquare, EmptySquare: true, OwnRanks: []int{2}}}
	fromSixth := []spells.TargetSpec{{Type: spells.TargetOwnPiece, Pieces: []spells.PieceKind{spells.Pawn}, MinRank: 6}}
	twoSquares := []spells.TargetSpec{{Type: spells.TargetSquare}, {Type: spells.TargetSquare}}

	cases := []struct {
		name    string
		specs   []spells.TargetSpec
		targets []string
		caster  Color
		want    string
	}{
		{"pedone nemico", enemyPawn, []string{"d7"}, White, ""},
		{"alfiere non è un pedone", enemyPawn, []string{"f5"}, White, ReasonPieceKind},
		{"pezzo proprio come nemico", enemyAny, []string{"c3"}, White, ReasonWrongOwner},
		{"casa vuota come pezzo", enemyAny, []string{"e4"}, White, ReasonNoPiece},
		{"re nemico mai", enemyAny, []string{"e8"}, White, ReasonKing},
		{"proprio re senza elencarlo", ownAny, []string{"e1"}, White, ReasonKing},
		{"proprio re se elencato", ownKing, []string{"e1"}, White, ""},
		{"pezzo nemico congelato", frozenEnemy, []string{"d7"}, White, ""},
		{"pezzo nemico non congelato", frozenEnemy, []string{"f5"}, White, ReasonMissingEffect},
		{"casa vuota", emptySquare, []string{"e4"}, White, ""},
		{"casa occupata", emptySquare, []string{"c3"}, White, ReasonNotEmpty},
		{"casa qualsiasi occupata", anySquare, []string{"c3"}, White, ""},
		{"casella fuori scacchiera", anySquare, []string{"i9"}, White, ReasonOffBoard},
		{"blink entro 2", blink, []string{"c3", "e4"}, White, ""},
		{"blink oltre 2", blink, []string{"c3", "f6"}, White, ReasonTooFar},
		{"blink su un pedone", blink, []string{"a2", "a4"}, White, ReasonPieceKind},
		{"seconda traversa del bianco", secondRank, []string{"b2"}, White, ""},
		{"terza traversa del bianco", secondRank, []string{"b3"}, White, ReasonRank},
		{"seconda traversa del nero", secondRank, []string{"b7"}, Black, ""},
		{"pedone in sesta", fromSixth, []string{"h6"}, White, ""},
		{"pedone in seconda", fromSixth, []string{"a2"}, White, ReasonRank},
		{"stessa casella due volte", twoSquares, []string{"e4", "e4"}, White, ReasonDuplicate},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateTargets(fen, tr, c.specs, c.targets, c.caster)
			if got := reason(t, err); got != c.want {
				t.Errorf("reason = %q, atteso %q (err %v)", got, c.want, err)
			}
		})
	}
}

// Il rifiuto porta l'indice del bersaglio sbagliato.
func TestValidateTargets_Index(t *testing.T) {
	const fen = "4k3/8/8/8/8/2N5/8/4K3 w - - 0 1"
	specs := []spells.TargetSpec{
		{Type: spells.TargetOwnPiece},
		{Type: spells.TargetSquare, EmptySquare: true, MaxDistance: 2},
	}
	err := ValidateTargets(fen, NewTracker(fen), specs, []string{"c3", "h8"}, White)
	if idx := gameerr.From(err).Details["index"]; idx != 1 {
		t.Errorf("index = %v, atteso 1", idx)
	}
}

func TestRelativeRankAndForward(t *testing.T) {
	if RelativeRank("b2", White) != 2 || RelativeRank("b7", Black) != 2 || RelativeRank("h8", Black) != 1 {
		t.Error("traverse relative errate")
	}
	if sq, err := ForwardSquare("e2", White, 1); err != nil || sq != "e3" {
		t.Errorf("avanti dal bianco: %s %v", sq, err)
	}
	if sq, err := ForwardSquare("e7", Black, 1); err != nil || sq != "e6" {
		t.Errorf("avanti dal nero: %s %v", sq, err)
	}
	if _, err := ForwardSquare("e8", White, 1); err == nil {
		t.Error("oltre la traversa 8 dovrebbe fallire")
	}
}

func TestPlaceAndCountPieces(t *testing.T) {
	const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1"
	got, err := PlacePiece(fen, "b2", 'P')
	if err != nil || got != "4k3/8/8/8/8/8/1P6/4K3 w - - 0 1" {
		t.Errorf("PlacePiece = %s, %v", got, err)
	}
	if _, err := PlacePiece(got, "b2", 'P'); err == nil {
		t.Error("una casa occupata dovrebbe fallire")
	}
	if n := CountPieces(startFEN, 'P'); n != 8 {
		t.Errorf("pedoni bianchi = %d, attesi 8", n)
	}
}

func TestClearStaleEnPassant(t *testing.T) {
	// Il bianco ha appena spinto e2e4: la casella en passant è e3.
	const fen = "4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1"
	if got := ClearStaleEnPassant(fen); got != fen {
		t.Errorf("en passant valido azzerato: %s", got)
	}
	gone, _, _ := DestroyPiece(fen, "e4")
	if got := ClearStaleEnPassant(gone); got != "4k3/8/8/8/8/8/8/4K3 b - - 0 1" {
		t.Errorf("en passant di un pedone distrutto non azzerato: %s", got)
	}
}

// Uno scudo di durata 1 copre il turno avversario successivo e sparisce
// all'inizio del turno dopo di chi l'ha lanciato.
func TestTickTurnEnd_ShieldDuration(t *testing.T) {
	tr := NewTracker(startFEN)
	if err := ShieldPiece(tr, "d2", White, 1, "shield"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	tr.TickTurnEnd(White) // fine del turno in cui è stato lanciato
	if !tr.HasShield("d2") {
		t.Fatal("lo scudo deve coprire il turno del nero")
	}
	exp := tr.TickTurnEnd(Black) // fine del turno del nero
	if tr.HasShield("d2") || len(exp) != 1 || exp[0].Kind != KindShield {
		t.Errorf("lo scudo deve scadere alla fine del turno del nero, scaduti = %+v", exp)
	}
}

// Durata 0 = fino alla fine del turno di chi lancia; -1 = permanente.
func TestTickTurnEnd_ZeroAndPermanent(t *testing.T) {
	tr := NewTracker(startFEN)
	ShieldPiece(tr, "d2", White, 0, "test")
	ShieldPiece(tr, "e2", White, Permanent, "test")
	exp := tr.TickTurnEnd(White)
	if len(exp) != 1 || exp[0].Square != "d2" {
		t.Errorf("durata 0 deve scadere a fine turno di chi lancia, scaduti = %+v", exp)
	}
	for i := 0; i < 5; i++ {
		tr.TickTurnEnd(Black)
		tr.TickTurnEnd(White)
	}
	if !tr.HasShield("e2") {
		t.Error("un effetto permanente non deve scadere")
	}
}

// Negli snapshot vecchi manca caster: si ricava dal tipo di effetto.
func TestRestoreEffect_LegacyCaster(t *testing.T) {
	tr := NewTracker(startFEN)
	tr.RestoreEffect("e7", []ActiveEffect{{Kind: KindFreeze, RemainingTurns: 1}})
	tr.RestoreEffect("d2", []ActiveEffect{{Kind: KindShield, RemainingTurns: 1}})
	for _, info := range tr.ActiveEffects() {
		want := White // freeze su un pezzo nero: l'ha lanciato il bianco
		if got := info.Effects[0].Caster; got != want {
			t.Errorf("%s: caster = %s, atteso %s", info.Square, got, want)
		}
	}
}

// Add dà un ID nuovo al pezzo evocato.
func TestTracker_Add(t *testing.T) {
	tr := NewTracker("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
	tr.Add("b2", 'P')
	if col, ok := tr.colorAt("b2"); !ok || col != White {
		t.Errorf("pedone evocato non registrato: %v %v", col, ok)
	}
	if tr.bySquare["b2"] <= tr.bySquare["e1"] || tr.bySquare["b2"] <= tr.bySquare["e8"] {
		t.Error("il pezzo evocato deve avere un ID nuovo")
	}
}
