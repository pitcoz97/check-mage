package game

import (
	"chess-server/internal/models"
	"encoding/json"
	"log"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

// Client rappresenta un giocatore connesso via WebSocket
// È l'equivalente di un "peer" in una sessione di gioco
type Client struct {
	UserID   int
	Username string
	Conn     *websocket.Conn
	Send     chan []byte // canale per i messaggi in uscita — come una coda
	Room     *Room
	Limiter  *rate.Limiter // max messaggi al secondo
}

// WritePump legge dal canale Send e scrive sul WebSocket
// Gira in una goroutine dedicata per ogni client
func (c *Client) WritePump() {
	defer c.Conn.Close()

	for msg := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Printf("Errore scrittura WebSocket per %s: %v", c.Username, err)
			return
		}
	}
}

// ReadPump legge i messaggi in arrivo dal WebSocket
// Gira in una goroutine dedicata per ogni client
func (c *Client) ReadPump() {
	defer func() {

		GameManager.LeaveQueue(c)

		if c.Room != nil {
			c.Room.Leave(c)
		}
		c.Conn.Close()
	}()

	for {
		_, rawMsg, err := c.Conn.ReadMessage()
		if err != nil {
			// Connessione chiusa o errore di rete
			break
		}

		// Rate limit sui messaggi in arrivo
		if !c.Limiter.Allow() {
			c.sendError("Stai inviando messaggi troppo velocemente")
			continue
		}

		var msg models.WSMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			c.sendError("Formato messaggio non valido")
			continue
		}

		// Smista il messaggio in base al tipo
		if c.Room != nil {
			c.Room.HandleMessage(c, msg)
		}
	}
}

// sendError manda un messaggio di errore al client
func (c *Client) sendError(errMsg string) {
	payload, _ := json.Marshal(map[string]string{"message": errMsg})
	msg, _ := json.Marshal(models.WSMessage{
		Type:    models.MsgError,
		Payload: payload,
	})
	c.Send <- msg
}

// SendMessage manda un messaggio tipizzato al client
func (c *Client) SendMessage(msgType string, payload interface{}) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg, err := json.Marshal(models.WSMessage{
		Type:    msgType,
		Payload: payloadBytes,
	})
	if err != nil {
		return
	}
	c.Send <- msg
}
