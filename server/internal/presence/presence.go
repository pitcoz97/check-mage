package presence

import (
	"sync"
	"time"
)

// Presenza degli utenti (F2): è online chi ha mandato un segnale negli ultimi
// Window, con POST /me/presence (il client lo manda ogni ~5 s mentre l'app è
// aperta) o aprendo il WebSocket. Solo memoria: dopo un riavvio del server
// tutti risultano offline fino al segnale successivo.

// Window è il tempo dopo l'ultimo segnale in cui un utente resta online.
const Window = 30 * time.Second

// Tracker ricorda l'ultimo segnale di ogni utente.
type Tracker struct {
	mu        sync.Mutex
	seen      map[int]time.Time
	now       func() time.Time
	lastPrune time.Time
}

// New crea un tracker con l'orologio dato (time.Now, o uno finto nei test).
func New(now func() time.Time) *Tracker {
	return &Tracker{seen: map[int]time.Time{}, now: now}
}

// Default è il tracker del server.
var Default = New(time.Now)

// Touch registra un segnale dell'utente.
func (t *Tracker) Touch(userID int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	t.seen[userID] = now
	// Ogni tanto si tolgono le voci scadute, così la mappa non cresce per sempre.
	if now.Sub(t.lastPrune) > Window {
		for id, at := range t.seen {
			if now.Sub(at) > Window {
				delete(t.seen, id)
			}
		}
		t.lastPrune = now
	}
}

// Online dice se l'utente ha mandato un segnale negli ultimi Window.
func (t *Tracker) Online(userID int) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	at, ok := t.seen[userID]
	return ok && t.now().Sub(at) <= Window
}

// OnlineIDs restituisce gli utenti online.
func (t *Tracker) OnlineIDs() []int {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	out := make([]int, 0, len(t.seen))
	for id, at := range t.seen {
		if now.Sub(at) <= Window {
			out = append(out, id)
		}
	}
	return out
}

// Reset dimentica tutti i segnali (test).
func (t *Tracker) Reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seen = map[int]time.Time{}
}

// Forget dimentica l'utente: torna subito offline (account cancellato, P3).
func (t *Tracker) Forget(userID int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.seen, userID)
}
