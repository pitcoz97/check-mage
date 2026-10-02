package db

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Dati dell'account per privacy e conformità (P1–P10): termini accettati, stato
// online nascosto, cancellazione (anonimizzazione) ed esportazione. Senza DB
// (test) gli account vivono in memoria, sincronizzati con l'elenco degli utenti.

// Account è un utente con i dati che vede solo lui.
type Account struct {
	ID              int
	Username        string
	Email           string
	PasswordHash    string
	Elo             int
	CreatedAt       string
	TermsVersion    int
	TermsAcceptedAt *time.Time
	HidePresence    bool
}

// GameRecord è una partita per l'esportazione dei dati.
type GameRecord struct {
	ID          int    `json:"id"`
	White       string `json:"white"`
	Black       string `json:"black"`
	Result      string `json:"result"`
	TimeControl string `json:"time_control"`
	PGN         string `json:"pgn"`
	PlayedAt    string `json:"played_at"`
	Rated       bool   `json:"rated"`
}

// AccountStore sono le operazioni sull'account dell'utente.
type AccountStore interface {
	// Account restituisce l'account; false se non esiste o è stato cancellato.
	Account(id int) (Account, bool, error)
	AcceptTerms(id, version int) error
	SetHidePresence(id int, hide bool) error
	// HiddenPresenceIDs restituisce gli utenti che appaiono sempre offline.
	HiddenPresenceIDs() ([]int, error)
	// Games restituisce tutte le partite dell'utente, dalla più recente.
	Games(id int) ([]GameRecord, error)
	// Delete cancella mazzi, collezione, amicizie e blocchi e rende anonima la
	// riga dell'utente (le partite restano per lo storico degli avversari).
	Delete(id int) error
}

// EnsurePrivacySchema aggiunge a users le colonne di privacy e conformità.
func EnsurePrivacySchema() error {
	if DB == nil {
		return nil
	}
	for _, stmt := range []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_presence BOOLEAN NOT NULL DEFAULT FALSE`,
	} {
		if _, err := DB.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// DeletedUsername è il nome di un utente cancellato: non registrabile (# e -
// non passano la validazione), quindi non entra mai in conflitto.
func DeletedUsername(id int) string {
	return fmt.Sprintf("#eliminato-%d", id)
}

var memAccounts = &memAccountStore{accounts: map[int]*Account{}}

// Accounts restituisce lo store degli account: Postgres, o la memoria senza DB.
func Accounts() AccountStore {
	if DB == nil {
		return memAccounts
	}
	return pgAccountStore{}
}

// SetMemAccounts sostituisce gli account in memoria e l'elenco degli utenti (test).
func SetMemAccounts(accounts []Account) {
	memAccounts.mu.Lock()
	memAccounts.accounts = map[int]*Account{}
	users := make([]UserSummary, 0, len(accounts))
	for i := range accounts {
		a := accounts[i]
		memAccounts.accounts[a.ID] = &a
		users = append(users, UserSummary{ID: a.ID, Username: a.Username, Elo: a.Elo})
	}
	memAccounts.mu.Unlock()
	SetMemUsers(users)
}

// --- Postgres -------------------------------------------------------------------

type pgAccountStore struct{}

func (pgAccountStore) Account(id int) (Account, bool, error) {
	var a Account
	var accepted sql.NullTime
	err := DB.QueryRow(`
		SELECT id, username, email, password, elo, created_at, terms_version, terms_accepted_at, hide_presence
		FROM users WHERE id = $1 AND deleted_at IS NULL`, id,
	).Scan(&a.ID, &a.Username, &a.Email, &a.PasswordHash, &a.Elo, &a.CreatedAt, &a.TermsVersion, &accepted, &a.HidePresence)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, false, nil
	}
	if err != nil {
		return Account{}, false, err
	}
	if accepted.Valid {
		a.TermsAcceptedAt = &accepted.Time
	}
	return a, true, nil
}

func (pgAccountStore) AcceptTerms(id, version int) error {
	_, err := DB.Exec(`UPDATE users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id, version)
	return err
}

func (pgAccountStore) SetHidePresence(id int, hide bool) error {
	_, err := DB.Exec(`UPDATE users SET hide_presence = $2 WHERE id = $1 AND deleted_at IS NULL`, id, hide)
	return err
}

func (pgAccountStore) HiddenPresenceIDs() ([]int, error) {
	rows, err := DB.Query(`SELECT id FROM users WHERE hide_presence AND deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (pgAccountStore) Games(id int) ([]GameRecord, error) {
	rows, err := DB.Query(`
		SELECT g.id, w.username, b.username, g.result, g.time_control, g.pgn, g.played_at, g.rated
		FROM games g
		JOIN users w ON w.id = g.white_id
		JOIN users b ON b.id = g.black_id
		WHERE g.white_id = $1 OR g.black_id = $1
		ORDER BY g.played_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GameRecord{}
	for rows.Next() {
		var g GameRecord
		var pgn, timeControl, result sql.NullString
		var playedAt time.Time
		if err := rows.Scan(&g.ID, &g.White, &g.Black, &result, &timeControl, &pgn, &playedAt, &g.Rated); err != nil {
			return nil, err
		}
		g.Result, g.TimeControl, g.PGN = result.String, timeControl.String, pgn.String
		g.PlayedAt = playedAt.UTC().Format(time.RFC3339)
		out = append(out, g)
	}
	return out, rows.Err()
}

func (pgAccountStore) Delete(id int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DELETE FROM user_decks WHERE user_id = $1`,
		`DELETE FROM user_cards WHERE user_id = $1`,
		`DELETE FROM friend_links WHERE requester_id = $1 OR addressee_id = $1`,
		`DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1`,
		`DELETE FROM live_matches WHERE white_id = $1 OR black_id = $1`,
	} {
		if _, err := tx.Exec(stmt, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
		UPDATE users SET username = $2, email = $3, password = '', hide_presence = true,
		                 terms_accepted_at = NULL, deleted_at = now()
		WHERE id = $1 AND deleted_at IS NULL`,
		id, DeletedUsername(id), fmt.Sprintf("deleted-%d@deleted.invalid", id)); err != nil {
		return err
	}
	return tx.Commit()
}

// --- Memoria (test) -------------------------------------------------------------

type memAccountStore struct {
	mu       sync.Mutex
	accounts map[int]*Account
}

func (m *memAccountStore) Account(id int) (Account, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := m.accounts[id]
	if !ok {
		return Account{}, false, nil
	}
	return *a, true, nil
}

func (m *memAccountStore) AcceptTerms(id, version int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a, ok := m.accounts[id]; ok {
		now := time.Now()
		a.TermsVersion, a.TermsAcceptedAt = version, &now
	}
	return nil
}

func (m *memAccountStore) SetHidePresence(id int, hide bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a, ok := m.accounts[id]; ok {
		a.HidePresence = hide
	}
	return nil
}

func (m *memAccountStore) HiddenPresenceIDs() ([]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []int{}
	for id, a := range m.accounts {
		if a.HidePresence {
			out = append(out, id)
		}
	}
	return out, nil
}

func (m *memAccountStore) Games(int) ([]GameRecord, error) {
	return []GameRecord{}, nil // senza DB non si salvano partite
}

func (m *memAccountStore) Delete(id int) error {
	m.mu.Lock()
	delete(m.accounts, id)
	users := make([]UserSummary, 0, len(m.accounts))
	for _, a := range m.accounts {
		users = append(users, UserSummary{ID: a.ID, Username: a.Username, Elo: a.Elo})
	}
	m.mu.Unlock()
	SetMemUsers(users)

	memDecks.mu.Lock()
	delete(memDecks.byUser, id)
	memDecks.mu.Unlock()

	memFriends.mu.Lock()
	links := memFriends.links[:0:0]
	for _, l := range memFriends.links {
		if l.Requester != id && l.Addressee != id {
			links = append(links, l)
		}
	}
	memFriends.links = links
	blocks := memFriends.blocks[:0:0]
	for _, b := range memFriends.blocks {
		if b.blocker != id && b.blocked != id {
			blocks = append(blocks, b)
		}
	}
	memFriends.blocks = blocks
	memFriends.mu.Unlock()
	return nil
}
