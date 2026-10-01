package game

import (
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/gameerr"
	"chess-server/internal/logger"
	"encoding/json"
	"fmt"
	"sync"

	"go.uber.org/zap"
)

// Manager gestisce tutte le room attive e il matchmaking
// Il sync.RWMutex serve perché più goroutine accedono alla mappa contemporaneamente
type Manager struct {
	rooms      map[string]*Room
	waiting    *Client
	userRooms  map[int]string        // userID -> roomID, per la riconnessione
	challenges map[string]*Challenge // sfide dirette aperte (challenges.go), creata alla prima
	mu         sync.RWMutex
}

// NewManager crea un manager vuoto.
func NewManager() *Manager {
	return &Manager{
		rooms:     make(map[string]*Room),
		userRooms: make(map[int]string),
	}
}

// Istanza globale del manager
var GameManager = NewManager()

// JoinQueue aggiunge un client alla coda di matchmaking
func (m *Manager) JoinQueue(client *Client) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Controlla se il giocatore ha una partita in corso
	if m.tryReconnectLocked(client) {
		return true // è una riconnessione
	}

	// Mazzo attivo non valido: niente coda, errore e chiusura (D6).
	if client.DeckInvalid {
		client.sendErr(gameerr.New(gameerr.DeckInvalid, "Il mazzo attivo non è valido"))
		client.closeWith(CloseDeckInvalid, string(gameerr.DeckInvalid))
		return false
	}

	// Stesso utente già in coda da un'altra connessione (refresh, secondo tab):
	// la connessione nuova prende il posto di quella vecchia, che viene chiusa.
	if m.waiting != nil && m.waiting.UserID == client.UserID {
		old := m.waiting
		m.waiting = client
		if old != client {
			old.sendErr(gameerr.New(gameerr.ReplacedByNewConnection,
				"Sei entrato in coda da un'altra connessione"))
			old.closeWith(CloseReplaced, string(gameerr.ReplacedByNewConnection))
		}
		logger.L.Info("Connessione in coda sostituita",
			zap.String("player", client.Username),
		)
		return false
	}

	if m.waiting == nil {
		// Nessuno in attesa — questo client aspetta
		m.waiting = client
		logger.L.Info("Giocatore in attesa di un avversario",
			zap.String("player", client.Username),
		)
		return false
	}

	// C'è già qualcuno in attesa — crea la partita
	opponent := m.waiting
	m.waiting = nil

	roomID := fmt.Sprintf("room-%d-%d", opponent.UserID, client.UserID)
	room := NewRoom(
		roomID,
		opponent,
		client,
		config.C.DefaultBaseTime,
		config.C.DefaultIncrement,
	)
	m.rooms[roomID] = room

	// Registra la room per entrambi i giocatori
	m.userRooms[opponent.UserID] = roomID
	m.userRooms[client.UserID] = roomID
	// Le sfide ancora aperte dei due giocatori non possono più partire (F9).
	m.closeChallengesOfLocked(opponent.UserID, client.UserID)

	logger.L.Info("Partita creata",
		zap.String("room", roomID),
		zap.String("white", opponent.Username),
		zap.String("black", client.Username),
	)

	// L'identità dei giocatori arriva nel primo game_state (white_player/black_player).
	return false
}

// tryReconnectLocked riporta il client nella sua partita se ne ha una attiva, e
// ripulisce l'indice se la room non c'è più. Va invocata con m.mu tenuto.
func (m *Manager) tryReconnectLocked(client *Client) bool {
	roomID, exists := m.userRooms[client.UserID]
	if !exists {
		return false
	}
	if room, roomExists := m.rooms[roomID]; roomExists && room.isActive() {
		logger.L.Info("Riconnessione in corso",
			zap.String("player", client.Username),
			zap.String("room", roomID),
		)
		room.Reconnect(client)
		return true
	}
	// La room non esiste più, pulisci
	delete(m.userRooms, client.UserID)
	return false
}

// inMatchLocked dice se l'utente ha una partita attiva. Va invocata con m.mu tenuto.
func (m *Manager) inMatchLocked(userID int) bool {
	roomID, exists := m.userRooms[userID]
	if !exists {
		return false
	}
	room, roomExists := m.rooms[roomID]
	return roomExists && room.isActive()
}

// InMatch dice se l'utente ha una partita attiva (stato "playing" degli amici).
func (m *Manager) InMatch(userID int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inMatchLocked(userID)
}

// PlayingIDs restituisce gli utenti con una partita attiva.
func (m *Manager) PlayingIDs() []int {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]int, 0, len(m.userRooms))
	for userID := range m.userRooms {
		if m.inMatchLocked(userID) {
			out = append(out, userID)
		}
	}
	return out
}

// LeaveQueue rimuove un client dalla coda se è ancora in attesa. Il confronto è
// sulla connessione, non sull'utente: la chiusura di una connessione già
// sostituita non deve togliere dalla coda quella nuova.
func (m *Manager) LeaveQueue(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.waiting == client {
		m.waiting = nil
		logger.L.Info("Giocatore rimosso dalla coda",
			zap.String("player", client.Username),
		)
	}
}

// RemoveRoom rimuove una room conclusa. Gli indici utente → room vengono tolti
// solo se puntano ancora a questa room: nel frattempo un giocatore potrebbe
// essere già entrato in una partita nuova.
func (m *Manager) RemoveRoom(id string, whiteID, blackID int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, id)
	for _, uid := range []int{whiteID, blackID} {
		if m.userRooms[uid] == id {
			delete(m.userRooms, uid)
		}
	}
}

// Shutdown salva le partite in corso (senza terminarle): al riavvio verranno
// ripristinate da LoadPersisted e i giocatori potranno riconnettersi.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.rooms) == 0 {
		logger.L.Info("Nessuna partita attiva da salvare")
		return
	}

	logger.L.Info("Shutdown: salvataggio partite in corso",
		zap.Int("partite_attive", len(m.rooms)),
	)

	for _, room := range m.rooms {
		room.stopTimer()
		if err := room.persistSync(); err != nil {
			logger.L.Warn("Errore salvataggio match live in shutdown",
				zap.String("room", room.ID), zap.Error(err))
		}
	}
}

// LoadPersisted ricarica in memoria le partite in corso salvate nel DB (chiamata
// all'avvio del server, dopo db.Connect). Le room sono dormienti finché un
// giocatore non si riconnette.
func (m *Manager) LoadPersisted() {
	rows, err := db.LoadLiveMatches()
	if err != nil {
		logger.L.Warn("Caricamento match live fallito", zap.Error(err))
		return
	}
	if len(rows) == 0 {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	restored := 0
	for _, row := range rows {
		var snap roomSnapshot
		if err := json.Unmarshal(row.State, &snap); err != nil {
			logger.L.Warn("Match live corrotto, saltato", zap.String("room", row.RoomID), zap.Error(err))
			continue
		}
		if snap.Status != StatusActive {
			continue // partita già conclusa: non va ripristinata
		}
		room := roomFromSnapshot(snap)
		m.rooms[room.ID] = room
		m.userRooms[snap.WhiteID] = room.ID
		m.userRooms[snap.BlackID] = room.ID
		restored++
	}
	logger.L.Info("Partite in corso ripristinate dal DB", zap.Int("n", restored))
}
