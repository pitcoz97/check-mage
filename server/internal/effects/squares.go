package effects

// Stati sulle case (docs/BRIEFING-MAGIE.md, Step 3): a differenza degli stati sui
// pezzi restano sulla casa, qualunque pezzo ci sia o arrivi. Vivono nel Tracker,
// così si clonano e scadono insieme agli stati dei pezzi, con le stesse regole di
// durata (ActiveEffect.Caster, TickTurnEnd).

import "sort"

// Stati delle case.
const (
	KindWall      = "wall"       // nessun pezzo ci entra né la attraversa
	KindNoCapture = "no_capture" // nessuna cattura sul pezzo che ci sta sopra
	KindRune      = "rune"       // scatta quando un pezzo nemico ci entra (runes.go)
)

// Motivi di rifiuto legati agli stati delle case: details.reason di
// invalid_target e di move_blocked.
const (
	ReasonWall      = "wall"       // la casa ha un muro (o il percorso lo attraversa)
	ReasonNoCapture = "no_capture" // il pezzo è su una casa dove non si cattura
)

// SquareEffectInfo è la vista pubblica degli stati attivi su una casa.
type SquareEffectInfo struct {
	Square  string         `json:"square"`
	Effects []ActiveEffect `json:"effects"`
}

// AddSquareEffect mette (o rinnova) uno stato sulla casa.
func (t *Tracker) AddSquareEffect(square, kind string, turns int, source string, caster Color) {
	t.putSquareEffect(square, ActiveEffect{Kind: kind, RemainingTurns: turns, SourceSpellID: source, Caster: caster})
}

// putSquareEffect mette lo stato sulla casa, sostituendo quello dello stesso
// tipo. Le rune sono una per proprietario: quella di un giocatore sostituisce
// solo la sua.
func (t *Tracker) putSquareEffect(square string, e ActiveEffect) {
	if t.squares == nil {
		t.squares = map[string][]ActiveEffect{}
	}
	effs := t.squares[square]
	for i := range effs {
		if effs[i].Kind == e.Kind && (e.Kind != KindRune || effs[i].Caster == e.Caster) {
			effs[i] = e
			return
		}
	}
	t.squares[square] = append(effs, e)
}

// HasSquareEffect indica se la casa ha lo stato dato (nil-safe).
func (t *Tracker) HasSquareEffect(square, kind string) bool {
	if t == nil {
		return false
	}
	for _, e := range t.squares[square] {
		if e.Kind == kind {
			return true
		}
	}
	return false
}

// TickSquares aggiorna gli stati delle case alla fine del turno di finishing,
// con le regole di TickTurnEnd, e indica se qualcuno è scaduto.
func (t *Tracker) TickSquares(finishing Color) bool {
	expired := false
	for sq, effs := range t.squares {
		kept := effs[:0]
		for _, e := range effs {
			if e.RemainingTurns == Permanent {
				kept = append(kept, e)
				continue
			}
			if e.Caster != finishing {
				e.RemainingTurns--
			}
			if e.RemainingTurns <= 0 {
				expired = true
			} else {
				kept = append(kept, e)
			}
		}
		if len(kept) == 0 {
			delete(t.squares, sq)
		} else {
			t.squares[sq] = kept
		}
	}
	return expired
}

// SquareEffects elenca gli stati attivi sulle case, copiati e ordinati per casa
// (per game_state, square_effects_changed e lo snapshot).
func (t *Tracker) SquareEffects() []SquareEffectInfo {
	out := make([]SquareEffectInfo, 0, len(t.squares))
	for sq, effs := range t.squares {
		if len(effs) > 0 {
			out = append(out, SquareEffectInfo{Square: sq, Effects: append([]ActiveEffect(nil), effs...)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Square < out[j].Square })
	return out
}

// RestoreSquareEffects riattacca gli stati persistiti di una casa (ripristino).
func (t *Tracker) RestoreSquareEffects(square string, effs []ActiveEffect) {
	if _, _, err := parseSquare(square); err != nil {
		return
	}
	for _, e := range effs {
		if e.Kind == KindRune && e.Rune == nil {
			continue // una runa senza spec non saprebbe cosa fare
		}
		t.putSquareEffect(square, e)
	}
}

// CaptureSquare restituisce la casa del pezzo catturato da una mossa già
// validata come legale, oppure "" se la mossa non cattura. Per l'en passant è la
// casa del pedone catturato, non quella d'arrivo.
func CaptureSquare(fen, from, to string) string {
	if p, err := PieceAt(fen, to); err == nil && p != 0 {
		return to
	}
	if p, err := PieceAt(fen, from); err == nil && isPawnType(p) && from[0] != to[0] {
		return string(to[0]) + string(from[1])
	}
	return ""
}

// MoveBlock dice se gli stati delle case vietano una mossa UCI già legale per gli
// scacchi: restituisce la casa responsabile e il motivo (ReasonWall o
// ReasonNoCapture), oppure due stringhe vuote. I muri bloccano solo il
// movimento, non gli attacchi: lo scacco resta quello degli scacchi.
//
// Un pezzo non entra in una casa col muro e non la attraversa: per torre,
// alfiere e donna contano le case fra partenza e arrivo, per il pedone la casa
// di mezzo della spinta doppia, per l'arrocco tutte le case fra re e torre. Il
// cavallo e le mosse di una casa controllano solo l'arrivo. Non si cattura il
// pezzo che sta su una casa no_capture (per l'en passant, il pedone preso).
func MoveBlock(fen string, t *Tracker, move string) (string, string) {
	if t == nil || len(t.squares) == 0 || len(move) < 4 {
		return "", ""
	}
	from, to := move[:2], move[2:4]
	fr, fc, errFrom := parseSquare(from)
	tr, tc, errTo := parseSquare(to)
	if errFrom != nil || errTo != nil {
		return "", ""
	}
	piece, err := PieceAt(fen, from)
	if err != nil || piece == 0 {
		return "", ""
	}
	if t.HasSquareEffect(to, KindWall) {
		return to, ReasonWall
	}
	for _, sq := range crossedSquares(piece, fr, fc, tr, tc) {
		if t.HasSquareEffect(sq, KindWall) {
			return sq, ReasonWall
		}
	}
	if captured := CaptureSquare(fen, from, to); captured != "" && t.HasSquareEffect(captured, KindNoCapture) {
		return captured, ReasonNoCapture
	}
	return "", ""
}

// crossedSquares elenca le case attraversate (arrivo escluso) da una mossa.
func crossedSquares(piece byte, fr, fc, tr, tc int) []string {
	dr, dc := sign(tr-fr), sign(tc-fc)
	switch {
	case isKingType(piece) && abs(tc-fc) == 2:
		// Arrocco: dal re fino alla torre, torre esclusa.
		rookCol := 7
		if dc < 0 {
			rookCol = 0
		}
		var out []string
		for c := fc + dc; c != rookCol; c += dc {
			out = append(out, squareName(fr, c))
		}
		return out
	case isPawnType(piece):
		if abs(tr-fr) == 2 {
			return []string{squareName(fr+dr, fc)}
		}
		return nil
	case isSlider(piece) && (fr == tr || fc == tc || abs(tr-fr) == abs(tc-fc)):
		var out []string
		for r, c := fr+dr, fc+dc; r != tr || c != tc; r, c = r+dr, c+dc {
			out = append(out, squareName(r, c))
		}
		return out
	}
	return nil
}

func isSlider(p byte) bool {
	switch p {
	case 'R', 'r', 'B', 'b', 'Q', 'q':
		return true
	}
	return false
}

func sign(x int) int {
	switch {
	case x > 0:
		return 1
	case x < 0:
		return -1
	}
	return 0
}
