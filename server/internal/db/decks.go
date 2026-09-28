package db

import (
	"chess-server/internal/spells"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"
)

// user_decks conserva i mazzi personali. Qui ci sono solo le operazioni di
// base; le regole (limiti, mazzo iniziale, mazzo attivo) stanno in
// handlers/decks.go. Senza DB (test) i mazzi vivono in memoria.

// DeckRow è un mazzo salvato.
type DeckRow struct {
	ID        int
	Name      string
	Cards     spells.DeckCards
	Active    bool
	UpdatedAt time.Time
}

// DeckStore sono le operazioni sui mazzi di un utente.
type DeckStore interface {
	List(userID int) ([]DeckRow, error)
	Insert(userID int, name string, cards spells.DeckCards, active bool) (DeckRow, error)
	Update(userID, id int, name string, cards spells.DeckCards) (DeckRow, bool, error)
	Delete(userID, id int) (bool, error)
	// SetActive rende attivo il mazzo id e disattiva gli altri.
	SetActive(userID, id int) (bool, error)
}

// EnsureDeckSchema crea la tabella user_decks se non esiste. Al più un mazzo
// attivo per utente (indice unico parziale).
func EnsureDeckSchema() error {
	if DB == nil {
		return nil
	}
	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS user_decks (
			id         SERIAL PRIMARY KEY,
			user_id    INTEGER NOT NULL REFERENCES users(id),
			name       TEXT NOT NULL,
			cards      JSONB NOT NULL,
			active     BOOLEAN NOT NULL DEFAULT false,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return err
	}
	_, err := DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS user_decks_one_active ON user_decks (user_id) WHERE active`)
	return err
}

var memDecks = &memDeckStore{byUser: map[int][]DeckRow{}}

// Decks restituisce lo store dei mazzi: Postgres, o la memoria senza DB.
func Decks() DeckStore {
	if DB == nil {
		return memDecks
	}
	return pgDeckStore{}
}

// ResetMemDecks svuota i mazzi in memoria (test).
func ResetMemDecks() {
	memDecks.mu.Lock()
	defer memDecks.mu.Unlock()
	memDecks.byUser = map[int][]DeckRow{}
	memDecks.nextID = 0
}

// --- Postgres -------------------------------------------------------------------

type pgDeckStore struct{}

func scanDeck(scan func(dest ...interface{}) error) (DeckRow, error) {
	var row DeckRow
	var raw []byte
	if err := scan(&row.ID, &row.Name, &raw, &row.Active, &row.UpdatedAt); err != nil {
		return DeckRow{}, err
	}
	row.Cards = spells.DeckCards{}
	if err := json.Unmarshal(raw, &row.Cards); err != nil {
		return DeckRow{}, err
	}
	return row, nil
}

func (pgDeckStore) List(userID int) ([]DeckRow, error) {
	rows, err := DB.Query(`
		SELECT id, name, cards, active, updated_at FROM user_decks
		WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeckRow{}
	for rows.Next() {
		row, err := scanDeck(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (pgDeckStore) Insert(userID int, name string, cards spells.DeckCards, active bool) (DeckRow, error) {
	raw, err := json.Marshal(cards)
	if err != nil {
		return DeckRow{}, err
	}
	tx, err := DB.Begin()
	if err != nil {
		return DeckRow{}, err
	}
	defer tx.Rollback()
	if active {
		if _, err := tx.Exec(`UPDATE user_decks SET active = false WHERE user_id = $1 AND active`, userID); err != nil {
			return DeckRow{}, err
		}
	}
	row, err := scanDeck(tx.QueryRow(`
		INSERT INTO user_decks (user_id, name, cards, active) VALUES ($1, $2, $3, $4)
		RETURNING id, name, cards, active, updated_at`, userID, name, string(raw), active).Scan)
	if err != nil {
		return DeckRow{}, err
	}
	return row, tx.Commit()
}

func (pgDeckStore) Update(userID, id int, name string, cards spells.DeckCards) (DeckRow, bool, error) {
	raw, err := json.Marshal(cards)
	if err != nil {
		return DeckRow{}, false, err
	}
	row, err := scanDeck(DB.QueryRow(`
		UPDATE user_decks SET name = $3, cards = $4, updated_at = now()
		WHERE user_id = $1 AND id = $2
		RETURNING id, name, cards, active, updated_at`, userID, id, name, string(raw)).Scan)
	if err != nil {
		if isNoRows(err) {
			return DeckRow{}, false, nil
		}
		return DeckRow{}, false, err
	}
	return row, true, nil
}

func (pgDeckStore) Delete(userID, id int) (bool, error) {
	res, err := DB.Exec(`DELETE FROM user_decks WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (pgDeckStore) SetActive(userID, id int) (bool, error) {
	tx, err := DB.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM user_decks WHERE user_id = $1 AND id = $2)`, userID, id).Scan(&exists); err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	if _, err := tx.Exec(`UPDATE user_decks SET active = false WHERE user_id = $1 AND active AND id <> $2`, userID, id); err != nil {
		return false, err
	}
	if _, err := tx.Exec(`UPDATE user_decks SET active = true WHERE user_id = $1 AND id = $2`, userID, id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func isNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }

// --- Memoria (test, sviluppo senza DB) ------------------------------------------

type memDeckStore struct {
	mu     sync.Mutex
	byUser map[int][]DeckRow
	nextID int
}

func copyDeck(row DeckRow) DeckRow {
	cards := spells.DeckCards{}
	for id, n := range row.Cards {
		cards[id] = n
	}
	row.Cards = cards
	return row
}

func (m *memDeckStore) List(userID int) ([]DeckRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]DeckRow, 0, len(m.byUser[userID]))
	for _, row := range m.byUser[userID] {
		out = append(out, copyDeck(row))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (m *memDeckStore) Insert(userID int, name string, cards spells.DeckCards, active bool) (DeckRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if active {
		for i := range m.byUser[userID] {
			m.byUser[userID][i].Active = false
		}
	}
	m.nextID++
	row := copyDeck(DeckRow{ID: m.nextID, Name: name, Cards: cards, Active: active, UpdatedAt: time.Now()})
	m.byUser[userID] = append(m.byUser[userID], row)
	return copyDeck(row), nil
}

func (m *memDeckStore) Update(userID, id int, name string, cards spells.DeckCards) (DeckRow, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, row := range m.byUser[userID] {
		if row.ID == id {
			row.Name, row.Cards, row.UpdatedAt = name, cards, time.Now()
			m.byUser[userID][i] = copyDeck(row)
			return copyDeck(row), true, nil
		}
	}
	return DeckRow{}, false, nil
}

func (m *memDeckStore) Delete(userID, id int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rows := m.byUser[userID]
	for i, row := range rows {
		if row.ID == id {
			m.byUser[userID] = append(rows[:i:i], rows[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

func (m *memDeckStore) SetActive(userID, id int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, row := range m.byUser[userID] {
		if row.ID == id {
			found = true
		}
	}
	if !found {
		return false, nil
	}
	for i := range m.byUser[userID] {
		m.byUser[userID][i].Active = m.byUser[userID][i].ID == id
	}
	return true, nil
}
