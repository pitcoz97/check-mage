package effects

import "fmt"

// Effetti persistenti gestiti dal Tracker.
const (
	KindFreeze = "freeze" // il pezzo non può muoversi
	KindShield = "shield" // assorbe una cattura
)

// ActiveEffect è un effetto persistente attivo su un pezzo.
type ActiveEffect struct {
	Kind           string `json:"kind"`
	RemainingTurns int    `json:"remaining_turns"`
	SourceSpellID  string `json:"source_spell_id,omitempty"`
}

// PieceState è lo stato parallelo di un pezzo: identità (ID) ed effetti. Gli
// effetti seguono il PEZZO (via ID), non la casella — così spostare un pezzo
// congelato non lo libera.
type PieceState struct {
	ID      int            `json:"id"`
	Type    byte           `json:"-"` // carattere FEN (maiuscolo = bianco)
	Square  string         `json:"square"`
	Effects []ActiveEffect `json:"effects"`
}

// Tracker mantiene l'identità dei pezzi e i loro effetti, in parallelo alla FEN
// (che non porta identità). Va inizializzato dalla FEN e aggiornato a ogni mossa
// e a ogni distruzione.
type Tracker struct {
	bySquare map[string]int      // casella -> pieceID
	pieces   map[int]*PieceState // pieceID -> stato
	nextID   int
}

// NewTracker assegna un ID univoco a ogni pezzo presente nella FEN.
func NewTracker(fen string) *Tracker {
	t := &Tracker{bySquare: map[string]int{}, pieces: map[int]*PieceState{}, nextID: 1}
	grid, err := parsePlacement(fen)
	if err != nil {
		return t
	}
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			p := grid[row][col]
			if p == 0 {
				continue
			}
			sq := squareName(row, col)
			id := t.nextID
			t.nextID++
			t.pieces[id] = &PieceState{ID: id, Type: p, Square: sq}
			t.bySquare[sq] = id
		}
	}
	return t
}

// squareName converte indici di griglia (riga 0 = traversa 8) in casella.
func squareName(row, col int) string {
	return string(rune('a'+col)) + string(rune('8'-row))
}

// MovePiece aggiorna il tracker dopo una mossa UCI (from->to, con eventuale
// carattere di promozione). Gestisce catture, en passant, arrocco e promozione.
func (t *Tracker) MovePiece(from, to string, promo byte) {
	id, ok := t.bySquare[from]
	if !ok {
		return
	}
	ps := t.pieces[id]

	// Cattura: pezzo sulla casella d'arrivo.
	if _, occupied := t.bySquare[to]; occupied {
		t.RemoveAt(to)
	} else if isPawnType(ps.Type) && from[0] != to[0] {
		// En passant: pedone in diagonale su casella vuota → cattura il pedone
		// sulla traversa di partenza, colonna d'arrivo.
		t.RemoveAt(string(to[0]) + string(from[1]))
	}

	delete(t.bySquare, from)
	t.bySquare[to] = id
	ps.Square = to

	if promo != 0 {
		ps.Type = colorize(promo, pieceColor(ps.Type))
	}

	// Arrocco: il re si è mosso di due colonne → muovi anche la torre.
	if isKingType(ps.Type) {
		t.moveCastlingRook(to)
	}
}

func (t *Tracker) moveCastlingRook(kingTo string) {
	var from, to string
	switch kingTo {
	case "g1":
		from, to = "h1", "f1"
	case "c1":
		from, to = "a1", "d1"
	case "g8":
		from, to = "h8", "f8"
	case "c8":
		from, to = "a8", "d8"
	default:
		return
	}
	if id, ok := t.bySquare[from]; ok {
		delete(t.bySquare, from)
		t.bySquare[to] = id
		t.pieces[id].Square = to
	}
}

// RemoveAt rimuove il pezzo (e i suoi effetti) dalla casella, se presente.
func (t *Tracker) RemoveAt(square string) {
	if id, ok := t.bySquare[square]; ok {
		delete(t.bySquare, square)
		delete(t.pieces, id)
	}
}

func (t *Tracker) colorAt(square string) (Color, bool) {
	id, ok := t.bySquare[square]
	if !ok {
		return "", false
	}
	return pieceColor(t.pieces[id].Type), true
}

// addEffect aggiunge (o rinnova) un effetto sul pezzo nella casella.
func (t *Tracker) addEffect(square, kind string, turns int, source string) error {
	id, ok := t.bySquare[square]
	if !ok {
		return fmt.Errorf("nessun pezzo in %s", square)
	}
	ps := t.pieces[id]
	for i := range ps.Effects {
		if ps.Effects[i].Kind == kind {
			ps.Effects[i].RemainingTurns = turns
			ps.Effects[i].SourceSpellID = source
			return nil
		}
	}
	ps.Effects = append(ps.Effects, ActiveEffect{Kind: kind, RemainingTurns: turns, SourceSpellID: source})
	return nil
}

// FreezePiece applica "freeze" a un pezzo NEMICO per il numero di turni dato.
func FreezePiece(t *Tracker, square string, caster Color, turns int, source string) error {
	col, ok := t.colorAt(square)
	if !ok {
		return fmt.Errorf("nessun pezzo da congelare in %s", square)
	}
	if col == caster {
		return fmt.Errorf("non puoi congelare un tuo pezzo (%s)", square)
	}
	return t.addEffect(square, KindFreeze, turns, source)
}

// ShieldPiece applica "shield" a un pezzo PROPRIO per il numero di turni dato.
func ShieldPiece(t *Tracker, square string, caster Color, turns int, source string) error {
	col, ok := t.colorAt(square)
	if !ok {
		return fmt.Errorf("nessun pezzo da proteggere in %s", square)
	}
	if col != caster {
		return fmt.Errorf("puoi proteggere solo i tuoi pezzi (%s)", square)
	}
	return t.addEffect(square, KindShield, turns, source)
}

func (t *Tracker) hasEffect(square, kind string) bool {
	id, ok := t.bySquare[square]
	if !ok {
		return false
	}
	for _, e := range t.pieces[id].Effects {
		if e.Kind == kind && e.RemainingTurns > 0 {
			return true
		}
	}
	return false
}

// IsFrozen indica se il pezzo nella casella è congelato.
func (t *Tracker) IsFrozen(square string) bool { return t.hasEffect(square, KindFreeze) }

// HasShield indica se il pezzo nella casella è protetto da scudo.
func (t *Tracker) HasShield(square string) bool { return t.hasEffect(square, KindShield) }

// ConsumeShield rimuove lo scudo dal pezzo nella casella (assorbita una cattura).
func (t *Tracker) ConsumeShield(square string) {
	id, ok := t.bySquare[square]
	if !ok {
		return
	}
	ps := t.pieces[id]
	kept := ps.Effects[:0]
	for _, e := range ps.Effects {
		if e.Kind != KindShield {
			kept = append(kept, e)
		}
	}
	ps.Effects = kept
}

// ExpiredEffect descrive un effetto scaduto, per il broadcast.
type ExpiredEffect struct {
	PieceID int
	Square  string
	Kind    string
}

// TickColor decrementa di 1 gli effetti dei pezzi del colore dato (il giocatore
// che ha appena finito il turno), rimuove quelli arrivati a 0 e li restituisce.
// Così "freeze 2" dura 2 turni del proprietario del pezzo colpito.
func (t *Tracker) TickColor(color Color) []ExpiredEffect {
	var expired []ExpiredEffect
	for _, ps := range t.pieces {
		if pieceColor(ps.Type) != color || len(ps.Effects) == 0 {
			continue
		}
		kept := ps.Effects[:0]
		for _, e := range ps.Effects {
			e.RemainingTurns--
			if e.RemainingTurns <= 0 {
				expired = append(expired, ExpiredEffect{PieceID: ps.ID, Square: ps.Square, Kind: e.Kind})
			} else {
				kept = append(kept, e)
			}
		}
		ps.Effects = kept
	}
	return expired
}

// PieceEffectInfo è la vista pubblica degli effetti attivi su una casella.
type PieceEffectInfo struct {
	Square  string         `json:"square"`
	Effects []ActiveEffect `json:"effects"`
}

// RestoreEffect riattacca effetti persistiti al pezzo nella casella data (usato
// in fase di ripristino: il Tracker è ricostruito dalla FEN, poi si riapplicano
// gli effetti salvati per casella).
func (t *Tracker) RestoreEffect(square string, effs []ActiveEffect) {
	id, ok := t.bySquare[square]
	if !ok {
		return
	}
	t.pieces[id].Effects = append(t.pieces[id].Effects, effs...)
}

// ActiveEffects elenca gli effetti attivi su tutti i pezzi (per game_state).
func (t *Tracker) ActiveEffects() []PieceEffectInfo {
	out := make([]PieceEffectInfo, 0)
	for _, ps := range t.pieces {
		if len(ps.Effects) > 0 {
			out = append(out, PieceEffectInfo{Square: ps.Square, Effects: ps.Effects})
		}
	}
	return out
}

func isPawnType(p byte) bool { return p == 'p' || p == 'P' }
func isKingType(p byte) bool { return p == 'k' || p == 'K' }

// colorize forza il carattere-pezzo al colore dato (maiuscolo = bianco).
func colorize(p byte, c Color) byte {
	if c == White && p >= 'a' && p <= 'z' {
		return p - 32
	}
	if c == Black && p >= 'A' && p <= 'Z' {
		return p + 32
	}
	return p
}
