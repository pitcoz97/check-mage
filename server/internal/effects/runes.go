package effects

// Rune (docs/BRIEFING-MAGIE.md, Step 4): stati delle case nascosti all'avversario
// di chi le piazza, che scattano quando un pezzo nemico ci entra con una mossa.
// Vivono fra gli stati delle case (KindRune) con durata permanente: una runa resta
// finché non scatta o viene detonata. Ogni giocatore ha al massimo una runa per
// casa.

import (
	"sort"

	"chess-server/internal/gameerr"
)

// Cosa fa una runa quando scatta (RuneSpec.OnEnter e Fallback).
const (
	RuneFreeze  = "freeze_piece"     // congela il pezzo entrato
	RuneReturn  = "return_to_origin" // rimanda il pezzo alla casa di partenza
	RuneDestroy = "destroy_piece"    // distrugge il pezzo entrato
)

// RuneSpec è l'effetto di una runa, copiato dai params di place_rune.
type RuneSpec struct {
	OnEnter string `json:"on_enter"`
	// Durata del gelo prodotto (turni dell'avversario del proprietario, M9).
	Duration int `json:"duration,omitempty"`
	// Tipi di pezzo colpiti da OnEnter; vuoto = tutti. Gli altri subiscono Fallback.
	Only             []string `json:"only,omitempty"`
	Fallback         string   `json:"fallback,omitempty"`
	FallbackDuration int      `json:"fallback_duration,omitempty"`
}

// ReasonNoRunes: detonate_runes senza rune proprie (details.reason di no_effect).
const ReasonNoRunes = "no_runes"

// AddRune piazza una runa nascosta del proprietario sulla casa. Una runa dello
// stesso proprietario già lì viene sostituita.
func (t *Tracker) AddRune(square string, owner Color, spec RuneSpec, source string) error {
	if _, _, err := parseSquare(square); err != nil {
		return gameerr.Newf(gameerr.InvalidTarget, "casella non valida: %q", square).
			With("reason", ReasonOffBoard).With("square", square)
	}
	s := spec
	s.Only = append([]string(nil), spec.Only...)
	t.putSquareEffect(square, ActiveEffect{
		Kind: KindRune, RemainingTurns: Permanent, SourceSpellID: source, Caster: owner, Hidden: true, Rune: &s,
	})
	return nil
}

// RuneAt restituisce la runa del proprietario sulla casa (nil-safe).
func (t *Tracker) RuneAt(square string, owner Color) (ActiveEffect, bool) {
	if t == nil {
		return ActiveEffect{}, false
	}
	for _, e := range t.squares[square] {
		if e.Kind == KindRune && e.Caster == owner {
			return e, true
		}
	}
	return ActiveEffect{}, false
}

// RunesOf elenca, in ordine, le case con una runa del proprietario.
func (t *Tracker) RunesOf(owner Color) []string {
	var out []string
	for sq := range t.squares {
		if _, ok := t.RuneAt(sq, owner); ok {
			out = append(out, sq)
		}
	}
	sort.Strings(out)
	return out
}

// RemoveRune toglie la runa del proprietario dalla casa.
func (t *Tracker) RemoveRune(square string, owner Color) {
	effs := t.squares[square]
	kept := make([]ActiveEffect, 0, len(effs))
	for _, e := range effs {
		if !(e.Kind == KindRune && e.Caster == owner) {
			kept = append(kept, e)
		}
	}
	if len(kept) == 0 {
		delete(t.squares, square)
	} else {
		t.squares[square] = kept
	}
}

// RevealRunes rende visibili a entrambi, per sempre, le rune del proprietario che
// esistono ora, e restituisce quante erano ancora nascoste.
func (t *Tracker) RevealRunes(owner Color) int {
	n := 0
	for _, effs := range t.squares {
		for i := range effs {
			if effs[i].Kind == KindRune && effs[i].Caster == owner && effs[i].Hidden {
				effs[i].Hidden = false
				n++
			}
		}
	}
	return n
}

// SquareEffectsFor è SquareEffects vista da un giocatore: le rune nascoste del
// suo avversario non ci sono (anti-cheat). Una casa che resta senza stati sparisce.
func (t *Tracker) SquareEffectsFor(viewer Color) []SquareEffectInfo {
	all := t.SquareEffects()
	out := make([]SquareEffectInfo, 0, len(all))
	for _, s := range all {
		kept := make([]ActiveEffect, 0, len(s.Effects))
		for _, e := range s.Effects {
			if e.Kind == KindRune && e.Hidden && e.Caster != viewer {
				continue
			}
			kept = append(kept, e)
		}
		if len(kept) > 0 {
			out = append(out, SquareEffectInfo{Square: s.Square, Effects: kept})
		}
	}
	return out
}

// RuneEntry dice quale pezzo entra in una casa con una mossa UCI già legale,
// giocata sulla FEN data (quella prima della mossa): la casa d'arrivo, quella di
// partenza e il pezzo com'era prima di muovere. Il re non fa scattare le rune
// (M36): nell'arrocco entra solo la torre. ok = false se nessun pezzo entra.
func RuneEntry(fen, move string) (square, origin string, piece byte, ok bool) {
	if len(move) < 4 {
		return "", "", 0, false
	}
	from, to := move[:2], move[2:4]
	p, err := PieceAt(fen, from)
	if err != nil || p == 0 {
		return "", "", 0, false
	}
	if !isKingType(p) {
		return to, from, p, true
	}
	var rookFrom, rookTo string
	switch {
	case from == "e1" && to == "g1":
		rookFrom, rookTo = "h1", "f1"
	case from == "e1" && to == "c1":
		rookFrom, rookTo = "a1", "d1"
	case from == "e8" && to == "g8":
		rookFrom, rookTo = "h8", "f8"
	case from == "e8" && to == "c8":
		rookFrom, rookTo = "a8", "d8"
	default:
		return "", "", 0, false
	}
	rook, err := PieceAt(fen, rookFrom)
	if err != nil || rook == 0 {
		return "", "", 0, false
	}
	return rookTo, rookFrom, rook, true
}

// ReturnPiece toglie il pezzo da `at` e rimette `piece` (com'era prima della
// mossa: un pedone promosso torna pedone) sulla casa di partenza `origin`, che
// deve essere vuota. Il lato al tratto non cambia; la casella en passant della
// spinta annullata si azzera.
func ReturnPiece(fen, at, origin string, piece byte) (string, error) {
	aRow, aCol, err := parseSquare(at)
	if err != nil {
		return "", err
	}
	oRow, oCol, err := parseSquare(origin)
	if err != nil {
		return "", err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return "", err
	}
	if grid[aRow][aCol] == 0 {
		return "", gameerr.Newf(gameerr.Internal, "nessun pezzo da rimandare in %s", at)
	}
	if grid[oRow][oCol] != 0 {
		return "", gameerr.Newf(gameerr.Internal, "la casa di partenza %s non è vuota", origin)
	}
	grid[aRow][aCol] = 0
	grid[oRow][oCol] = piece
	return ClearStaleEnPassant(replacePlacement(fen, encodePlacement(grid))), nil
}

// Strike dice cosa fa una runa al pezzo che entra: OnEnter se il tipo è fra
// quelli ammessi (Only vuoto = tutti), altrimenti il Fallback. Restituisce anche
// la durata del gelo; "" se la runa non fa nulla a quel pezzo.
func (s RuneSpec) Strike(piece byte) (string, int) {
	if len(s.Only) == 0 || containsString(s.Only, pieceName(piece)) {
		return s.OnEnter, s.Duration
	}
	return s.Fallback, s.FallbackDuration
}

// AroundSquares elenca le case entro la distanza di Chebyshev data da una casa,
// casa stessa esclusa, in ordine.
func AroundSquares(square string, radius int) []string {
	row, col, err := parseSquare(square)
	if err != nil {
		return nil
	}
	var out []string
	for r := row - radius; r <= row+radius; r++ {
		for c := col - radius; c <= col+radius; c++ {
			if r < 0 || r > 7 || c < 0 || c > 7 || (r == row && c == col) {
				continue
			}
			out = append(out, squareName(r, c))
		}
	}
	sort.Strings(out)
	return out
}
