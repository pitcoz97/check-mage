package db

import (
	"database/sql"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/lib/pq"
)

// L'elenco degli utenti per amici e sfide (F1): solo id, nome ed ELO. Senza DB
// (test) gli utenti vivono in memoria.

// UserSummary è l'identità pubblica di un utente.
type UserSummary struct {
	ID       int
	Username string
	Elo      int
}

// UserDirectory legge gli utenti.
type UserDirectory interface {
	// ListUsers restituisce al più limit utenti tranne exclude: prima quelli in
	// first (gli attivi, così il limite non li taglia), poi per nome.
	ListUsers(exclude int, first []int, limit int) ([]UserSummary, error)
	// User restituisce un utente; false se non esiste.
	User(id int) (UserSummary, bool, error)
}

var memUsers = &memUserDirectory{}

// Users restituisce l'elenco degli utenti: Postgres, o la memoria senza DB.
func Users() UserDirectory {
	if DB == nil {
		return memUsers
	}
	return pgUserDirectory{}
}

// SetMemUsers sostituisce gli utenti in memoria (test).
func SetMemUsers(users []UserSummary) {
	memUsers.mu.Lock()
	defer memUsers.mu.Unlock()
	memUsers.users = append([]UserSummary{}, users...)
}

// --- Postgres -------------------------------------------------------------------

type pgUserDirectory struct{}

func (pgUserDirectory) ListUsers(exclude int, first []int, limit int) ([]UserSummary, error) {
	if first == nil {
		first = []int{}
	}
	rows, err := DB.Query(`
		SELECT id, username, elo FROM users
		WHERE id <> $1
		ORDER BY (id = ANY($2)) DESC, lower(username), id
		LIMIT $3`, exclude, pq.Array(first), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserSummary{}
	for rows.Next() {
		var u UserSummary
		if err := rows.Scan(&u.ID, &u.Username, &u.Elo); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (pgUserDirectory) User(id int) (UserSummary, bool, error) {
	var u UserSummary
	err := DB.QueryRow(`SELECT id, username, elo FROM users WHERE id = $1`, id).Scan(&u.ID, &u.Username, &u.Elo)
	if errors.Is(err, sql.ErrNoRows) {
		return UserSummary{}, false, nil
	}
	if err != nil {
		return UserSummary{}, false, err
	}
	return u, true, nil
}

// --- Memoria (test) -------------------------------------------------------------

type memUserDirectory struct {
	mu    sync.Mutex
	users []UserSummary
}

func (m *memUserDirectory) ListUsers(exclude int, first []int, limit int) ([]UserSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	active := make(map[int]bool, len(first))
	for _, id := range first {
		active[id] = true
	}
	out := []UserSummary{}
	for _, u := range m.users {
		if u.ID != exclude {
			out = append(out, u)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if active[out[i].ID] != active[out[j].ID] {
			return active[out[i].ID]
		}
		a, b := strings.ToLower(out[i].Username), strings.ToLower(out[j].Username)
		if a != b {
			return a < b
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memUserDirectory) User(id int) (UserSummary, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.ID == id {
			return u, true, nil
		}
	}
	return UserSummary{}, false, nil
}
