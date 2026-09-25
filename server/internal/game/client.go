package game

import (
	"chess-server/internal/gameerr"
	"chess-server/internal/models"
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

// Parametri della connessione WebSocket. Il server manda un ping ogni
// pingPeriod: se entro pongWait non arriva nulla dal client (pong o messaggio)
// la connessione è considerata morta e chiusa. Così un socket rimasto appeso
// (tipico su mobile in background) fa partire il timer d'abbandono invece di
// restare aperto per sempre.
const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096 // byte per messaggio in arrivo
)

// Codici di chiusura WebSocket applicativi (range 4000-4999).
const (
	CloseReplaced = 4001 // un'altra connessione dello stesso utente ha preso il posto di questa
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

// WritePump legge dal canale Send e scrive sul WebSocket, e manda i ping di
// heartbeat. Gira in una goroutine dedicata per ogni client.
func (c *Client) WritePump() {
	if c.Conn == nil {
		return // nessuna connessione reale (es. client mock nei test)
	}
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Printf("Errore scrittura WebSocket per %s: %v", c.Username, err)
				return
			}
		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump legge i messaggi in arrivo dal WebSocket
// Gira in una goroutine dedicata per ogni client
func (c *Client) ReadPump() {
	if c.Conn == nil {
		return // nessuna connessione reale (es. client mock nei test)
	}
	defer func() {

		GameManager.LeaveQueue(c)

		if c.Room != nil {
			c.Room.Leave(c)
		}
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		return c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, rawMsg, err := c.Conn.ReadMessage()
		if err != nil {
			// Connessione chiusa, errore di rete o heartbeat scaduto
			break
		}
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))

		// Rate limit sui messaggi in arrivo
		if !c.Limiter.Allow() {
			c.sendErr(gameerr.New(gameerr.RateLimited, "Stai inviando messaggi troppo velocemente"))
			continue
		}

		var msg models.WSMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			c.sendErr(gameerr.New(gameerr.InvalidPayload, "Formato messaggio non valido"))
			continue
		}

		// Smista il messaggio in base al tipo
		if c.Room != nil {
			c.Room.HandleMessage(c, msg)
		}
	}
}

// sendErr manda al client un messaggio `error` con codice, testo e dettagli.
// Un errore senza codice viene inviato come internal_error.
func (c *Client) sendErr(err error) {
	ge := gameerr.From(err)
	payload := map[string]interface{}{
		"message": ge.Message,
		"code":    ge.Code,
	}
	if len(ge.Details) > 0 {
		payload["details"] = ge.Details
	}
	c.SendMessage(models.MsgError, payload)
}

// closeWith chiude la connessione con un codice di chiusura WebSocket dopo un
// breve ritardo, così i messaggi già accodati (es. l'errore che spiega il
// motivo) hanno il tempo di partire. Sicura da qualunque goroutine: gorilla
// consente WriteControl e Close in concorrenza con le altre scritture.
func (c *Client) closeWith(code int, reason string) {
	if c.Conn == nil {
		return
	}
	conn := c.Conn
	time.AfterFunc(250*time.Millisecond, func() {
		_ = conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
		_ = conn.Close()
	})
}

// trySend accoda un messaggio senza bloccare: se il buffer è pieno (client lento
// o non connesso, es. placeholder di una room ripristinata) il messaggio è
// scartato invece di bloccare l'intera room.
func (c *Client) trySend(msg []byte) {
	select {
	case c.Send <- msg:
	default:
	}
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
	c.trySend(msg)
}
