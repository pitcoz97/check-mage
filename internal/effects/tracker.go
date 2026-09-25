package effects

import (
	"sort"

	"chess-server/internal/gameerr"
)

// Effetti persistenti gestiti dal Tracker.
const (
	KindFreeze = "freeze" // il pezzo non può muoversi
	KindShield = "shield" // assorbe una cattura
)

// ActiveEffect è un effetto persistente attivo su un pezzo.
//
// RemainingTurns conta i turni dell'avversario di Caster ancora coperti: scende
// alla fine di ciascuno di quei turni. 0 = l'effetto vale solo fino alla fine
// del turno di Caster; Permanent = non scade.
type ActiveEffect struct {
	Kind           string `json:"kind"`
	RemainingTurns int    `json:"remaining_turns"`
	SourceSpellID  string `json:"source_spell_id,omitempty"`
	Caster         Color  `json:"caster,omitempty"`
}

// Permanent è la durata di un effetto che non scade.
const Permanent = -1

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

// Relocate sposta l'identità (e gli effetti) del pezzo da `from` a `to` senza
// alcuna semantica scacchistica: niente cattura en passant, arrocco o
// promozione. Da usare per gli spostamenti magici (move_piece), dove un re che
// arriva su g1 o un pedone mosso in diagonale non sono mosse di scacchi.
func (t *Tracker) Relocate(from, to string) {
	id, ok := t.bySquare[from]
	if !ok {
		return
	}
	if _, occupied := t.bySquare[to]; occupied {
		t.RemoveAt(to) // non dovrebbe accadere: move_piece richiede una casella vuota
	}
	delete(t.bySquare, from)
	t.bySquare[to] = id
	t.pieces[id].Square = to
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

// Add registra un pezzo nuovo (es. un pedone evocato) con un ID nuovo e nessun
// effetto. Un eventuale pezzo già registrato sulla casella viene rimosso.
func (t *Tracker) Add(square string, piece byte) {
	t.RemoveAt(square)
	id := t.nextID
	t.nextID++
	t.pieces[id] = &PieceState{ID: id, Type: piece, Square: square}
	t.bySquare[square] = id
}

// addEffect aggiunge (o rinnova) un effetto sul pezzo nella casella.
func (t *Tracker) addEffect(square, kind string, turns int, source string, caster Color) error {
	id, ok := t.bySquare[square]
	if !ok {
		return gameerr.Newf(gameerr.InvalidTarget, "nessun pezzo in %s", square)
	}
	ps := t.pieces[id]
	for i := range ps.Effects {
		if ps.Effects[i].Kind == kind {
			ps.Effects[i].RemainingTurns = turns
			ps.Effects[i].SourceSpellID = source
			ps.Effects[i].Caster = caster
			return nil
		}
	}
	ps.Effects = append(ps.Effects, ActiveEffect{Kind: kind, RemainingTurns: turns, SourceSpellID: source, Caster: caster})
	return nil
}

// FreezePiece applica "freeze" a un pezzo NEMICO per il numero di turni dato.
func FreezePiece(t *Tracker, square string, caster Color, turns int, source string) error {
	col, ok := t.colorAt(square)
	if !ok {
		return gameerr.Newf(gameerr.InvalidTarget, "nessun pezzo da congelare in %s", square)
	}
	if col == caster {
		return gameerr.Newf(gameerr.InvalidTarget, "non puoi congelare un tuo pezzo (%s)", square)
	}
	return t.addEffect(square, KindFreeze, turns, source, caster)
}

// ShieldPiece applica "shield" a un pezzo PROPRIO per il numero di turni dato.
func ShieldPiece(t *Tracker, square string, caster Color, turns int, source string) error {
	col, ok := t.colorAt(square)
	if !ok {
		return gameerr.Newf(gameerr.InvalidTarget, "nessun pezzo da proteggere in %s", square)
	}
	if col != caster {
		return gameerr.Newf(gameerr.InvalidTarget, "puoi proteggere solo i tuoi pezzi (%s)", square)
	}
	return t.addEffect(square, KindShield, turns, source, caster)
}

// HasEffect indica se il pezzo nella casella ha l'effetto dato. Gli effetti
// scaduti sono già stati tolti da TickTurnEnd, quindi basta la presenza.
func (t *Tracker) HasEffect(square, kind string) bool {
	id, ok := t.bySquare[square]
	if !ok {
		return false
	}
	for _, e := range t.pieces[id].Effects {
		if e.Kind == kind {
			return true
		}
	}
	return false
}

// IsFrozen indica se il pezzo nella casella è congelato.
func (t *Tracker) IsFrozen(square string) bool { return t.HasEffect(square, KindFreeze) }

// HasShield indica se il pezzo nella casella è protetto da scudo.
func (t *Tracker) HasShield(square string) bool { return t.HasEffect(square, KindShield) }

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

// TickTurnEnd aggiorna gli effetti alla fine del turno di finishing e
// restituisce quelli scaduti, ordinati per casella.
//
// La durata conta i turni dell'avversario di chi ha lanciato l'effetto: alla fine
// di un turno di quell'avversario il contatore scende di 1 e a 0 l'effetto
// scade. Un effetto con durata 0 scade invece alla fine del turno di chi l'ha
// lanciato. Così "freeze 1" copre il prossimo turno del pezzo colpito e "shield
// 1" il prossimo turno avversario, e sparisce all'inizio del turno dopo.
func (t *Tracker) TickTurnEnd(finishing Color) []ExpiredEffect {
	var expired []ExpiredEffect
	for _, ps := range t.pieces {
		if len(ps.Effects) == 0 {
			continue
		}
		kept := ps.Effects[:0]
		for _, e := range ps.Effects {
			if e.RemainingTurns == Permanent {
				kept = append(kept, e)
				continue
			}
			if e.Caster != finishing {
				e.RemainingTurns--
			}
			if e.RemainingTurns <= 0 {
				expired = append(expired, ExpiredEffect{PieceID: ps.ID, Square: ps.Square, Kind: e.Kind})
			} else {
				kept = append(kept, e)
			}
		}
		ps.Effects = kept
	}
	sort.Slice(expired, func(i, j int) bool { return expired[i].Square < expired[j].Square })
	return expired
}

// PieceEffectInfo è la vista pubblica degli effetti attivi su una casella.
type PieceEffectInfo struct {
	Square  string         `json:"square"`
	Effects []ActiveEffect `json:"effects"`
}

// RestoreEffect riattacca effetti persistiti al pezzo nella casella data (usato
// in fase di ripristino: il Tracker è ricostruito dalla FEN, poi si riapplicano
// gli effetti salvati per casella). Gli snapshot salvati prima che esistesse
// Caster lo ricavano dal tipo: il gelo lo lancia l'avversario del pezzo, lo
// scudo il suo proprietario.
func (t *Tracker) RestoreEffect(square string, effs []ActiveEffect) {
	id, ok := t.bySquare[square]
	if !ok {
		return
	}
	ps := t.pieces[id]
	for _, e := range effs {
		if e.Caster == "" {
			e.Caster = pieceColor(ps.Type)
			if e.Kind == KindFreeze {
				e.Caster = e.Caster.Opponent()
			}
		}
		ps.Effects = append(ps.Effects, e)
	}
}

// Clone restituisce una copia indipendente del Tracker: gli effetti di una magia
// si applicano sulla copia, che sostituisce l'originale solo se tutto riesce.
func (t *Tracker) Clone() *Tracker {
	c := &Tracker{
		bySquare: make(map[string]int, len(t.bySquare)),
		pieces:   make(map[int]*PieceState, len(t.pieces)),
		nextID:   t.nextID,
	}
	for sq, id := range t.bySquare {
		c.bySquare[sq] = id
	}
	for id, ps := range t.pieces {
		cp := *ps
		cp.Effects = append([]ActiveEffect(nil), ps.Effects...)
		c.pieces[id] = &cp
	}
	return c
}

// ActiveEffects elenca gli effetti attivi su tutti i pezzi (per game_state).
// Gli effetti sono copiati (il chiamante può serializzarli fuori dal lock) e
// ordinati per casella, così l'output è deterministico.
func (t *Tracker) ActiveEffects() []PieceEffectInfo {
	out := make([]PieceEffectInfo, 0)
	for _, ps := range t.pieces {
		if len(ps.Effects) > 0 {
			effs := append([]ActiveEffect(nil), ps.Effects...)
			out = append(out, PieceEffectInfo{Square: ps.Square, Effects: effs})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Square < out[j].Square })
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
