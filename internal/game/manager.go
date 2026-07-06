package game

import (
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/logger"
	"encoding/json"
	"fmt"
	"sync"

	"go.uber.org/zap"
)

// Manager gestisce tutte le room attive e il matchmaking
// Il sync.RWMutex serve perché più goroutine accedono alla mappa contemporaneamente
type Manager struct {
	rooms     map[string]*Room
	waiting   *Client
	userRooms map[int]string // userID -> roomID, per la riconnessione
	mu        sync.RWMutex
}

// Istanza globale del manager
var GameManager = &Manager{
	rooms:     make(map[string]*Room),
	userRooms: make(map[int]string),
}

// JoinQueue aggiunge un client alla coda di matchmaking
func (m *Manager) JoinQueue(client *Client) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Controlla se il giocatore ha una partita in corso
	if roomID, exists := m.userRooms[client.UserID]; exists {
		room, roomExists := m.rooms[roomID]
		if roomExists && room.Board.Status == "active" {
			logger.L.Info("Riconnessione in corso",
				zap.String("player", client.Username),
				zap.String("room", roomID),
			)
			room.Reconnect(client)
			return true // è una riconnessione
		}
		// La room non esiste più, pulisci
		delete(m.userRooms, client.UserID)
	}

	if m.waiting == nil {
		// Nessuno in attesa — questo client aspetta
		m.waiting = client
		logger.L.Info("Giocatore in attesa di un avversario",
			zap.String("player", client.Username),
		)
		return false
	}

	// Controlla che il giocatore in attesa non sia lo stesso
	if m.waiting.UserID == client.UserID {
		client.sendError("Sei già in coda")
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

	logger.L.Info("Partita creata",
		zap.String("room", roomID),
		zap.String("white", opponent.Username),
		zap.String("black", client.Username),
	)

	return false
	// Notifica entrambi che la partita è iniziata
	// room.Broadcast("game_start", map[string]interface{}{
	// 	"room_id": roomID,
	// 	"white":   opponent.Username,
	// 	"black":   client.Username,
	// 	"fen":     room.Board.FEN,
	// })
}

// LeaveQueue rimuove un client dalla coda se è ancora in attesa
func (m *Manager) LeaveQueue(client *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.waiting != nil && m.waiting.UserID == client.UserID {
		m.waiting = nil
		logger.L.Info("Giocatore rimosso dalla coda",
			zap.String("player", client.Username),
		)
	}
}

func (m *Manager) RemoveRoom(id string, whiteID, blackID int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, id)
	delete(m.userRooms, whiteID)
	delete(m.userRooms, blackID)
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
		room := roomFromSnapshot(snap)
		m.rooms[room.ID] = room
		m.userRooms[snap.WhiteID] = room.ID
		m.userRooms[snap.BlackID] = room.ID
		restored++
	}
	logger.L.Info("Partite in corso ripristinate dal DB", zap.Int("n", restored))
}
