package game

import (
	"chess-server/internal/config"
	"chess-server/internal/gameerr"
	"chess-server/internal/logger"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	mrand "math/rand/v2"
	"sort"
	"time"

	"go.uber.org/zap"
)

// Sfide dirette fra amici (F4–F9). Chi sfida crea la sfida (POST
// /me/challenges) e apre subito /ws?challenge=<id>; lo sfidato accetta aprendo
// lo stesso URL. Il primo che arriva aspetta nello slot della sfida, il secondo
// fa partire una partita amichevole: colori a caso, niente ELO. Tutto in
// memoria: dopo un riavvio le sfide aperte non ci sono più.

// ChallengeTTL è la durata di una sfida senza risposta (variabile per i test).
var ChallengeTTL = 60 * time.Second

// Errori di CreateChallenge e CancelChallenge.
var (
	ErrChallengerBusy    = errors.New("chi sfida è in partita")
	ErrTargetBusy        = errors.New("lo sfidato è in partita")
	ErrChallengeNotFound = errors.New("sfida non trovata")
)

// ChallengePlayer è uno dei due giocatori di una sfida.
type ChallengePlayer struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Elo      int    `json:"elo"`
}

// Challenge è una sfida aperta.
type Challenge struct {
	ID        string
	From      ChallengePlayer
	To        ChallengePlayer
	ExpiresAt time.Time

	slot  *Client     // chi è già collegato e aspetta l'altro
	timer *time.Timer // scadenza
}

// ChallengeView è una sfida come la vede il client.
type ChallengeView struct {
	ID        string          `json:"id"`
	From      ChallengePlayer `json:"from"`
	To        ChallengePlayer `json:"to"`
	ExpiresIn int             `json:"expires_in"` // secondi alla scadenza
}

func (c *Challenge) view(now time.Time) ChallengeView {
	left := int(math.Ceil(c.ExpiresAt.Sub(now).Seconds()))
	if left < 0 {
		left = 0
	}
	return ChallengeView{ID: c.ID, From: c.From, To: c.To, ExpiresIn: left}
}

func newChallengeID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// challengesLocked restituisce le sfide, creando la mappa alla prima. Va
// invocata con m.mu tenuto.
func (m *Manager) challengesLocked() map[string]*Challenge {
	if m.challenges == nil {
		m.challenges = make(map[string]*Challenge)
	}
	return m.challenges
}

var challengeMessages = map[gameerr.Code]string{
	gameerr.ChallengeDeclined:    "La sfida è stata rifiutata",
	gameerr.ChallengeExpired:     "La sfida è scaduta",
	gameerr.ChallengeUnavailable: "La sfida non è più disponibile",
}

// notifyChallengeClosed manda l'errore della sfida e chiude il socket (4003).
func notifyChallengeClosed(c *Client, code gameerr.Code) {
	c.sendErr(gameerr.New(code, challengeMessages[code]))
	c.closeWith(CloseChallenge, string(code))
}

// replaceConnection chiude una connessione dello stesso utente superata da una
// nuova (4001).
func replaceConnection(old *Client, message string) {
	old.sendErr(gameerr.New(gameerr.ReplacedByNewConnection, message))
	old.closeWith(CloseReplaced, string(gameerr.ReplacedByNewConnection))
}

// closeChallengeLocked toglie la sfida e avvisa chi aspetta nello slot. Va
// invocata con m.mu tenuto.
func (m *Manager) closeChallengeLocked(ch *Challenge, code gameerr.Code) {
	if ch.timer != nil {
		ch.timer.Stop()
	}
	delete(m.challengesLocked(), ch.ID)
	if ch.slot != nil {
		notifyChallengeClosed(ch.slot, code)
		ch.slot = nil
	}
}

// closeChallengesOfLocked chiude le sfide aperte che coinvolgono questi utenti:
// è appena partita una loro partita (F9). Va invocata con m.mu tenuto.
func (m *Manager) closeChallengesOfLocked(userIDs ...int) {
	for _, ch := range m.challengesLocked() {
		for _, id := range userIDs {
			if ch.From.ID == id || ch.To.ID == id {
				m.closeChallengeLocked(ch, gameerr.ChallengeUnavailable)
				break
			}
		}
	}
}

// CloseChallengesBetween chiude le sfide aperte fra a e b, in una delle due
// direzioni: uno dei due ha bloccato l'altro (A8).
func (m *Manager) CloseChallengesBetween(a, b int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ch := range m.challengesLocked() {
		if (ch.From.ID == a && ch.To.ID == b) || (ch.From.ID == b && ch.To.ID == a) {
			m.closeChallengeLocked(ch, gameerr.ChallengeUnavailable)
		}
	}
}

// CreateChallenge apre una sfida da from a to. Nessuno dei due deve essere in
// partita; una sfida precedente di from viene sostituita (F5).
func (m *Manager) CreateChallenge(from, to ChallengePlayer) (ChallengeView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.inMatchLocked(from.ID) {
		return ChallengeView{}, ErrChallengerBusy
	}
	if m.inMatchLocked(to.ID) {
		return ChallengeView{}, ErrTargetBusy
	}
	for _, ch := range m.challengesLocked() {
		if ch.From.ID == from.ID {
			m.closeChallengeLocked(ch, gameerr.ChallengeUnavailable)
		}
	}

	now := time.Now()
	ch := &Challenge{ID: newChallengeID(), From: from, To: to, ExpiresAt: now.Add(ChallengeTTL)}
	m.challenges[ch.ID] = ch
	ch.timer = time.AfterFunc(ChallengeTTL, func() { m.expireChallenge(ch) })

	logger.L.Info("Sfida creata",
		zap.String("from", from.Username),
		zap.String("to", to.Username),
	)
	return ch.view(now), nil
}

// expireChallenge chiude la sfida scaduta, se è ancora aperta.
func (m *Manager) expireChallenge(ch *Challenge) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.challengesLocked()[ch.ID] == ch {
		m.closeChallengeLocked(ch, gameerr.ChallengeExpired)
	}
}

// IncomingChallenges restituisce le sfide aperte ricevute dall'utente, dalla
// più vicina alla scadenza.
func (m *Manager) IncomingChallenges(userID int) []ChallengeView {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	out := []ChallengeView{}
	for _, ch := range m.challengesLocked() {
		if ch.To.ID == userID {
			out = append(out, ch.view(now))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExpiresIn < out[j].ExpiresIn })
	return out
}

// CancelChallenge chiude la sfida: chi sfida la annulla, lo sfidato la rifiuta.
// Chi aspetta nello slot riceve l'errore e la chiusura 4003.
func (m *Manager) CancelChallenge(userID int, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ch, ok := m.challengesLocked()[id]
	switch {
	case !ok:
		return ErrChallengeNotFound
	case userID == ch.From.ID:
		m.closeChallengeLocked(ch, gameerr.ChallengeUnavailable)
	case userID == ch.To.ID:
		m.closeChallengeLocked(ch, gameerr.ChallengeDeclined)
	default:
		return ErrChallengeNotFound
	}
	return nil
}

// JoinChallenge collega un giocatore a una sfida (/ws?challenge=<id>). Come
// JoinQueue: ritorna true se è una riconnessione a una partita in corso, e
// valgono il mazzo attivo valido (D6) e la sostituzione della connessione
// precedente (4001).
func (m *Manager) JoinChallenge(client *Client, id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.tryReconnectLocked(client) {
		return true
	}

	ch, ok := m.challengesLocked()[id]
	if !ok || (client.UserID != ch.From.ID && client.UserID != ch.To.ID) {
		notifyChallengeClosed(client, gameerr.ChallengeUnavailable)
		return false
	}
	if client.DeckInvalid {
		client.sendErr(gameerr.New(gameerr.DeckInvalid, "Il mazzo attivo non è valido"))
		client.closeWith(CloseDeckInvalid, string(gameerr.DeckInvalid))
		return false
	}

	// Una connessione dello stesso utente rimasta in coda esce dalla coda.
	if m.waiting != nil && m.waiting.UserID == client.UserID && m.waiting != client {
		old := m.waiting
		m.waiting = nil
		replaceConnection(old, "Hai accettato una sfida da un'altra connessione")
	}

	slot := ch.slot
	if slot == nil || slot.UserID == client.UserID {
		ch.slot = client
		if slot != nil && slot != client {
			replaceConnection(slot, "La sfida è stata ripresa da un'altra connessione")
		}
		logger.L.Info("Giocatore in attesa della sfida", zap.String("player", client.Username))
		return false
	}

	// Ci sono tutti e due: parte la partita amichevole.
	if ch.timer != nil {
		ch.timer.Stop()
	}
	delete(m.challenges, ch.ID)
	ch.slot = nil

	white, black := slot, client
	if mrand.IntN(2) == 1 {
		white, black = client, slot
	}
	roomID := "challenge-" + ch.ID
	room := newRoom(roomID, white, black, config.C.DefaultBaseTime, config.C.DefaultIncrement, true)
	m.rooms[roomID] = room
	m.userRooms[white.UserID] = roomID
	m.userRooms[black.UserID] = roomID
	m.closeChallengesOfLocked(white.UserID, black.UserID)

	logger.L.Info("Partita amichevole creata",
		zap.String("room", roomID),
		zap.String("white", white.Username),
		zap.String("black", black.Username),
	)
	return false
}

// LeaveChallenge toglie dallo slot una connessione che si chiude. Se è quella di
// chi sfida, la sfida è annullata; se è dello sfidato, resta aperta fino alla
// scadenza.
func (m *Manager) LeaveChallenge(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ch := range m.challengesLocked() {
		if ch.slot != client {
			continue
		}
		ch.slot = nil
		if client.UserID == ch.From.ID {
			m.closeChallengeLocked(ch, gameerr.ChallengeUnavailable)
		}
	}
}

// CloseChallengesOf chiude le sfide aperte dell'utente, inviate o ricevute: ha
// cancellato l'account (P3).
func (m *Manager) CloseChallengesOf(userID int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeChallengesOfLocked(userID)
}
