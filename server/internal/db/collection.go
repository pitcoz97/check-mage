package db

// user_cards conserva la collezione di ogni utente: quante copie possiede di
// ogni magia. Il set iniziale arriva alla prima lettura (C5), così vale anche
// per gli utenti registrati prima della collezione.

// EnsureCollectionSchema crea la tabella user_cards se non esiste.
func EnsureCollectionSchema() error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_cards (
			user_id  INTEGER NOT NULL REFERENCES users(id),
			spell_id TEXT NOT NULL,
			copies   INTEGER NOT NULL CHECK (copies >= 0),
			PRIMARY KEY (user_id, spell_id)
		)`)
	return err
}

// LoadCollection restituisce le copie possedute dall'utente per id di magia.
// Se l'utente non ha ancora righe gli assegna prima lo starter, nella stessa
// transazione (idempotente: due richieste concorrenti non raddoppiano nulla).
// Senza DB (test) restituisce lo starter.
func LoadCollection(userID int, starter map[string]int) (map[string]int, error) {
	if DB == nil {
		out := make(map[string]int, len(starter))
		for id, n := range starter {
			out[id] = n
		}
		return out, nil
	}
	tx, err := DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var rows int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM user_cards WHERE user_id = $1`, userID).Scan(&rows); err != nil {
		return nil, err
	}
	if rows == 0 {
		for id, n := range starter {
			if _, err := tx.Exec(`
				INSERT INTO user_cards (user_id, spell_id, copies)
				VALUES ($1, $2, $3)
				ON CONFLICT (user_id, spell_id) DO NOTHING`,
				userID, id, n,
			); err != nil {
				return nil, err
			}
		}
	}

	result, err := tx.Query(`SELECT spell_id, copies FROM user_cards WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	owned := map[string]int{}
	for result.Next() {
		var id string
		var copies int
		if err := result.Scan(&id, &copies); err != nil {
			return nil, err
		}
		owned[id] = copies
	}
	if err := result.Err(); err != nil {
		return nil, err
	}
	result.Close()
	return owned, tx.Commit()
}
