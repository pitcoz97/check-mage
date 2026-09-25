package game

import (
	"chess-server/internal/models"
	"encoding/json"
	"testing"
	"time"
)

func TestClient_SendMessage(t *testing.T) {
	client := &Client{
		UserID:   1,
		Username: "testuser",
		Send:     make(chan []byte, 10),
	}

	// Invia un messaggio
	client.SendMessage(models.MsgGameState, map[string]string{"status": "active"})

	// Verifica che il messaggio sia stato inviato al canale
	select {
	case msg := <-client.Send:
		var wsMsg models.WSMessage
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			t.Fatalf("Failed to unmarshal message: %v", err)
		}

		if wsMsg.Type != models.MsgGameState {
			t.Errorf("Type = %v, want %v", wsMsg.Type, models.MsgGameState)
		}

		var payload map[string]string
		if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
			t.Fatalf("Failed to unmarshal payload: %v", err)
		}

		if payload["status"] != "active" {
			t.Errorf("Payload.status = %v, want %v", payload["status"], "active")
		}
	default:
		t.Error("Messaggio non ricevuto dal canale")
	}
}

func TestClient_SendError(t *testing.T) {
	client := &Client{
		UserID:   1,
		Username: "testuser",
		Send:     make(chan []byte, 10),
	}

	// Invia un errore
	client.sendError("Test error message")

	// Verifica che il messaggio sia stato inviato al canale
	select {
	case msg := <-client.Send:
		var wsMsg models.WSMessage
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			t.Fatalf("Failed to unmarshal message: %v", err)
		}

		if wsMsg.Type != models.MsgError {
			t.Errorf("Type = %v, want %v", wsMsg.Type, models.MsgError)
		}

		var payload map[string]string
		if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
			t.Fatalf("Failed to unmarshal payload: %v", err)
		}

		if payload["message"] != "Test error message" {
			t.Errorf("Payload.message = %v, want %v", payload["message"], "Test error message")
		}
	default:
		t.Error("Messaggio di errore non ricevuto dal canale")
	}
}

func TestClient_SendMessage_InvalidPayload(t *testing.T) {
	client := &Client{
		UserID:   1,
		Username: "testuser",
		Send:     make(chan []byte, 10),
	}

	// Prova a inviare un payload che non può essere marshalled
	// Questo test verifica che la funzione gestisca correttamente gli errori
	// senza panic
	invalidPayload := make(chan int) // I channel non possono essere marshalled in JSON

	// Non dovrebbe causare panic
	client.SendMessage(models.MsgGameState, invalidPayload)

	// Non dovrebbe esserci alcun messaggio nel canale (errore silenzioso)
	select {
	case <-client.Send:
		t.Error("Non dovrebbe essere stato inviato alcun messaggio con payload invalido")
	default:
		// OK - nessun messaggio inviato
	}
}

func TestClient_MultipleMessages(t *testing.T) {
	client := &Client{
		UserID:   1,
		Username: "testuser",
		Send:     make(chan []byte, 100),
	}

	// Invia più messaggi
	for i := 0; i < 10; i++ {
		client.SendMessage(models.MsgMove, map[string]int{"move_number": i})
	}

	// Verifica che tutti i messaggi siano nel canale
	count := 0
	for {
		select {
		case msg := <-client.Send:
			var wsMsg models.WSMessage
			if err := json.Unmarshal(msg, &wsMsg); err != nil {
				t.Fatalf("Failed to unmarshal message: %v", err)
			}
			if wsMsg.Type == models.MsgMove {
				count++
			}
		default:
			if count != 10 {
				t.Errorf("Ricevuti %d messaggi, attesi 10", count)
			}
			return
		}
	}
}

func TestClient_CanReceiveMessages(t *testing.T) {
	client := &Client{
		UserID:   1,
		Username: "testuser",
		Send:     make(chan []byte, 1),
	}

	// Crea un messaggio JSON
	msgData, _ := json.Marshal(models.WSMessage{
		Type:    models.MsgMove,
		Payload: json.RawMessage(`{"move":"e2e4"}`),
	})

	// Invia al canale manualmente (simula ciò che farebbe WritePump)
	go func() {
		client.Send <- msgData
	}()

	// Verifica che il messaggio sia ricevibile
	select {
	case received := <-client.Send:
		if string(received) != string(msgData) {
			t.Error("Messaggio ricevuto diverso da quello inviato")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("Timeout ricevendo messaggio")
	}
}
