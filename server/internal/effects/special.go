package effects

// Mosse speciali (docs/BRIEFING-MAGIE.md, Step 6): mosse che Stockfish non
// conosce. Il server le genera e le valida qui, in modo puro: phasing (un alfiere
// che scivola attraverso i pezzi), movimento preso in prestito (un pedone che
// muove anche come un cavallo o un alfiere) e passo di lato dello Stendardo.

import (
	"sort"
	"strconv"
	"strings"

	"chess-server/internal/gameerr"
)

// Stati di movimento sui pezzi: durano fino alla fine del turno di chi li lancia
// (durata 0, M9) e seguono il pezzo come gli altri stati del Tracker.
const (
	KindPhasing = "phasing"         // alfiere: attraversa i pezzi, senza cattura
	KindBorrow  = "borrow_movement" // pedone: in più muove come ActiveEffect.BorrowAs
)

// AddMovementEffect mette uno stato di movimento su un PROPRIO pezzo. borrowAs è
// il tipo preso in prestito ("knight", "bishop"), vuoto per il phasing.
func AddMovementEffect(t *Tracker, square, kind, borrowAs string, caster Color, turns int, source string) error {
	col, ok := t.colorAt(square)
	if !ok {
		return gameerr.Newf(gameerr.InvalidTarget, "nessun pezzo in %s", square)
	}
	if col != caster {
		return gameerr.Newf(gameerr.InvalidTarget, "puoi farlo solo sui tuoi pezzi (%s)", square)
	}
	if err := t.addEffect(square, kind, turns, source, caster); err != nil {
		return err
	}
	ps := t.pieces[t.bySquare[square]]
	for i := range ps.Effects {
		if ps.Effects[i].Kind == kind {
			ps.Effects[i].BorrowAs = borrowAs
		}
	}
	return nil
}

// BorrowedAs restituisce il tipo preso in prestito dal pezzo nella casa, o "".
func (t *Tracker) BorrowedAs(square string) string {
	id, ok := t.bySquare[square]
	if !ok {
		return ""
	}
	for _, e := range t.pieces[id].Effects {
		if e.Kind == KindBorrow {
			return e.BorrowAs
		}
	}
	return ""
}

var (
	diagonals   = [][2]int{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}
	knightJumps = [][2]int{{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}}
)

// SpecialMoves elenca, in ordine, le mosse speciali del lato al tratto nella FEN
// già valide (M54–M59): rispettano gelo, muri e santuari e non lasciano il proprio
// re sotto scacco. sidestep = lo Stendardo del lato al tratto è attivo. Alcune
// possono coincidere con mosse già legali per gli scacchi: il chiamante prova
// prima Stockfish.
func SpecialMoves(fen string, t *Tracker, sidestep bool) []string {
	grid, err := parsePlacement(fen)
	if err != nil {
		return nil
	}
	side := SideToMove(fen)
	seen := map[string]bool{}
	var out []string
	add := func(from, to string) {
		move := from + to
		if seen[move] {
			return
		}
		seen[move] = true
		next, err := ApplySpecialMove(fen, move)
		if err != nil || IsKingAttacked(next, side) {
			return
		}
		out = append(out, move)
	}
	// target dice se il pezzo può finire nella casa: mai sul muro, mai su un proprio
	// pezzo o sul re, e una cattura solo se ammessa e non su un santuario.
	target := func(row, col int, canCapture bool) bool {
		sq := squareName(row, col)
		if t.HasSquareEffect(sq, KindWall) {
			return false
		}
		p := grid[row][col]
		if p == 0 {
			return true
		}
		if !canCapture || pieceColor(p) == side || isKingType(p) {
			return false
		}
		return !t.HasSquareEffect(sq, KindNoCapture)
	}
	inside := func(row, col int) bool { return row >= 0 && row < 8 && col >= 0 && col < 8 }

	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			p := grid[row][col]
			if p == 0 || pieceColor(p) != side {
				continue
			}
			from := squareName(row, col)
			if t.IsFrozen(from) {
				continue
			}
			switch {
			case (p == 'B' || p == 'b') && t.HasEffect(from, KindPhasing):
				// Phasing: attraverso i pezzi fino a una casa vuota; il muro ferma (M54).
				for _, d := range diagonals {
					for r, c := row+d[0], col+d[1]; inside(r, c); r, c = r+d[0], c+d[1] {
						if t.HasSquareEffect(squareName(r, c), KindWall) {
							break
						}
						if grid[r][c] == 0 {
							add(from, squareName(r, c))
						}
					}
				}
			case isPawnType(p):
				// Movimento preso in prestito: mai in 1ª o 8ª traversa (M56).
				okRank := func(r int) bool { return r != 0 && r != 7 }
				switch t.BorrowedAs(from) {
				case "knight":
					for _, j := range knightJumps {
						r, c := row+j[0], col+j[1]
						if inside(r, c) && okRank(r) && target(r, c, true) {
							add(from, squareName(r, c))
						}
					}
				case "bishop":
					for _, d := range diagonals {
						for r, c := row+d[0], col+d[1]; inside(r, c); r, c = r+d[0], c+d[1] {
							if t.HasSquareEffect(squareName(r, c), KindWall) {
								break
							}
							if okRank(r) && target(r, c, true) {
								add(from, squareName(r, c))
							}
							if grid[r][c] != 0 {
								break
							}
						}
					}
				}
				// Passo di lato dello Stendardo: una casa vuota accanto, senza cattura (M58).
				if sidestep {
					for _, dc := range []int{-1, 1} {
						if inside(row, col+dc) && target(row, col+dc, false) {
							add(from, squareName(row, col+dc))
						}
					}
				}
			}
		}
	}
	sort.Strings(out)
	return out
}

// ApplySpecialMove applica alla FEN una mossa speciale già validata: sposta il
// pezzo (catturando quello sulla casa d'arrivo), passa il tratto, azzera l'en
// passant, aggiorna i contatori e i diritti d'arrocco. Non promuove mai: una
// mossa speciale non porta un pedone in ultima traversa.
func ApplySpecialMove(fen, move string) (string, error) {
	if len(move) < 4 {
		return "", gameerr.Newf(gameerr.IllegalMove, "mossa non valida: %s", move)
	}
	from, to := move[:2], move[2:4]
	fr, fc, err := parseSquare(from)
	if err != nil {
		return "", err
	}
	tr, tc, err := parseSquare(to)
	if err != nil {
		return "", err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return "", err
	}
	p, captured := grid[fr][fc], grid[tr][tc]
	if p == 0 {
		return "", gameerr.Newf(gameerr.IllegalMove, "nessun pezzo in %s", from)
	}
	grid[tr][tc], grid[fr][fc] = p, 0
	next := replacePlacement(fen, encodePlacement(grid))
	next = clearCastlingForMovedPiece(next, from, p)
	if captured == 'R' || captured == 'r' {
		next = clearCastlingForRook(next, to, captured)
	}

	fields := strings.Fields(next)
	if len(fields) < 6 {
		return next, nil
	}
	if fields[1] == "w" {
		fields[1] = "b"
	} else {
		fields[1] = "w"
		if fm, err := strconv.Atoi(fields[5]); err == nil {
			fields[5] = strconv.Itoa(fm + 1)
		}
	}
	fields[3] = "-"
	if isPawnType(p) || captured != 0 {
		fields[4] = "0"
	} else if hc, err := strconv.Atoi(fields[4]); err == nil {
		fields[4] = strconv.Itoa(hc + 1)
	}
	return strings.Join(fields, " "), nil
}
