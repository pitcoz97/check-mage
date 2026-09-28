package game

import (
	"encoding/json"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// Passo sfasato: solo un proprio alfiere, solo in main1 (M53).
func TestPhaseStep_Cast(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "phase_step", "c1"); err != nil {
		t.Fatalf("passo sfasato: %v", err)
	}
	if !r.Tracker.HasEffect("c1", effects.KindPhasing) {
		t.Fatal("l'alfiere è in phasing")
	}
	if got := r.moveOptionsFor(match.PlayerWhite).SpecialMoves; len(got) != 0 {
		t.Errorf("in main1 nessuna opzione di mossa: %v", got)
	}
	r.Match.CurrentPhase = phase.PhaseMove
	if got := r.moveOptionsFor(match.PlayerWhite).SpecialMoves; !containsString(got, "c1f4") || !containsString(got, "c1h6") {
		t.Errorf("nella Move l'alfiere attraversa d2: %v", got)
	}
	if got := r.moveOptionsFor(match.PlayerBlack).SpecialMoves; len(got) != 0 {
		t.Errorf("l'avversario non riceve opzioni: %v", got)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "phase_step", "b1"); reasonOf(err) != effects.ReasonPieceKind {
		t.Errorf("sul cavallo: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain2, "phase_step", "c1"); code(err) != gameerr.WrongPhase {
		t.Errorf("solo prima della mossa: %v", err)
	}
	poor := roomWithMana(startFEN)
	poor.Match.White.Mana = 1
	if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, "phase_step", "c1"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
}

// Eco del caduto: la scelta fra i pezzi minori del proprio cimitero (M55).
func TestEchoOfTheFallen_Cast(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "echo_of_fallen", "e2"); code(err) != gameerr.NoEffect || reasonOf(err) != "empty_graveyard" {
		t.Errorf("senza minori nel cimitero: %v", err)
	}
	r.Match.White.Graveyard = []spells.GraveEntry{{Piece: spells.Knight, PieceID: 2}, {Piece: spells.Bishop, PieceID: 3}}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "echo_of_fallen", "e2"); code(err) != gameerr.InvalidChoice {
		t.Errorf("due tipi: serve la scelta: %v", err)
	}
	if err := castWith(r, match.PlayerWhite, phase.PhaseMain1, spells.Choice{Piece: spells.Knight}, "echo_of_fallen", "e2"); err != nil {
		t.Fatalf("eco col cavallo: %v", err)
	}
	if r.Tracker.BorrowedAs("e2") != "knight" {
		t.Errorf("il pedone muove anche da cavallo: %q", r.Tracker.BorrowedAs("e2"))
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, "echo_of_fallen", "b1"); reasonOf(err) != effects.ReasonPieceKind {
		t.Errorf("solo un pedone: %v", err)
	}
}

// Fretta: si concede una volta per turno, solo in main1.
func TestHaste_Cast(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "haste"); err != nil {
		t.Fatalf("fretta: %v", err)
	}
	if !r.extraGranted(match.PlayerWhite) {
		t.Fatal("la seconda mossa è concessa")
	}
	r.Match.White.Mana = 10 // la prima Fretta ne ha spesi 6: senza ricarica il rifiuto sarebbe per il mana
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "haste"); code(err) != gameerr.NoEffect || reasonOf(err) != "already_granted" {
		t.Errorf("seconda Fretta: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain2, "haste"); code(err) != gameerr.WrongPhase {
		t.Errorf("solo prima della mossa: %v", err)
	}
}

// Criterio del brief: dopo una mossa speciale la mossa dell'avversario è
// validata da Stockfish sulla FEN nuova.
func TestSpecialMove_ThenOpponentMove(t *testing.T) {
	withStockfish(t)
	r := richRoom(startFEN)
	effects.AddMovementEffect(r.Tracker, "c1", effects.KindPhasing, "", effects.White, 0, "phase_step")
	moveIn(t, r, "c1f4")
	if p, _ := effects.PieceAt(r.Board.FEN, "f4"); p != 'B' || sideToMove(r.Board.FEN) != "black" {
		t.Fatalf("alfiere in f4, tratto al Nero: %s", r.Board.FEN)
	}
	moveIn(t, r, "e7e5")
	if p, _ := effects.PieceAt(r.Board.FEN, "e5"); p != 'p' {
		t.Errorf("la risposta del Nero è validata da Stockfish: %s", r.Board.FEN)
	}
}

// Criterio del brief: una mossa speciale che lascia il proprio re sotto scacco è rifiutata.
func TestSpecialMove_KingLeftInCheckRejected(t *testing.T) {
	withStockfish(t)
	r := richRoom("4r1k1/8/8/8/8/8/4P3/4K3 w - - 0 1")
	r.Match.White.Auras = []spells.Aura{{Grant: spells.AuraGrantPawnSidestep, MinOwnPawns: 1, Active: true, SourceSpellID: "banner"}}
	r.Match.ActivePlayer, r.Match.CurrentPhase = match.PlayerWhite, phase.PhaseMove
	drain(r.White)
	r.handleMove(r.White, "e2d2")
	if got := lastErrorCode(t, drain(r.White)); got != string(gameerr.IllegalMove) {
		t.Errorf("passo di lato che scopre il re: %s", got)
	}

	ok := richRoom("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1")
	ok.Match.White.Auras = r.Match.White.Auras
	moveIn(t, ok, "e4d4")
	if p, _ := effects.PieceAt(ok.Board.FEN, "d4"); p != 'P' {
		t.Errorf("passo di lato accettato: %s", ok.Board.FEN)
	}
}

// Criterio del brief: la seconda mossa di Fretta accetta solo pedoni senza cattura;
// si può saltare; salta da sola se la prima dà scacco (M57).
func TestHaste_SecondMove(t *testing.T) {
	withStockfish(t)
	grant := func(r *Room) {
		r.extra = &extraMove{Player: match.PlayerWhite, Turn: r.Match.TurnNumber, Pieces: []spells.PieceKind{spells.Pawn}, NoCapture: true}
	}
	r := richRoom("rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2")
	grant(r)
	msgs := moveIn(t, r, "g1f3")
	if !r.extraActive() || r.Board.Turn != "white" || r.Match.CurrentPhase != phase.PhaseMove {
		t.Fatalf("dopo la prima mossa si attende la seconda: %+v %s", r.extra, r.Board.FEN)
	}
	if opts, ok := findMsg(msgs, models.MsgMoveOptions); !ok || opts["extra_move"] == nil {
		t.Errorf("move_options con extra_move: %v", opts)
	}
	for _, bad := range []string{"b1c3", "e2e3x"} {
		r.handleMove(r.White, bad)
		if got := lastErrorCode(t, drain(r.White)); got != string(gameerr.IllegalMove) {
			t.Errorf("%s come seconda mossa: %s", bad, got)
		}
	}
	moveIn(t, r, "e2e4")
	if r.extra != nil || sideToMove(r.Board.FEN) != "black" {
		t.Errorf("dopo la seconda mossa tocca al Nero: %s", r.Board.FEN)
	}

	// Cattura vietata: dopo e2e4 il pedone non può prendere in d5.
	capture := richRoom("rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2")
	grant(capture)
	moveIn(t, capture, "e2e4")
	if containsString(capture.extraMoves(), "e4d5") {
		t.Error("la seconda mossa non cattura")
	}

	// Salto: torna la posizione dopo la prima mossa, col tratto al Nero.
	skip := richRoom(startFEN)
	grant(skip)
	moveIn(t, skip, "g1f3")
	after := skip.extra.FENAfterFirst
	drain(skip.White)
	skip.handlePassPhase(skip.White)
	if skip.extra != nil || skip.Board.FEN != after || skip.Match.CurrentPhase == phase.PhaseMove && skip.Match.ActivePlayer == match.PlayerWhite {
		t.Errorf("salto della seconda mossa: %s", skip.Board.FEN)
	}

	// La prima mossa dà scacco: niente seconda mossa.
	check := richRoom("4k3/8/8/8/8/8/3PP3/3QK3 w - - 0 1")
	grant(check)
	moveIn(t, check, "d1a4")
	if check.extra != nil || sideToMove(check.Board.FEN) != "black" {
		t.Errorf("dopo uno scacco la seconda mossa salta: %+v", check.extra)
	}
}

// Matto e stallo contano le mosse speciali: col passo di lato non è stallo (M60).
func TestGameStatus_CountsSpecialMoves(t *testing.T) {
	withStockfish(t)
	const fen = "4k3/8/8/1p6/1P6/8/5q2/7K w - - 0 1"
	r := richRoom(fen)
	if got := r.gameStatus(); got != engine.StatusStalemate {
		t.Fatalf("senza Stendardo è stallo: %v", got)
	}
	r.Match.White.Auras = []spells.Aura{{Grant: spells.AuraGrantPawnSidestep, MinOwnPawns: 1, Active: true, SourceSpellID: "banner"}}
	if got := r.gameStatus(); got != engine.StatusOngoing {
		t.Errorf("col passo di lato si gioca: %v", got)
	}
}

// Phasing, movimento preso in prestito e Fretta sopravvivono a salvataggio e ripristino.
func TestSpecialMoves_Snapshot(t *testing.T) {
	r := richRoom(startFEN)
	effects.AddMovementEffect(r.Tracker, "e2", effects.KindBorrow, "bishop", effects.White, 0, "echo_of_fallen")
	r.extra = &extraMove{Player: match.PlayerWhite, Turn: 3, Pieces: []spells.PieceKind{spells.Pawn}, NoCapture: true}
	data, err := json.Marshal(r.buildSnapshot())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	back := roomFromSnapshot(snap)
	if back.Tracker.BorrowedAs("e2") != "bishop" {
		t.Error("il movimento preso in prestito torna")
	}
	if back.extra == nil || back.extra.Turn != 3 || !back.extra.NoCapture {
		t.Errorf("Fretta torna: %+v", back.extra)
	}
}

// Lo Stendardo ora è nel mazzo, con le 32 magie del brief.
func TestRecipe_FullCatalog(t *testing.T) {
	if len(spells.Catalog) != 32 {
		t.Errorf("catalogo = %d magie, attese 32", len(spells.Catalog))
	}
	found := false
	for _, id := range spells.BuildDeck() {
		if id == "banner" {
			found = true
		}
	}
	if !found {
		t.Error("lo Stendardo è nel mazzo")
	}
}
