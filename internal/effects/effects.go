// Package effects implementa gli handler degli effetti delle magie che agiscono
// sulla scacchiera. Lavora direttamente sulla FEN (la fonte di verità della
// posizione) con pura manipolazione di stringa: non dipende da Stockfish, così
// è completamente testabile e deterministico.
package effects

import (
	"fmt"
	"strings"
)

// Color è il colore di un pezzo / di chi lancia la magia.
type Color string

const (
	White Color = "white"
	Black Color = "black"
)

// parseSquare converte una casella algebrica ("e4") in indici di griglia, dove
// grid[0] è la traversa 8 e grid[7] la traversa 1.
func parseSquare(square string) (row, col int, err error) {
	if len(square) != 2 {
		return 0, 0, fmt.Errorf("casella non valida: %q", square)
	}
	file, rank := square[0], square[1]
	if file < 'a' || file > 'h' || rank < '1' || rank > '8' {
		return 0, 0, fmt.Errorf("casella fuori scacchiera: %q", square)
	}
	col = int(file - 'a')
	row = int('8' - rank) // traversa 8 -> riga 0
	return row, col, nil
}

// parsePlacement decodifica il campo piece-placement della FEN in una griglia
// 8x8 (0 = casella vuota).
func parsePlacement(fen string) ([8][8]byte, error) {
	var grid [8][8]byte
	fields := strings.Fields(fen)
	if len(fields) == 0 {
		return grid, fmt.Errorf("FEN vuota")
	}
	ranks := strings.Split(fields[0], "/")
	if len(ranks) != 8 {
		return grid, fmt.Errorf("FEN malformata: %d traverse", len(ranks))
	}
	for r, rankStr := range ranks {
		c := 0
		for i := 0; i < len(rankStr); i++ {
			ch := rankStr[i]
			if ch >= '1' && ch <= '8' {
				for k := 0; k < int(ch-'0'); k++ {
					if c >= 8 {
						return grid, fmt.Errorf("traversa troppo lunga: %q", rankStr)
					}
					grid[r][c] = 0
					c++
				}
				continue
			}
			if c >= 8 {
				return grid, fmt.Errorf("traversa troppo lunga: %q", rankStr)
			}
			grid[r][c] = ch
			c++
		}
		if c != 8 {
			return grid, fmt.Errorf("traversa incompleta: %q", rankStr)
		}
	}
	return grid, nil
}

// encodePlacement ricodifica la griglia nel campo piece-placement della FEN.
func encodePlacement(grid [8][8]byte) string {
	ranks := make([]string, 8)
	for r := 0; r < 8; r++ {
		var sb strings.Builder
		empty := 0
		for c := 0; c < 8; c++ {
			if grid[r][c] == 0 {
				empty++
				continue
			}
			if empty > 0 {
				sb.WriteByte(byte('0' + empty))
				empty = 0
			}
			sb.WriteByte(grid[r][c])
		}
		if empty > 0 {
			sb.WriteByte(byte('0' + empty))
		}
		ranks[r] = sb.String()
	}
	return strings.Join(ranks, "/")
}

// replacePlacement sostituisce il campo piece-placement della FEN, lasciando
// invariati gli altri campi (lato al tratto, arrocchi, en passant, contatori).
func replacePlacement(fen, placement string) string {
	fields := strings.Fields(fen)
	fields[0] = placement
	return strings.Join(fields, " ")
}

// pieceColor restituisce il colore di un carattere-pezzo FEN (maiuscolo=bianco).
func pieceColor(p byte) Color {
	if p >= 'A' && p <= 'Z' {
		return White
	}
	return Black
}

// pieceName traduce il carattere del pezzo nel nome inglese.
func pieceName(p byte) string {
	switch p | 0x20 { // forza minuscolo
	case 'p':
		return "pawn"
	case 'n':
		return "knight"
	case 'b':
		return "bishop"
	case 'r':
		return "rook"
	case 'q':
		return "queen"
	case 'k':
		return "king"
	}
	return "unknown"
}

// PieceAt restituisce il carattere del pezzo nella casella (0 se vuota).
func PieceAt(fen, square string) (byte, error) {
	row, col, err := parseSquare(square)
	if err != nil {
		return 0, err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return 0, err
	}
	return grid[row][col], nil
}

// DestroyPiece rimuove il pezzo NEMICO nella casella target e ritorna la nuova
// FEN più il nome del pezzo distrutto. Il lato al tratto e gli altri campi FEN
// restano invariati (una magia non passa il turno). Vincoli: la casella deve
// contenere un pezzo avversario e non può essere il re.
func DestroyPiece(fen, square string, caster Color) (newFEN, destroyed string, err error) {
	row, col, err := parseSquare(square)
	if err != nil {
		return "", "", err
	}
	grid, err := parsePlacement(fen)
	if err != nil {
		return "", "", err
	}

	p := grid[row][col]
	if p == 0 {
		return "", "", fmt.Errorf("nessun pezzo da distruggere in %s", square)
	}
	if pieceColor(p) == caster {
		return "", "", fmt.Errorf("non puoi distruggere un tuo pezzo (%s)", square)
	}
	if p == 'k' || p == 'K' {
		return "", "", fmt.Errorf("il re non può essere distrutto")
	}

	destroyed = pieceName(p)
	grid[row][col] = 0
	newFEN = replacePlacement(fen, encodePlacement(grid))
	// Se è stata distrutta una torre sulla sua casella d'arrocco, revoca il
	// relativo diritto d'arrocco nella FEN.
	newFEN = clearCastlingForRook(newFEN, square, p)
	return newFEN, destroyed, nil
}

// clearCastlingForRook rimuove dal campo arrocchi della FEN il diritto associato
// a una torre distrutta sulla sua casella iniziale (a1/h1/a8/h8).
func clearCastlingForRook(fen, square string, piece byte) string {
	var right byte
	switch {
	case piece == 'R' && square == "a1":
		right = 'Q'
	case piece == 'R' && square == "h1":
		right = 'K'
	case piece == 'r' && square == "a8":
		right = 'q'
	case piece == 'r' && square == "h8":
		right = 'k'
	default:
		return fen
	}

	fields := strings.Fields(fen)
	if len(fields) < 3 || fields[2] == "-" {
		return fen
	}
	newCast := strings.ReplaceAll(fields[2], string(right), "")
	if newCast == "" {
		newCast = "-"
	}
	fields[2] = newCast
	return strings.Join(fields, " ")
}
