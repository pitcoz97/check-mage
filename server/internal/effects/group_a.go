package effects

// Handler del gruppo A (docs/BRIEFING-MAGIE.md §6): modifiche pure della FEN e
// selezioni di pezzi. Non toccano il Tracker: il chiamante lo allinea con
// Tracker.Swap / SetType / Add.

import (
	"strings"

	"chess-server/internal/gameerr"
)

// Motivi aggiuntivi di invalid_target.
const (
	ReasonPawnRank = "pawn_rank" // un pedone finirebbe sulla 1ª o sull'8ª traversa
)

// kindLetters traduce il nome del pezzo nel carattere FEN minuscolo.
var kindLetters = map[string]byte{"pawn": 'p', "knight": 'n', "bishop": 'b', "rook": 'r', "queen": 'q', "king": 'k'}

// PieceLetter restituisce il carattere FEN del pezzo nel colore dato, o 0 se il
// nome non è noto.
func PieceLetter(kind string, c Color) byte {
	l, ok := kindLetters[kind]
	if !ok {
		return 0
	}
	return colorize(l, c)
}

// PieceKindName restituisce il nome del pezzo di un carattere FEN.
func PieceKindName(p byte) string { return pieceName(p) }

// ColorOf restituisce il colore di un carattere FEN.
func ColorOf(p byte) Color { return pieceColor(p) }

// SwapPieces scambia i pezzi di due case occupate. Rifiuta un pedone che
// finirebbe sulla 1ª o sull'8ª traversa (posizione non ammessa dagli scacchi).
// Una torre o un re che lasciano la casa iniziale perdono i diritti d'arrocco.
func SwapPieces(fen, a, b string) (string, error) {
	ar, ac, err := parseSquare(a)
	if err != nil {
		return "", err
	}
	br, bc, err := parseSquare(b)
	if err != nil {
		return "", err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return "", err
	}
	pa, pb := grid[ar][ac], grid[br][bc]
	if pa == 0 || pb == 0 {
		return "", gameerr.Newf(gameerr.InvalidTarget, "servono due pezzi da scambiare (%s, %s)", a, b).
			With("reason", ReasonNoPiece)
	}
	if isPawnType(pa) && (br == 0 || br == 7) {
		return "", pawnRankError(1, b)
	}
	if isPawnType(pb) && (ar == 0 || ar == 7) {
		return "", pawnRankError(0, a)
	}
	grid[ar][ac], grid[br][bc] = pb, pa
	next := replacePlacement(fen, encodePlacement(grid))
	next = clearCastlingForMovedPiece(next, a, pa)
	next = clearCastlingForMovedPiece(next, b, pb)
	return next, nil
}

func pawnRankError(index int, square string) error {
	return gameerr.Newf(gameerr.InvalidTarget, "un pedone non può stare in %s", square).
		With("index", index).With("reason", ReasonPawnRank).With("square", square)
}

// SetPiece sostituisce il pezzo in una casa occupata con quello dato (stesso
// colore a carico del chiamante). Una torre che cambia tipo sulla casa
// iniziale perde il suo diritto d'arrocco.
func SetPiece(fen, square string, piece byte) (string, error) {
	row, col, err := parseSquare(square)
	if err != nil {
		return "", err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return "", err
	}
	old := grid[row][col]
	if old == 0 {
		return "", gameerr.Newf(gameerr.InvalidTarget, "nessun pezzo in %s", square).
			With("reason", ReasonNoPiece).With("square", square)
	}
	grid[row][col] = piece
	next := replacePlacement(fen, encodePlacement(grid))
	if old == 'R' || old == 'r' {
		next = clearCastlingForRook(next, square, old)
	}
	return next, nil
}

// RestoreCastling ripristina nella FEN i diritti d'arrocco del colore dato per
// ogni lato dove re e torre sono ancora sulle case iniziali. Restituisce la FEN
// e se almeno un diritto è stato aggiunto.
func RestoreCastling(fen string, c Color) (string, bool) {
	grid, err := parsePlacement(fen)
	if err != nil {
		return fen, false
	}
	fields := strings.Fields(fen)
	if len(fields) < 3 {
		return fen, false
	}
	row, king, rook, short, long := 7, byte('K'), byte('R'), "K", "Q"
	if c == Black {
		row, king, rook, short, long = 0, 'k', 'r', "k", "q"
	}
	rights := fields[2]
	if rights == "-" {
		rights = ""
	}
	added := false
	if grid[row][4] == king {
		if grid[row][7] == rook && !strings.Contains(rights, short) {
			rights += short
			added = true
		}
		if grid[row][0] == rook && !strings.Contains(rights, long) {
			rights += long
			added = true
		}
	}
	if !added {
		return fen, false
	}
	// Ordine canonico della FEN: KQkq.
	var sb strings.Builder
	for _, r := range "KQkq" {
		if strings.ContainsRune(rights, r) {
			sb.WriteRune(r)
		}
	}
	fields[2] = sb.String()
	return strings.Join(fields, " "), true
}

// PiecesOf restituisce le case dei pezzi del colore dato con i tipi indicati
// (vuoto = tutti tranne il re), in ordine di scansione (a8 → h1).
func PiecesOf(fen string, c Color, kinds []string) []string {
	grid, err := parsePlacement(fen)
	if err != nil {
		return nil
	}
	var out []string
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			p := grid[row][col]
			if p == 0 || pieceColor(p) != c {
				continue
			}
			name := pieceName(p)
			if len(kinds) == 0 {
				if name == "king" {
					continue
				}
			} else if !containsString(kinds, name) {
				continue
			}
			out = append(out, squareName(row, col))
		}
	}
	return out
}

// AroundKing restituisce le case dei pezzi del colore dato entro il raggio
// (Chebyshev) dal proprio re, re escluso, in ordine di scansione.
func AroundKing(fen string, c Color, radius int) []string {
	grid, err := parsePlacement(fen)
	if err != nil {
		return nil
	}
	king := colorize('k', c)
	kr, kc := -1, -1
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			if grid[row][col] == king {
				kr, kc = row, col
			}
		}
	}
	if kr < 0 {
		return nil
	}
	var out []string
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			p := grid[row][col]
			if p == 0 || p == king || pieceColor(p) != c {
				continue
			}
			if abs(row-kr) <= radius && abs(col-kc) <= radius {
				out = append(out, squareName(row, col))
			}
		}
	}
	return out
}

// PawnsSideBySide restituisce le case dei pedoni del colore dato che hanno un
// altro proprio pedone accanto sulla stessa traversa, in ordine di scansione.
func PawnsSideBySide(fen string, c Color) []string {
	grid, err := parsePlacement(fen)
	if err != nil {
		return nil
	}
	pawn := colorize('p', c)
	var out []string
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			if grid[row][col] != pawn {
				continue
			}
			left := col > 0 && grid[row][col-1] == pawn
			right := col < 7 && grid[row][col+1] == pawn
			if left || right {
				out = append(out, squareName(row, col))
			}
		}
	}
	return out
}

func containsString(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// Swap scambia l'identità (e gli effetti) dei pezzi di due case.
func (t *Tracker) Swap(a, b string) {
	ida, okA := t.bySquare[a]
	idb, okB := t.bySquare[b]
	if !okA || !okB {
		return
	}
	t.bySquare[a], t.bySquare[b] = idb, ida
	t.pieces[ida].Square = b
	t.pieces[idb].Square = a
}

// SetType cambia il tipo del pezzo nella casa, conservando id ed effetti.
func (t *Tracker) SetType(square string, piece byte) {
	if id, ok := t.bySquare[square]; ok {
		t.pieces[id].Type = piece
	}
}

// Info restituisce id e carattere FEN del pezzo nella casa.
func (t *Tracker) Info(square string) (int, byte, bool) {
	id, ok := t.bySquare[square]
	if !ok {
		return 0, 0, false
	}
	return id, t.pieces[id].Type, true
}
