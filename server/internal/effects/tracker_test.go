package effects

import "testing"

func TestNewTracker_AssignsIDs(t *testing.T) {
	tr := NewTracker(startFEN)
	// 32 pezzi nella posizione iniziale.
	if len(tr.pieces) != 32 {
		t.Errorf("pezzi tracciati = %d, attesi 32", len(tr.pieces))
	}
	if _, ok := tr.bySquare["e1"]; !ok {
		t.Error("e1 dovrebbe avere un pezzo tracciato (re bianco)")
	}
}

func TestMovePiece_NormalAndCapture(t *testing.T) {
	tr := NewTracker(startFEN)
	idPawn := tr.bySquare["e2"]

	tr.MovePiece("e2", "e4", 0)
	if tr.bySquare["e4"] != idPawn {
		t.Error("il pedone dovrebbe ora essere in e4 con lo stesso ID")
	}
	if _, ok := tr.bySquare["e2"]; ok {
		t.Error("e2 dovrebbe essere libera dopo la mossa")
	}

	// Cattura: pezzo bianco cattura su d5 dove mettiamo un pezzo nero.
	tr.MovePiece("d7", "d5", 0) // pedone nero
	victimID := tr.bySquare["d5"]
	tr.MovePiece("e4", "d5", 0) // exd5
	if tr.bySquare["d5"] == victimID {
		t.Error("il pezzo catturato dovrebbe essere rimosso")
	}
	if _, ok := tr.pieces[victimID]; ok {
		t.Error("lo stato del pezzo catturato dovrebbe sparire")
	}
}

func TestMovePiece_Castling(t *testing.T) {
	// Posizione con re e torre bianchi pronti all'arrocco corto.
	fen := "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"
	tr := NewTracker(fen)
	rookID := tr.bySquare["h1"]

	tr.MovePiece("e1", "g1", 0) // O-O
	if tr.bySquare["g1"] == 0 {
		t.Error("il re dovrebbe essere in g1")
	}
	if tr.bySquare["f1"] != rookID {
		t.Error("la torre dovrebbe essere in f1 dopo l'arrocco")
	}
	if _, ok := tr.bySquare["h1"]; ok {
		t.Error("h1 dovrebbe essere libera dopo l'arrocco")
	}
}

func TestMovePiece_EnPassant(t *testing.T) {
	// Pedone bianco in e5, pedone nero appena mosso in d5: exd6 e.p.
	fen := "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"
	tr := NewTracker(fen)
	victimID := tr.bySquare["d5"]

	tr.MovePiece("e5", "d6", 0)
	if _, ok := tr.pieces[victimID]; ok {
		t.Error("il pedone catturato en passant (d5) dovrebbe sparire")
	}
	if _, ok := tr.bySquare["d5"]; ok {
		t.Error("d5 dovrebbe essere libera dopo l'en passant")
	}
}

func TestMovePiece_Promotion(t *testing.T) {
	fen := "8/4P3/8/8/8/8/8/4k1K1 w - - 0 1"
	tr := NewTracker(fen)
	id := tr.bySquare["e7"]
	tr.MovePiece("e7", "e8", 'q')
	if tr.pieces[id].Type != 'Q' {
		t.Errorf("dopo la promozione il tipo dovrebbe essere 'Q', è %c", tr.pieces[id].Type)
	}
}

func TestFreeze_AndValidation(t *testing.T) {
	tr := NewTracker(startFEN)

	// Il bianco congela un pezzo nero (e7): ok.
	if err := FreezePiece(tr, "e7", White, 2, "frostbolt"); err != nil {
		t.Fatalf("freeze su pezzo nemico fallito: %v", err)
	}
	if !tr.IsFrozen("e7") {
		t.Error("e7 dovrebbe essere congelato")
	}

	// Congelare un proprio pezzo → errore.
	if err := FreezePiece(tr, "e2", White, 2, "frostbolt"); err == nil {
		t.Error("congelare un proprio pezzo dovrebbe fallire")
	}
	// Casella vuota → errore.
	if err := FreezePiece(tr, "e4", White, 2, "frostbolt"); err == nil {
		t.Error("congelare una casella vuota dovrebbe fallire")
	}
}

func TestShield_AndConsume(t *testing.T) {
	tr := NewTracker(startFEN)

	// Il bianco protegge un proprio pezzo.
	if err := ShieldPiece(tr, "e2", White, 2, "aegis"); err != nil {
		t.Fatalf("shield su pezzo proprio fallito: %v", err)
	}
	if !tr.HasShield("e2") {
		t.Error("e2 dovrebbe avere lo scudo")
	}
	tr.ConsumeShield("e2")
	if tr.HasShield("e2") {
		t.Error("lo scudo dovrebbe essere consumato")
	}

	// Proteggere un pezzo nemico → errore.
	if err := ShieldPiece(tr, "e7", White, 2, "aegis"); err == nil {
		t.Error("proteggere un pezzo nemico dovrebbe fallire")
	}
}

// TestTickColor_Duration verifica che freeze N duri N turni del proprietario.
func TestTickColor_Duration(t *testing.T) {
	tr := NewTracker(startFEN)
	FreezePiece(tr, "e7", White, 2, "frostbolt") // pezzo NERO, freeze 2

	// Fine turno del bianco: non tocca i pezzi neri.
	tr.TickColor(White)
	if !tr.IsFrozen("e7") {
		t.Error("dopo il turno bianco il pezzo nero deve restare congelato (2)")
	}

	// Fine 1° turno nero: 2 -> 1.
	if exp := tr.TickColor(Black); len(exp) != 0 {
		t.Errorf("nessun effetto dovrebbe scadere ancora, scaduti = %d", len(exp))
	}
	if !tr.IsFrozen("e7") {
		t.Error("dopo 1 turno nero deve essere ancora congelato (1)")
	}

	// Fine 2° turno nero: 1 -> 0, scade.
	exp := tr.TickColor(Black)
	if len(exp) != 1 || exp[0].Square != "e7" || exp[0].Kind != KindFreeze {
		t.Errorf("il freeze dovrebbe scadere su e7, scaduti = %+v", exp)
	}
	if tr.IsFrozen("e7") {
		t.Error("dopo 2 turni neri il pezzo deve tornare mobile")
	}
}

func TestActiveEffects(t *testing.T) {
	tr := NewTracker(startFEN)
	FreezePiece(tr, "e7", White, 2, "frostbolt")
	ShieldPiece(tr, "d2", White, 2, "aegis")

	eff := tr.ActiveEffects()
	if len(eff) != 2 {
		t.Errorf("effetti attivi = %d, attesi 2", len(eff))
	}
}
