package game

import (
	"sort"
	"strings"

	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// Mosse speciali nella room (docs/BRIEFING-MAGIE.md, Step 6): phasing, movimento
// preso in prestito e passo di lato arrivano da effects.SpecialMoves; la seconda
// mossa di Fretta vive qui.

// extraMove è la seconda mossa concessa da Fretta al giocatore nel suo turno
// (M57). Active = la prima mossa è stata giocata e si attende la seconda (o il
// passaggio); FENAfterFirst è la posizione da ripristinare se la salta.
type extraMove struct {
	Player        match.Player       `json:"player"`
	Turn          int                `json:"turn"`
	Pieces        []spells.PieceKind `json:"pieces"`
	NoCapture     bool               `json:"no_capture"`
	Active        bool               `json:"active,omitempty"`
	FENAfterFirst string             `json:"fen_after_first,omitempty"`
}

// extraGranted indica se p ha ancora una seconda mossa di Fretta da usare in
// questo turno. Va invocata con r.mu tenuto.
func (r *Room) extraGranted(p match.Player) bool {
	return r.extra != nil && !r.extra.Active && r.extra.Player == p && r.extra.Turn == r.Match.TurnNumber
}

// extraActive indica se si attende la seconda mossa di Fretta.
func (r *Room) extraActive() bool {
	return r.extra != nil && r.extra.Active
}

// sidestepActive indica se lo Stendardo di p è attivo (M58).
func (r *Room) sidestepActive(p match.Player) bool {
	for _, a := range r.playerState(p).Auras {
		if a.Grant == spells.AuraGrantPawnSidestep && a.Active {
			return true
		}
	}
	return false
}

// specialMoves elenca le mosse speciali del lato al tratto della FEN. Va
// invocata con r.mu tenuto.
func (r *Room) specialMoves() []string {
	if r.Tracker == nil || r.Board == nil {
		return nil
	}
	side := match.Player(sideToMove(r.Board.FEN))
	return effects.SpecialMoves(r.Board.FEN, r.Tracker, r.sidestepActive(side))
}

// extraMoves elenca le seconde mosse di Fretta ammesse sulla FEN corrente (già
// col tratto a chi muove): mosse legali per gli scacchi del tipo concesso,
// senza cattura se vietata, giocabili (gelo, muri). Va invocata con r.mu tenuto.
func (r *Room) extraMoves() []string {
	if r.extra == nil || engine.SF == nil {
		return nil
	}
	var out []string
	for _, move := range engine.SF.LegalMoves(r.Board.FEN) {
		if len(move) < 4 || !r.isPlayable(move) {
			continue
		}
		p, err := effects.PieceAt(r.Board.FEN, move[:2])
		if err != nil || p == 0 || !containsPieceKind(r.extra.Pieces, effects.PieceKindName(p)) {
			continue
		}
		if r.extra.NoCapture && effects.CaptureSquare(r.Board.FEN, move[:2], move[2:4]) != "" {
			continue
		}
		out = append(out, move)
	}
	sort.Strings(out)
	return out
}

// enterExtraMove, dopo la prima mossa di p, apre la seconda mossa di Fretta se
// l'avversario non è sotto scacco e c'è almeno una mossa ammessa: la FEN torna
// al tratto di p (senza en passant) e si ricorda quella da ripristinare. Va
// invocata con r.mu tenuto.
func (r *Room) enterExtraMove(p match.Player) bool {
	if effects.IsKingAttacked(r.Board.FEN, toEffectsColor(p.Opponent())) {
		r.extra = nil // la prima mossa ha dato scacco: la seconda salta (M57)
		return false
	}
	after := r.Board.FEN
	r.extra.Active, r.extra.FENAfterFirst = true, after
	r.Board.FEN = withoutEnPassant(effects.WithSideToMove(after, toEffectsColor(p)))
	r.Board.Turn = string(p)
	if len(r.extraMoves()) == 0 {
		r.Board.FEN, r.Board.Turn = after, sideToMove(after)
		r.extra = nil
		return false
	}
	return true
}

// withoutEnPassant azzera la casa en passant della FEN.
func withoutEnPassant(fen string) string {
	fields := strings.Fields(fen)
	if len(fields) < 4 {
		return fen
	}
	fields[3] = "-"
	return strings.Join(fields, " ")
}

func containsPieceKind(list []spells.PieceKind, kind string) bool {
	for _, k := range list {
		if string(k) == kind {
			return true
		}
	}
	return false
}

// moveOptions è il payload di move_options e dei campi omonimi di game_state:
// le mosse fuori dagli scacchi del giocatore di turno nella fase Move (M60).
type moveOptions struct {
	SpecialMoves []string    `json:"special_moves"`
	ExtraMove    interface{} `json:"extra_move"`
}

// moveOptionsFor costruisce le opzioni viste da viewer: vuote se non è il suo
// turno nella fase Move. Durante la seconda mossa di Fretta special_moves
// contiene proprio le mosse ammesse. Va invocata con r.mu tenuto.
func (r *Room) moveOptionsFor(viewer match.Player) moveOptions {
	out := moveOptions{SpecialMoves: []string{}}
	if r.Match == nil || r.ended || r.Match.CurrentPhase != phase.PhaseMove || r.Match.ActivePlayer != viewer {
		return out
	}
	if r.extraActive() {
		out.SpecialMoves = append(out.SpecialMoves, r.extraMoves()...)
		out.ExtraMove = map[string]interface{}{"pieces": r.extra.Pieces, "no_capture": r.extra.NoCapture}
		return out
	}
	out.SpecialMoves = append(out.SpecialMoves, r.specialMoves()...)
	return out
}

// moveOptionViews fotografa le opzioni dei due giocatori. Va invocata con r.mu tenuto.
func (r *Room) moveOptionViews() map[match.Player]moveOptions {
	return map[match.Player]moveOptions{
		match.PlayerWhite: r.moveOptionsFor(match.PlayerWhite),
		match.PlayerBlack: r.moveOptionsFor(match.PlayerBlack),
	}
}

// sendMoveOptions manda a ciascuno le sue opzioni di mossa. Va invocata senza r.mu.
func (r *Room) sendMoveOptions(views map[match.Player]moveOptions) {
	if views == nil {
		return
	}
	for _, p := range []match.Player{match.PlayerWhite, match.PlayerBlack} {
		if c := r.clientOf(p); c != nil {
			c.SendMessage(models.MsgMoveOptions, views[p])
		}
	}
}
