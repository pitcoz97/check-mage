package effects

// Rilevamento dello scacco in puro Go sulla FEN. Serve a validare le posizioni
// prodotte dalle magie (una magia non può creare una posizione illegale) senza
// interrogare Stockfish, così la regola è testabile e deterministica.

// Opponent restituisce l'altro colore.
func (c Color) Opponent() Color {
	if c == White {
		return Black
	}
	return White
}

// SideToMove restituisce il colore al tratto nella FEN (bianco se il campo manca).
func SideToMove(fen string) Color {
	for i := 0; i+2 < len(fen); i++ {
		if fen[i] == ' ' {
			if fen[i+1] == 'b' {
				return Black
			}
			return White
		}
	}
	return White
}

// IsKingAttacked indica se il re del colore dato è attaccato da un pezzo
// avversario. Se il re non c'è (o la FEN è malformata) ritorna false.
func IsKingAttacked(fen string, c Color) bool {
	grid, err := parsePlacement(fen)
	if err != nil {
		return false
	}
	king := byte('K')
	if c == Black {
		king = 'k'
	}
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			if grid[row][col] == king {
				return squareAttacked(grid, row, col, c.Opponent())
			}
		}
	}
	return false
}

// squareAttacked indica se la casella (row, col) è attaccata da un pezzo del
// colore `by`. Riga 0 = traversa 8.
func squareAttacked(grid [8][8]byte, row, col int, by Color) bool {
	piece := func(p byte) byte { // carattere del pezzo nel colore dell'attaccante
		if by == White {
			return p - 32
		}
		return p
	}
	at := func(r, c int) byte {
		if r < 0 || r > 7 || c < 0 || c > 7 {
			return 0
		}
		return grid[r][c]
	}

	// Pedoni: il bianco avanza verso la riga 0, quindi attacca da row+1.
	pawnRow := row + 1
	if by == Black {
		pawnRow = row - 1
	}
	if at(pawnRow, col-1) == piece('p') || at(pawnRow, col+1) == piece('p') {
		return true
	}

	// Cavalli.
	for _, d := range [][2]int{{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}} {
		if at(row+d[0], col+d[1]) == piece('n') {
			return true
		}
	}

	// Re avversario.
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if (dr != 0 || dc != 0) && at(row+dr, col+dc) == piece('k') {
				return true
			}
		}
	}

	// Pezzi a lungo raggio: torre/donna in ortogonale, alfiere/donna in diagonale.
	slide := func(dr, dc int, a, b byte) bool {
		for r, c := row+dr, col+dc; r >= 0 && r < 8 && c >= 0 && c < 8; r, c = r+dr, c+dc {
			if p := grid[r][c]; p != 0 {
				return p == a || p == b
			}
		}
		return false
	}
	for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		if slide(d[0], d[1], piece('r'), piece('q')) {
			return true
		}
	}
	for _, d := range [][2]int{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}} {
		if slide(d[0], d[1], piece('b'), piece('q')) {
			return true
		}
	}
	return false
}
