package db

import (
	"chess-server/internal/config"
	"chess-server/internal/logger"
	"database/sql"
	"fmt"
	"math"

	_ "github.com/lib/pq" // driver postgres, importato per i side effect
	"go.uber.org/zap"
)

// DB è la connessione globale al database
// In C++ sarebbe un singleton
var DB *sql.DB

func Connect() {
	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		config.C.DBHost,
		config.C.DBPort,
		config.C.DBUser,
		config.C.DBPassword,
		config.C.DBName,
	)

	var err error
	DB, err = sql.Open("postgres", connStr)
	if err != nil {
		logger.L.Fatal("Errore apertura DB", zap.Error(err))
	}

	if err = DB.Ping(); err != nil {
		logger.L.Fatal("Errore connessione DB", zap.Error(err))
	}

	// Pool di connessioni
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)

	logger.L.Info("Connesso al database",
		zap.String("host", config.C.DBHost),
		zap.String("db", config.C.DBName),
	)
}

// SaveGame salva una partita nel database e aggiorna gli ELO
func SaveGame(whiteID, blackID int, pgn, result, timeControl string) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Salva la partita
	_, err = tx.Exec(`
        INSERT INTO games (white_id, black_id, pgn, result, time_control)
        VALUES ($1, $2, $3, $4, $5)`,
		whiteID, blackID, pgn, result, timeControl,
	)
	if err != nil {
		return err
	}

	// Prendi gli ELO attuali
	var whiteElo, blackElo int
	tx.QueryRow(`SELECT elo FROM users WHERE id = $1`, whiteID).Scan(&whiteElo)
	tx.QueryRow(`SELECT elo FROM users WHERE id = $1`, blackID).Scan(&blackElo)

	// Calcola i nuovi ELO
	newWhiteElo, newBlackElo := calculateElo(whiteElo, blackElo, result)

	// Aggiorna gli ELO
	_, err = tx.Exec(`UPDATE users SET elo = $1 WHERE id = $2`, newWhiteElo, whiteID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE users SET elo = $1 WHERE id = $2`, newBlackElo, blackID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// calculateElo implementa l'algoritmo ELO standard FIDE
func calculateElo(whiteElo, blackElo int, result string) (int, int) {
	// K-factor: quanto velocemente cambia l'ELO
	// 32 per giocatori nuovi, 16 per esperti — usiamo 32 per ora
	const K = 32

	// Probabilità attesa di vittoria per il bianco
	// Formula standard ELO
	expectedWhite := 1.0 / (1.0 + math.Pow(10, float64(blackElo-whiteElo)/400.0))
	expectedBlack := 1.0 - expectedWhite

	// Score effettivo
	var scoreWhite, scoreBlack float64
	switch result {
	case "1-0": // vince bianco
		scoreWhite, scoreBlack = 1.0, 0.0
	case "0-1": // vince nero
		scoreWhite, scoreBlack = 0.0, 1.0
	default: // patta
		scoreWhite, scoreBlack = 0.5, 0.5
	}

	// Nuovi ELO
	newWhite := whiteElo + int(math.Round(K*(scoreWhite-expectedWhite)))
	newBlack := blackElo + int(math.Round(K*(scoreBlack-expectedBlack)))

	return newWhite, newBlack
}
