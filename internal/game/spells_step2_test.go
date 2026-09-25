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

const kingsOnly = "4k3/8/8/8/8/8/8/4K3 w - - 0 1"

// richRoom è una room di test con 10 mana per entrambi.
func richRoom(fen string) *Room {
	room, _, _ := newTestRoom(fen)
	room.Match.White.Mana = 10
	room.Match.Black.Mana = 10
	return room
}

func reasonOf(err error) interface{} {
	return gameerr.From(err).Details["reason"]
}

func TestEternalWinter(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "eternal_winter"); err != nil {
		t.Fatalf("inverno eterno: %v", err)
	}
	for _, sq := range []string{"a7", "d7", "h7"} {
		if !r.Tracker.IsFrozen(sq) {
			t.Errorf("%s deve essere congelato", sq)
		}
	}
	if r.Tracker.IsFrozen("b8") {
		t.Error("solo i pedoni si congelano")
	}
	// Durata 1: resiste alla fine del turno del bianco, scade a fine turno del nero.
	r.Tracker.TickTurnEnd(effects.White)
	if !r.Tracker.IsFrozen("a7") {
		t.Error("il gelo deve coprire il turno del nero")
	}
	r.Tracker.TickTurnEnd(effects.Black)
	if r.Tracker.IsFrozen("a7") {
		t.Error("il gelo deve scadere all'inizio del turno dopo")
	}

	r = richRoom("4k3/8/8/8/8/8/P7/4K3 w - - 0 1") // nessun pedone nero
	err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "eternal_winter")
	if code(err) != gameerr.NoEffect || reasonOf(err) != "no_pieces" {
		t.Errorf("senza pedoni nemici: %v", err)
	}
	if r.Match.White.Mana != 10 {
		t.Error("un cast senza effetto non costa mana")
	}
}

func TestRoyalGuardAndPhalanx(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "royal_guard"); err != nil {
		t.Fatalf("guardia reale: %v", err)
	}
	for _, sq := range []string{"d1", "f1", "d2", "e2", "f2"} {
		if !r.Tracker.HasShield(sq) {
			t.Errorf("%s deve avere lo scudo (regina compresa)", sq)
		}
	}
	if r.Tracker.HasShield("e1") || r.Tracker.HasShield("c2") {
		t.Error("né il re né i pezzi lontani")
	}
	if err := castIn(richRoom(kingsOnly), match.PlayerWhite, phase.PhaseMain1, "royal_guard"); code(err) != gameerr.NoEffect {
		t.Errorf("nessun pezzo attorno al re: %v", err)
	}

	r = richRoom("4k3/8/8/8/8/8/PP2P3/4K3 w - - 0 1")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "phalanx"); err != nil {
		t.Fatalf("falange: %v", err)
	}
	if !r.Tracker.HasShield("a2") || !r.Tracker.HasShield("b2") || r.Tracker.HasShield("e2") {
		t.Error("scudo solo ai pedoni con un altro pedone accanto")
	}
	if err := castIn(richRoom("4k3/8/8/8/8/1P6/P7/4K3 w - - 0 1"), match.PlayerWhite, phase.PhaseMain1, "phalanx"); code(err) != gameerr.NoEffect {
		t.Errorf("pedoni solo in diagonale: %v", err)
	}
}

func TestSwap(t *testing.T) {
	r := richRoom(startFEN)
	idB1, _, _ := r.Tracker.Info("b1")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "swap", "b1", "c1"); err != nil {
		t.Fatalf("scambio: %v", err)
	}
	if r.Board.FEN != "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RBNQKBNR w KQkq - 0 1" {
		t.Errorf("FEN dopo lo scambio: %s", r.Board.FEN)
	}
	if id, _, _ := r.Tracker.Info("c1"); id != idB1 {
		t.Error("il cavallo porta il suo id in c1")
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "swap", "b1", "e1"); reasonOf(err) != effects.ReasonKing {
		t.Errorf("scambio col re: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "swap", "b1", "b2"); reasonOf(err) != effects.ReasonPawnRank {
		t.Errorf("pedone in prima traversa: %v", err)
	}
}

func TestMetamorphosis(t *testing.T) {
	r := richRoom(startFEN)
	effects.ShieldPiece(r.Tracker, "b1", effects.White, 1, "shield")
	id, _, _ := r.Tracker.Info("b1")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "metamorphosis", "b1"); err != nil {
		t.Fatalf("metamorfosi: %v", err)
	}
	if p, _ := effects.PieceAt(r.Board.FEN, "b1"); p != 'B' {
		t.Errorf("b1 = %c, atteso alfiere", p)
	}
	if got, piece, _ := r.Tracker.Info("b1"); got != id || piece != 'B' || !r.Tracker.HasShield("b1") {
		t.Error("la metamorfosi conserva PieceID ed effetti")
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "metamorphosis", "d1"); reasonOf(err) != effects.ReasonPieceKind {
		t.Errorf("metamorfosi della regina: %v", err)
	}
}

func TestEarlyPromotion(t *testing.T) {
	const seventh = "k7/4P3/8/8/8/8/1P6/4K3 w - - 0 1"
	r := richRoom(seventh)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "early_promotion", "e7"); code(err) != gameerr.InvalidChoice || reasonOf(err) != "missing" {
		t.Errorf("senza scelta: %v", err)
	}
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.King}, "early_promotion", "e7"); reasonOf(err) != "not_allowed" {
		t.Errorf("promozione a re: %v", err)
	}
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.Knight}, "early_promotion", "b2"); reasonOf(err) != effects.ReasonRank {
		t.Errorf("pedone in seconda traversa: %v", err)
	}
	id, _, _ := r.Tracker.Info("e7")
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.Knight}, "early_promotion", "e7"); err != nil {
		t.Fatalf("promozione a cavallo: %v", err)
	}
	if p, _ := effects.PieceAt(r.Board.FEN, "e7"); p != 'N' {
		t.Errorf("e7 = %c, atteso cavallo", p)
	}
	if got, _, _ := r.Tracker.Info("e7"); got != id {
		t.Error("il pezzo promosso conserva il suo PieceID")
	}
}

func TestRecallAndResurrection(t *testing.T) {
	r := richRoom(kingsOnly)
	err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "recall", "b2")
	if code(err) != gameerr.NoEffect || reasonOf(err) != "empty_graveyard" {
		t.Errorf("richiamo senza pedoni nel cimitero: %v", err)
	}

	r = richRoom(kingsOnly)
	r.Match.White.Graveyard = []spells.GraveEntry{{Piece: spells.Knight, PieceID: 2}, {Piece: spells.Pawn, PieceID: 9}}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "recall", "b2"); err != nil {
		t.Fatalf("richiamo: %v", err)
	}
	if p, _ := effects.PieceAt(r.Board.FEN, "b2"); p != 'P' {
		t.Errorf("b2 = %c, atteso pedone", p)
	}
	if kinds := r.Match.White.GraveyardKinds(); len(kinds) != 1 || kinds[0] != spells.Knight {
		t.Errorf("il pedone esce dal cimitero, resta il cavallo: %v", kinds)
	}

	r = richRoom(kingsOnly)
	r.Match.White.Graveyard = []spells.GraveEntry{{Piece: spells.Knight}, {Piece: spells.Rook}, {Piece: spells.Pawn}}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "resurrection", "b1"); reasonOf(err) != "missing" {
		t.Errorf("due scelte possibili senza choice: %v", err)
	}
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.Bishop}, "resurrection", "b1"); reasonOf(err) != "not_allowed" {
		t.Errorf("alfiere assente dal cimitero: %v", err)
	}
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.Rook}, "resurrection", "b1"); err != nil {
		t.Fatalf("resurrezione della torre: %v", err)
	}
	if p, _ := effects.PieceAt(r.Board.FEN, "b1"); p != 'R' {
		t.Errorf("b1 = %c, attesa torre", p)
	}
	if n := len(r.Match.White.Graveyard); n != 2 {
		t.Errorf("cimitero dopo la resurrezione: %d pezzi, attesi 2", n)
	}
}

func TestDivineCastling(t *testing.T) {
	r := richRoom("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "divine_castling"); err != nil {
		t.Fatalf("arrocco divino: %v", err)
	}
	if r.Board.FEN != "r3k2r/8/8/8/8/8/8/R3K2R w KQ - 0 1" {
		t.Errorf("FEN dopo l'arrocco divino: %s", r.Board.FEN)
	}
	err := castIn(richRoom("r3k2r/8/8/8/8/8/8/R4K1R w - - 0 1"), match.PlayerWhite, phase.PhaseMain1, "divine_castling")
	if code(err) != gameerr.NoEffect || reasonOf(err) != "no_castling" {
		t.Errorf("re fuori posto: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain2, "divine_castling"); code(err) != gameerr.WrongPhase {
		t.Errorf("arrocco divino in main2: %v", err)
	}
}

// Ogni pezzo tolto dalla scacchiera finisce nel cimitero del proprietario.
func TestGraveyard_DestroyAndCapture(t *testing.T) {
	r := richRoom(startFEN)
	effects.FreezePiece(r.Tracker, "e7", effects.White, 1, "frost")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "shatter", "e7"); err != nil {
		t.Fatalf("frantumare: %v", err)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "a2"); err != nil {
		t.Fatalf("patto di sangue: %v", err)
	}
	if k := r.Match.Black.GraveyardKinds(); len(k) != 1 || k[0] != spells.Pawn {
		t.Errorf("cimitero nero = %v", k)
	}
	if k := r.Match.White.GraveyardKinds(); len(k) != 1 || k[0] != spells.Pawn {
		t.Errorf("cimitero bianco = %v", k)
	}

	// Cattura en passant: il pedone catturato è in d5, non nella casa d'arrivo.
	const ep = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"
	r = richRoom(ep)
	owner, ok := r.buryCaptured(captureSquare(ep, "e5", "d6"))
	if !ok || owner != match.PlayerBlack || len(r.Match.Black.Graveyard) != 1 {
		t.Errorf("en passant: %v %v %v", owner, ok, r.Match.Black.Graveyard)
	}
	// Un pedone promosso entra come il pezzo che era.
	r = richRoom("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1")
	r.buryCaptured("a1")
	if k := r.Match.White.GraveyardKinds(); len(k) != 1 || k[0] != spells.Queen {
		t.Errorf("cimitero con la regina: %v", k)
	}
}

// Il cimitero è nel game_state e sopravvive a salvataggio e ripristino.
func TestGraveyard_StateAndSnapshot(t *testing.T) {
	r := richRoom(startFEN)
	r.Match.Black.Graveyard = []spells.GraveEntry{{Piece: spells.Knight, PieceID: 2}}
	if g, ok := r.publicState()["black_graveyard"].([]spells.PieceKind); !ok || len(g) != 1 || g[0] != spells.Knight {
		t.Errorf("black_graveyard = %v", r.publicState()["black_graveyard"])
	}
	data, err := json.Marshal(r.buildSnapshot())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := roomFromSnapshot(snap).Match.Black.GraveyardKinds(); len(got) != 1 || got[0] != spells.Knight {
		t.Errorf("cimitero ripristinato = %v", got)
	}
}
