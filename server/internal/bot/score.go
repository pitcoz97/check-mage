package bot

import (
	"slices"

	"chess-server/internal/effects"
	"chess-server/internal/spells"
)

// Punteggio a regole di un cast, in "pedoni": quanto materiale o vantaggio
// vale per il bot. Non simula la partita: guarda i pezzi bersaglio, se sono
// minacciati e cosa fa ogni effetto. Gli effetti situazionali (rune, muri,
// trigger, aure, mosse speciali) valgono poco, perché senza un piano non
// rendono: l'intermedio non li lancia e l'avanzato quasi mai.

// situational è il valore di un effetto che dipende da un piano che il bot non fa.
const situational = 0.1

// kindValue è il valore classico di un pezzo; il re non è mai un bersaglio.
func kindValue(k spells.PieceKind) float64 {
	switch k {
	case spells.Pawn:
		return 1
	case spells.Knight, spells.Bishop:
		return 3
	case spells.Rook:
		return 5
	case spells.Queen:
		return 9
	}
	return 0
}

// pieceKind è il tipo del pezzo con carattere FEN p ("" per una casa vuota).
func pieceKind(p byte) spells.PieceKind {
	switch p | 0x20 {
	case 'p':
		return spells.Pawn
	case 'n':
		return spells.Knight
	case 'b':
		return spells.Bishop
	case 'r':
		return spells.Rook
	case 'q':
		return spells.Queen
	case 'k':
		return spells.King
	}
	return ""
}

// pieceValue è il valore del pezzo con carattere FEN p.
func pieceValue(p byte) float64 {
	return kindValue(pieceKind(p))
}

// isOwn indica se il carattere FEN p è un pezzo del colore c.
func isOwn(p byte, c effects.Color) bool {
	white := p >= 'A' && p <= 'Z'
	return white == (c == effects.White)
}

// scoreCast valuta il cast della magia sui bersagli dati.
func scoreCast(v View, def spells.Spell, targets []string, choice spells.Choice) float64 {
	enemy := v.Color.Opponent()
	// Il primo bersaglio che è un pezzo: quello su cui agiscono gli effetti sul pezzo.
	square, piece := "", byte(0)
	for _, t := range targets {
		if p, err := effects.PieceAt(v.FEN, t); err == nil && p != 0 {
			square, piece = t, p
			break
		}
	}
	own := piece != 0 && isOwn(piece, v.Color)
	value := pieceValue(piece)

	score := 0.0
	for _, e := range def.Effects {
		switch e.Kind {
		case spells.EffectDestroyPiece:
			if own {
				score -= value
			} else {
				score += value
			}
		case spells.EffectFreezePiece:
			if piece != 0 && !v.Tracker.IsFrozen(square) {
				if own {
					score -= value / 2
				} else {
					score += value / 2
				}
			}
		case spells.EffectFreezeAll:
			score += 0.3 * float64(countPieces(v, enemy, kindsParam(e.Params, "pieces"), func(sq string) bool {
				return !v.Tracker.IsFrozen(sq)
			}))
		case spells.EffectShieldPiece:
			if own && !v.Tracker.HasShield(square) {
				if effects.SquareAttacked(v.FEN, square, enemy) {
					score += 0.7 * value
				} else {
					score += 0.1 // un pezzo tranquillo: lo scudo serve a poco
				}
			}
		case spells.EffectShieldArea:
			// Gli stessi pezzi che sceglie il server: vale lo scudo su quelli minacciati.
			var area []string
			if around, _ := e.Params["around"].(string); around == "own_king" {
				area = effects.AroundKing(v.FEN, v.Color, paramInt(e.Params, "radius", 1))
			} else if filter, _ := e.Params["filter"].(string); filter == "own_pawns_side_by_side" {
				area = effects.PawnsSideBySide(v.FEN, v.Color)
			}
			for _, sq := range area {
				p, err := effects.PieceAt(v.FEN, sq)
				if err == nil && !v.Tracker.HasShield(sq) && effects.SquareAttacked(v.FEN, sq, enemy) {
					score += 0.7 * pieceValue(p)
				}
			}
		case spells.EffectDrawCard:
			score += float64(paramInt(e.Params, "amount", 1))
		case spells.EffectGainMana:
			score += 0.3 * float64(paramInt(e.Params, "amount", 1))
		case spells.EffectSummonPawn:
			score += 1
		case spells.EffectRevivePiece:
			score += kindValue(choice.Piece)
		case spells.EffectPromotePiece:
			score += kindValue(choice.Piece) - 1
		case spells.EffectMovePiece:
			score += 0.3
		default:
			score += situational
		}
	}
	return score
}

// countPieces conta i pezzi non re del colore c, dei tipi kinds (vuoto = tutti),
// sulle case che keep accetta.
func countPieces(v View, c effects.Color, kinds []spells.PieceKind, keep func(square string) bool) int {
	n := 0
	for _, square := range allSquares {
		p, err := effects.PieceAt(v.FEN, square)
		if err != nil || p == 0 || pieceKind(p) == spells.King || !isOwn(p, c) {
			continue
		}
		if len(kinds) > 0 && !slices.Contains(kinds, pieceKind(p)) {
			continue
		}
		if keep(square) {
			n++
		}
	}
	return n
}

// paramInt legge un parametro intero (i parametri del catalogo sono int).
func paramInt(params map[string]interface{}, key string, def int) int {
	switch v := params[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return def
}
