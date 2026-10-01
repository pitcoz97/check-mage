package db

import (
	"sort"
	"sync"
	"time"
)

// Amicizie e blocchi (A1–A10). friend_links conserva richieste e amicizie: una
// riga per coppia, nella direzione della richiesta; un'amicizia è una riga
// accettata. user_blocks conserva chi ha bloccato chi. Le regole (limiti,
// richiesta incrociata, effetti del blocco) stanno in handlers/friendships.go.
// Senza DB (test) tutto vive in memoria.

// Stati di un legame.
const (
	LinkPending  = "pending"
	LinkAccepted = "accepted"
)

// FriendLink è una richiesta (pending) o un'amicizia (accepted).
type FriendLink struct {
	Requester int
	Addressee int
	Status    string
	CreatedAt time.Time
}

// Other restituisce l'altro utente del legame.
func (l FriendLink) Other(userID int) int {
	if l.Requester == userID {
		return l.Addressee
	}
	return l.Requester
}

// FriendStore sono le operazioni su amicizie e blocchi.
type FriendStore interface {
	// Links restituisce i legami in cui compare l'utente, dal più vecchio.
	Links(userID int) ([]FriendLink, error)
	// Link restituisce il legame fra a e b, in una delle due direzioni.
	Link(a, b int) (FriendLink, bool, error)
	// Request crea la richiesta from → to.
	Request(from, to int) error
	// Accept rende amicizia la richiesta requester → addressee.
	Accept(requester, addressee int) (bool, error)
	// DeleteLink toglie il legame fra a e b, in una delle due direzioni.
	DeleteLink(a, b int) (bool, error)
	// Blocks restituisce gli utenti bloccati da userID, dal più recente.
	Blocks(userID int) ([]int, error)
	// BlockedBy restituisce gli utenti che hanno bloccato userID.
	BlockedBy(userID int) ([]int, error)
	// Block registra il blocco e toglie il legame fra i due.
	Block(blocker, blocked int) error
	// Unblock toglie il blocco.
	Unblock(blocker, blocked int) (bool, error)
}

// EnsureFriendSchema crea le tabelle friend_links e user_blocks se non esistono.
func EnsureFriendSchema() error {
	if DB == nil {
		return nil
	}
	for _, stmt := range []string{
		`CREATE TABLE IF NOT EXISTS friend_links (
			requester_id INTEGER NOT NULL REFERENCES users(id),
			addressee_id INTEGER NOT NULL REFERENCES users(id),
			status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
			created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (requester_id, addressee_id)
		)`,
		`CREATE INDEX IF NOT EXISTS friend_links_addressee ON friend_links (addressee_id)`,
		`CREATE TABLE IF NOT EXISTS user_blocks (
			blocker_id INTEGER NOT NULL REFERENCES users(id),
			blocked_id INTEGER NOT NULL REFERENCES users(id),
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (blocker_id, blocked_id)
		)`,
		`CREATE INDEX IF NOT EXISTS user_blocks_blocked ON user_blocks (blocked_id)`,
	} {
		if _, err := DB.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

var memFriends = &memFriendStore{}

// Friends restituisce lo store delle amicizie: Postgres, o la memoria senza DB.
func Friends() FriendStore {
	if DB == nil {
		return memFriends
	}
	return pgFriendStore{}
}

// ResetMemFriends svuota amicizie e blocchi in memoria (test).
func ResetMemFriends() {
	memFriends.mu.Lock()
	defer memFriends.mu.Unlock()
	memFriends.links = nil
	memFriends.blocks = nil
}

// --- Postgres -------------------------------------------------------------------

type pgFriendStore struct{}

func (pgFriendStore) Links(userID int) ([]FriendLink, error) {
	rows, err := DB.Query(`
		SELECT requester_id, addressee_id, status, created_at FROM friend_links
		WHERE requester_id = $1 OR addressee_id = $1
		ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FriendLink{}
	for rows.Next() {
		var l FriendLink
		if err := rows.Scan(&l.Requester, &l.Addressee, &l.Status, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (pgFriendStore) Link(a, b int) (FriendLink, bool, error) {
	var l FriendLink
	err := DB.QueryRow(`
		SELECT requester_id, addressee_id, status, created_at FROM friend_links
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`, a, b,
	).Scan(&l.Requester, &l.Addressee, &l.Status, &l.CreatedAt)
	if isNoRows(err) {
		return FriendLink{}, false, nil
	}
	if err != nil {
		return FriendLink{}, false, err
	}
	return l, true, nil
}

func (pgFriendStore) Request(from, to int) error {
	_, err := DB.Exec(`
		INSERT INTO friend_links (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')
		ON CONFLICT (requester_id, addressee_id) DO NOTHING`, from, to)
	return err
}

func (pgFriendStore) Accept(requester, addressee int) (bool, error) {
	res, err := DB.Exec(`
		UPDATE friend_links SET status = 'accepted'
		WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, requester, addressee)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (pgFriendStore) DeleteLink(a, b int) (bool, error) {
	res, err := DB.Exec(`
		DELETE FROM friend_links
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`, a, b)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func queryIDs(query string, userID int) ([]int, error) {
	rows, err := DB.Query(query, userID)
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

func (pgFriendStore) Blocks(userID int) ([]int, error) {
	return queryIDs(`SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC`, userID)
}

func (pgFriendStore) BlockedBy(userID int) ([]int, error) {
	return queryIDs(`SELECT blocker_id FROM user_blocks WHERE blocked_id = $1`, userID)
}

func (pgFriendStore) Block(blocker, blocked int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		DELETE FROM friend_links
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`, blocker, blocked); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
		ON CONFLICT (blocker_id, blocked_id) DO NOTHING`, blocker, blocked); err != nil {
		return err
	}
	return tx.Commit()
}

func (pgFriendStore) Unblock(blocker, blocked int) (bool, error) {
	res, err := DB.Exec(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, blocker, blocked)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// --- Memoria (test, sviluppo senza DB) ------------------------------------------

type memBlock struct {
	blocker, blocked int
	at               time.Time
}

type memFriendStore struct {
	mu     sync.Mutex
	links  []FriendLink
	blocks []memBlock
	clock  int64 // ordine di inserimento, perché due righe nello stesso istante restino ordinate
}

func (m *memFriendStore) now() time.Time {
	m.clock++
	return time.Unix(0, m.clock)
}

func (m *memFriendStore) find(a, b int) int {
	for i, l := range m.links {
		if (l.Requester == a && l.Addressee == b) || (l.Requester == b && l.Addressee == a) {
			return i
		}
	}
	return -1
}

func (m *memFriendStore) Links(userID int) ([]FriendLink, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []FriendLink{}
	for _, l := range m.links {
		if l.Requester == userID || l.Addressee == userID {
			out = append(out, l)
		}
	}
	return out, nil
}

func (m *memFriendStore) Link(a, b int) (FriendLink, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if i := m.find(a, b); i >= 0 {
		return m.links[i], true, nil
	}
	return FriendLink{}, false, nil
}

func (m *memFriendStore) Request(from, to int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, l := range m.links {
		if l.Requester == from && l.Addressee == to {
			return nil
		}
	}
	m.links = append(m.links, FriendLink{Requester: from, Addressee: to, Status: LinkPending, CreatedAt: m.now()})
	return nil
}

func (m *memFriendStore) Accept(requester, addressee int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, l := range m.links {
		if l.Requester == requester && l.Addressee == addressee && l.Status == LinkPending {
			m.links[i].Status = LinkAccepted
			return true, nil
		}
	}
	return false, nil
}

func (m *memFriendStore) DeleteLink(a, b int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.find(a, b)
	if i < 0 {
		return false, nil
	}
	m.links = append(m.links[:i:i], m.links[i+1:]...)
	return true, nil
}

func (m *memFriendStore) Blocks(userID int) ([]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rows := []memBlock{}
	for _, b := range m.blocks {
		if b.blocker == userID {
			rows = append(rows, b)
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].at.After(rows[j].at) })
	out := make([]int, 0, len(rows))
	for _, b := range rows {
		out = append(out, b.blocked)
	}
	return out, nil
}

func (m *memFriendStore) BlockedBy(userID int) ([]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []int{}
	for _, b := range m.blocks {
		if b.blocked == userID {
			out = append(out, b.blocker)
		}
	}
	return out, nil
}

func (m *memFriendStore) Block(blocker, blocked int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if i := m.find(blocker, blocked); i >= 0 {
		m.links = append(m.links[:i:i], m.links[i+1:]...)
	}
	for _, b := range m.blocks {
		if b.blocker == blocker && b.blocked == blocked {
			return nil
		}
	}
	m.blocks = append(m.blocks, memBlock{blocker: blocker, blocked: blocked, at: m.now()})
	return nil
}

func (m *memFriendStore) Unblock(blocker, blocked int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, b := range m.blocks {
		if b.blocker == blocker && b.blocked == blocked {
			m.blocks = append(m.blocks[:i:i], m.blocks[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}
