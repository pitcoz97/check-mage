package engine

import (
	"bufio"
	"chess-server/internal/logger"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"go.uber.org/zap"
)

// Engine rappresenta un processo Stockfish attivo
type Engine struct {
	cmd    *exec.Cmd
	stdin  *bufio.Writer
	stdout *bufio.Scanner
	mu     sync.Mutex // una richiesta alla volta
}

var SF *Engine

// StartingFEN è la posizione iniziale standard degli scacchi.
const StartingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// positionFromFEN costruisce il comando UCI "position" a partire da una FEN
// arbitraria, opzionalmente seguita da mosse. Tutto l'engine è FEN-based: la
// FEN è la fonte di verità (così le magie che editano la board sono
// rappresentabili, cosa impossibile con una sola move-list da startpos).
func positionFromFEN(fen string, moves ...string) string {
	pos := "position fen " + fen
	if len(moves) > 0 {
		pos += " moves " + strings.Join(moves, " ")
	}
	return pos
}

func Init() error {
	SF = &Engine{}
	return initEngine(SF)
}

func initEngine(e *Engine) error {
	cmd := exec.Command("stockfish")

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("errore stdin: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("errore stdout: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("errore avvio stockfish: %w", err)
	}

	e.cmd = cmd
	e.stdin = bufio.NewWriter(stdinPipe)
	e.stdout = bufio.NewScanner(stdoutPipe)

	e.send("uci")
	e.waitFor("uciok")
	e.send("isready")
	e.waitFor("readyok")

	logger.L.Info("Stockfish pronto")
	return nil
}

// send manda un comando a Stockfish
func (e *Engine) send(cmd string) {
	fmt.Fprintln(e.stdin, cmd)
	e.stdin.Flush()
}

// waitFor legge l'output finché non trova una riga specifica
func (e *Engine) waitFor(token string) {
	for e.stdout.Scan() {
		if strings.Contains(e.stdout.Text(), token) {
			return
		}
	}
}

// readUntil legge tutte le righe finché non trova il token e le ritorna
func (e *Engine) readUntil(token string) []string {
	var lines []string
	for e.stdout.Scan() {
		line := e.stdout.Text()
		lines = append(lines, line)
		if strings.Contains(line, token) {
			return lines
		}
	}
	return lines
}

func (e *Engine) IsMoveLegal(fen, newMove string) bool {
	result, err := e.safeCall(func() interface{} {
		return e.IsMoveLegalInternal(fen, newMove)
	})
	if err != nil {
		logger.L.Error("IsMoveLegal fallito", zap.Error(err))
		return false
	}
	return result.(bool)
}

// IsMoveLegalInternal verifica se una mossa UCI (es. "e2e4") è legale nella
// posizione data dalla FEN.
func (e *Engine) IsMoveLegalInternal(fen, newMove string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.send(positionFromFEN(fen))

	// Elenca le mosse legali della posizione: se newMove è tra queste è legale.
	e.send("go perft 1")
	lines := e.readUntil("Nodes searched")

	// Se Stockfish risponde con "Nodes searched: 0" la mossa era illegale
	for _, line := range lines {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			candidate := strings.TrimSpace(parts[0])
			if candidate == newMove {
				return true
			}
		}
	}
	return false
}

// BestMove ritorna la mossa migliore nella posizione data dalla FEN.
// depth = profondità di analisi (1-20, più alto = più forte ma più lento)
func (e *Engine) BestMove(fen string, depth int) string {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.send(positionFromFEN(fen))

	e.send(fmt.Sprintf("go depth %d", depth))
	lines := e.readUntil("bestmove")

	// L'ultima riga è "bestmove e2e4 ponder e7e5"
	for _, line := range lines {
		if strings.HasPrefix(line, "bestmove") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}

// Shutdown chiude il processo Stockfish
func (e *Engine) Shutdown() {
	e.send("quit")
	e.cmd.Wait()
}

// GameStatus rappresenta lo stato della partita
type GameStatus int

const (
	StatusOngoing   GameStatus = iota // partita in corso
	StatusCheckmate                   // scacco matto
	StatusStalemate                   // stallo
	StatusDraw                        // patta per altre ragioni
)

// GetGameStatus controlla se la partita è finita nella posizione data dalla FEN
func (e *Engine) GetGameStatus(fen string) GameStatus {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.send(positionFromFEN(fen))

	// Conta le mosse legali disponibili
	e.send("go perft 1")
	lines := e.readUntil("Nodes searched")

	// Conta le mosse legali e i nodi totali
	legalMoves := 0
	totalNodes := 0
	for _, line := range lines {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			candidate := strings.TrimSpace(parts[0])
			if candidate != "" && !strings.HasPrefix(candidate, "Nodes") {
				legalMoves++
				var count int
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &count)
				totalNodes += count
			}
		}
		if strings.HasPrefix(line, "Nodes searched") {
			fmt.Sscanf(line, "Nodes searched: %d", &totalNodes)
		}
	}

	// Nessuna mossa legale = scacco matto o stallo
	if legalMoves == 0 {
		// Verifica se il re è sotto scacco
		if e.isInCheck(fen) {
			return StatusCheckmate
		}
		return StatusStalemate
	}

	// Controlla patta per insufficienza materiale o regola delle 50 mosse
	if e.isDraw(fen) {
		return StatusDraw
	}

	return StatusOngoing
}

// isInCheck verifica se il giocatore di turno è sotto scacco
// Lo fa tentando di trovare una mossa che cattura il re avversario
func (e *Engine) isInCheck(fen string) bool {
	e.send(positionFromFEN(fen))
	e.send("go depth 1")
	lines := e.readUntil("bestmove")

	for _, line := range lines {
		// Se Stockfish trova "score mate 1" siamo sotto scacco matto
		// Se trova "score cp" molto alto potremmo essere sotto scacco
		if strings.Contains(line, "score mate") {
			return true
		}
	}
	return false
}

// isDraw verifica condizioni di patta
func (e *Engine) isDraw(fen string) bool {
	e.send(positionFromFEN(fen))
	e.send("go depth 1")
	lines := e.readUntil("bestmove")

	for _, line := range lines {
		if strings.Contains(line, "score cp 0") {
			return true
		}
	}
	return false
}

// ApplyMove applica una mossa UCI (es. "e2e4") alla FEN data e ritorna la FEN
// risultante. La mossa va validata prima con IsMoveLegal.
func (e *Engine) ApplyMove(fen, move string) string {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.send(positionFromFEN(fen, move))

	// "d" è il comando UCI che mostra lo stato della board, FEN inclusa.
	e.send("d")
	lines := e.readUntil("Checkers")

	for _, line := range lines {
		if strings.HasPrefix(line, "Fen:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Fen: "))
		}
	}

	// In caso di problemi, ritorna la FEN invariata.
	return fen
}

// Restart riavvia Stockfish se crasha
func (e *Engine) Restart() error {
	logger.L.Warn("Riavvio Stockfish in corso...")

	e.mu.Lock()
	defer e.mu.Unlock()

	// Prova a chiudere il vecchio processo
	if e.cmd != nil && e.cmd.Process != nil {
		e.cmd.Process.Kill()
		e.cmd.Wait()
	}

	// Riavvia
	if err := initEngine(e); err != nil {
		return err
	}

	logger.L.Info("Stockfish riavviato!")
	return nil
}

// safeCall esegue una funzione con recovery da panic
// Se Stockfish crasha, prova a riavviarlo
func (e *Engine) safeCall(fn func() interface{}) (result interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			logger.L.Error("Stockfish panic, tentativo di riavvio",
				zap.Any("error", r),
			)
			if restartErr := e.Restart(); restartErr != nil {
				err = fmt.Errorf("stockfish crash e riavvio fallito: %v", restartErr)
			}
		}
	}()

	result = fn()
	return result, nil
}
