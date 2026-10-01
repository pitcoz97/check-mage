package db

import (
	"database/sql"
	"errors"
	"sort"
	"strings"
	"sync"

	"github.com/lib/pq"
)

// L'elenco degli utenti per amici, ricerca e sfide (F1, A5): solo id, nome ed
// ELO. Senza DB (test) gli utenti vivono in memoria.

// UserSummary è l'identità pubblica di un utente.
type UserSummary struct {
	ID       int
	Username string
	Elo      int
}

// UserDirectory legge gli utenti.
type UserDirectory interface {
	// ListUsers restituisce al più limit utenti tranne quelli in exclude: prima
	// quelli in first (gli attivi, così il limite non li taglia), poi per nome.
	ListUsers(exclude, first []int, limit int) ([]UserSummary, error)
	// User restituisce un utente; false se non esiste.
	User(id int) (UserSummary, bool, error)
	// UsersByIDs restituisce gli utenti esistenti fra ids, in un ordine qualsiasi.
	UsersByIDs(ids []int) ([]UserSummary, error)
	// Search cerca i nomi che contengono q (maiuscole indifferenti), tranne
	// exclude: prima chi inizia con q, poi per nome; al più limit.
	Search(q string, exclude []int, limit int) ([]UserSummary, error)
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

func nonNil(ids []int) []int {
	if ids == nil {
		return []int{}
	}
	return ids
}

// --- Postgres -------------------------------------------------------------------

type pgUserDirectory struct{}

func scanUsers(rows *sql.Rows, err error) ([]UserSummary, error) {
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

func (pgUserDirectory) ListUsers(exclude, first []int, limit int) ([]UserSummary, error) {
	return scanUsers(DB.Query(`
		SELECT id, username, elo FROM users
		WHERE NOT (id = ANY($1))
		ORDER BY (id = ANY($2)) DESC, lower(username), id
		LIMIT $3`, pq.Array(nonNil(exclude)), pq.Array(nonNil(first)), limit))
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

func (pgUserDirectory) UsersByIDs(ids []int) ([]UserSummary, error) {
	if len(ids) == 0 {
		return []UserSummary{}, nil
	}
	return scanUsers(DB.Query(`SELECT id, username, elo FROM users WHERE id = ANY($1)`, pq.Array(ids)))
}

func (pgUserDirectory) Search(q string, exclude []int, limit int) ([]UserSummary, error) {
	// strpos e starts_with invece di LIKE: niente caratteri jolly da proteggere (l'underscore è nei nomi).
	return scanUsers(DB.Query(`
		SELECT id, username, elo FROM users
		WHERE strpos(lower(username), lower($1)) > 0 AND NOT (id = ANY($2))
		ORDER BY starts_with(lower(username), lower($1)) DESC, lower(username), id
		LIMIT $3`, q, pq.Array(nonNil(exclude)), limit))
}

// --- Memoria (test) -------------------------------------------------------------

type memUserDirectory struct {
	mu    sync.Mutex
	users []UserSummary
}

func idSet(ids []int) map[int]bool {
	out := make(map[int]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func byName(a, b UserSummary) bool {
	x, y := strings.ToLower(a.Username), strings.ToLower(b.Username)
	if x != y {
		return x < y
	}
	return a.ID < b.ID
}

func (m *memUserDirectory) ListUsers(exclude, first []int, limit int) ([]UserSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	skip, active := idSet(exclude), idSet(first)
	out := []UserSummary{}
	for _, u := range m.users {
		if !skip[u.ID] {
			out = append(out, u)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if active[out[i].ID] != active[out[j].ID] {
			return active[out[i].ID]
		}
		return byName(out[i], out[j])
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

func (m *memUserDirectory) UsersByIDs(ids []int) ([]UserSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := idSet(ids)
	out := []UserSummary{}
	for _, u := range m.users {
		if want[u.ID] {
			out = append(out, u)
		}
	}
	return out, nil
}

func (m *memUserDirectory) Search(q string, exclude []int, limit int) ([]UserSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	needle := strings.ToLower(q)
	skip := idSet(exclude)
	out := []UserSummary{}
	for _, u := range m.users {
		if !skip[u.ID] && strings.Contains(strings.ToLower(u.Username), needle) {
			out = append(out, u)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		pi := strings.HasPrefix(strings.ToLower(out[i].Username), needle)
		pj := strings.HasPrefix(strings.ToLower(out[j].Username), needle)
		if pi != pj {
			return pi
		}
		return byName(out[i], out[j])
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
