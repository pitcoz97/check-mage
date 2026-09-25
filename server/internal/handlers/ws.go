package handlers

import (
	"chess-server/internal/game"
	mw "chess-server/internal/middleware"
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

func WSHandler(w http.ResponseWriter, r *http.Request) {
	// Legge i dati dell'utente dal context (messi dal middleware JWT)
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
