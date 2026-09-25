package handlers

import (
	"chess-server/internal/game"
	mw "chess-server/internal/middleware"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // In prod controlla origine
	},
}

// WSTicket gestisce GET /ws/ticket: emette un ticket monouso (30s) per aprire
// il WebSocket con /ws?ticket=… senza mettere il JWT nell'URL.
func WSTicket(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	claims := r.Context().Value(mw.UserKey).(jwt.MapClaims)
	ticket, ttl, err := mw.WSTickets.Issue(claims)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.APIResponse{Success: false, Error: "Errore generazione ticket"})
		return
	}

	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"ticket":     ticket,
			"expires_in": int(ttl.Seconds()),
		},
	})
}

func WSHandler(w http.ResponseWriter, r *http.Request) {
	// Legge i dati dell'utente dal context (messi da WSAuth: ticket o JWT)
	claims := r.Context().Value(mw.UserKey).(jwt.MapClaims)
	userID := int(claims["user_id"].(float64))
	username := claims["username"].(string)

	// Upgrade della connessione HTTP → WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &game.Client{
		UserID:   userID,
		Username: username,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Limiter:  rate.NewLimiter(5, 10), // 5 msg/sec, burst massimo 10
	}

	// JoinQueue decide se è una nuova partita o una riconnessione
	// In caso di nuova partita avvia le goroutine qui
	// In caso di riconnessione le avvia Reconnect()
	if !game.GameManager.JoinQueue(client) {
		go client.WritePump()
		go client.ReadPump()
	}
}
