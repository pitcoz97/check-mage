package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TicketTTL è la durata di un ticket WebSocket.
const TicketTTL = 30 * time.Second

// TicketStore conserva in memoria i ticket monouso per aprire il WebSocket.
// Il client li ottiene con GET /ws/ticket (autenticato) e si connette con
// /ws?ticket=…: così il JWT non finisce nell'URL, nei log di accesso o nella
// cronologia.
type TicketStore struct {
	mu      sync.Mutex
	ttl     time.Duration
	tickets map[string]ticketEntry
	now     func() time.Time
}

type ticketEntry struct {
	claims  jwt.MapClaims
	expires time.Time
}

// NewTicketStore crea uno store con la durata data.
func NewTicketStore(ttl time.Duration) *TicketStore {
	return &TicketStore{ttl: ttl, tickets: make(map[string]ticketEntry), now: time.Now}
}

// WSTickets è lo store usato dal router.
var WSTickets = NewTicketStore(TicketTTL)

// Issue genera un ticket opaco legato ai claim dell'utente.
func (s *TicketStore) Issue(claims jwt.MapClaims) (string, time.Duration, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", 0, err
	}
	ticket := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for t, e := range s.tickets { // pulizia dei ticket scaduti
		if now.After(e.expires) {
			delete(s.tickets, t)
		}
	}
	s.tickets[ticket] = ticketEntry{claims: claims, expires: now.Add(s.ttl)}
	return ticket, s.ttl, nil
}

// Consume valida e invalida un ticket (monouso). Ritorna i claim associati.
func (s *TicketStore) Consume(ticket string) (jwt.MapClaims, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.tickets[ticket]
	if !ok {
		return nil, false
	}
	delete(s.tickets, ticket)
	if s.now().After(e.expires) {
		return nil, false
	}
	return e.claims, true
}

// WSAuth autentica l'apertura del WebSocket: con ?ticket= consuma il ticket
// monouso, altrimenti ricade su Auth (header Bearer o ?token=).
func WSAuth(next http.Handler) http.Handler {
	fallback := Auth(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ticket := r.URL.Query().Get("ticket")
		if ticket == "" {
			fallback.ServeHTTP(w, r)
			return
		}
		claims, ok := WSTickets.Consume(ticket)
		if !ok {
			unauthorized(w, "Ticket non valido o scaduto")
			return
		}
		ctx := context.WithValue(r.Context(), UserKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
