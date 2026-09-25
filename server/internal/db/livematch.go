package db

import "chess-server/internal/logger"

// live_matches conserva lo stato serializzato (JSONB) delle partite in corso,
// così un riavvio del server non le perde: allo startup vengono ricaricate e i
// giocatori possono riconnettersi. Lo stato completo (board, fasi, mana, mani,
// mazzi, effetti persistenti) è un blob JSON gestito dal package game.

// LiveMatchRow è una riga di live_matches (solo i campi utili al ripristino).
type LiveMatchRow struct {
	RoomID string
	State  []byte
}

// EnsureLiveMatchSchema crea la tabella live_matches se non esiste.
func EnsureLiveMatchSchema() error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS live_matches (
			room_id    TEXT PRIMARY KEY,
			white_id   INTEGER NOT NULL,
			black_id   INTEGER NOT NULL,
			state      JSONB NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`)
	return err
}

// SaveLiveMatch inserisce/aggiorna lo stato serializzato di una partita in corso.
func SaveLiveMatch(roomID string, whiteID, blackID int, state []byte) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`
		INSERT INTO live_matches (room_id, white_id, black_id, state, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (room_id)
		DO UPDATE SET white_id = EXCLUDED.white_id,
		              black_id = EXCLUDED.black_id,
		              state = EXCLUDED.state,
		              updated_at = now()`,
		roomID, whiteID, blackID, string(state),
	)
	return err
}

// DeleteLiveMatch rimuove una partita conclusa da live_matches.
func DeleteLiveMatch(roomID string) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`DELETE FROM live_matches WHERE room_id = $1`, roomID)
	return err
}

// LoadLiveMatches carica tutte le partite in corso salvate.
func LoadLiveMatches() ([]LiveMatchRow, error) {
	if DB == nil {
		return nil, nil
	}
	rows, err := DB.Query(`SELECT room_id, state FROM live_matches`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveMatchRow
	for rows.Next() {
		var r LiveMatchRow
		if err := rows.Scan(&r.RoomID, &r.State); err != nil {
			logger.L.Warn("Riga live_matches non leggibile")
			continue
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
