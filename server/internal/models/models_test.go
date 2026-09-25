package models

import (
	"encoding/json"
	"testing"
)

func TestAPIResponse(t *testing.T) {
	// Test risposta di successo
	resp := APIResponse{
		Success: true,
		Data:    map[string]string{"message": "hello"},
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("Failed to marshal APIResponse: %v", err)
	}

	expected := `{"success":true,"data":{"message":"hello"}}`
	if string(data) != expected {
		t.Errorf("JSON = %v, want %v", string(data), expected)
	}

	// Test risposta di errore
	respErr := APIResponse{
		Success: false,
		Error:   "something went wrong",
	}

	dataErr, err := json.Marshal(respErr)
	if err != nil {
		t.Fatalf("Failed to marshal error APIResponse: %v", err)
	}

	expectedErr := `{"success":false,"error":"something went wrong"}`
	if string(dataErr) != expectedErr {
		t.Errorf("JSON = %v, want %v", string(dataErr), expectedErr)
	}
}

func TestWSMessage(t *testing.T) {
	// Test unmarshalling messaggio WebSocket
	jsonData := `{"type":"move","payload":{"move":"e2e4"}}`

	var msg WSMessage
	if err := json.Unmarshal([]byte(jsonData), &msg); err != nil {
		t.Fatalf("Failed to unmarshal WSMessage: %v", err)
	}

	if msg.Type != "move" {
		t.Errorf("Type = %v, want %v", msg.Type, "move")
	}

	// Verifica che Payload contenga i dati grezzi
	var payloadData map[string]string
	if err := json.Unmarshal(msg.Payload, &payloadData); err != nil {
		t.Fatalf("Failed to unmarshal payload: %v", err)
	}

	if payloadData["move"] != "e2e4" {
		t.Errorf("Payload.move = %v, want %v", payloadData["move"], "e2e4")
	}
}

func TestUser(t *testing.T) {
	user := User{
		ID:       1,
		Username: "testuser",
		Email:    "test@example.com",
		Password: "secretpassword",
		Elo:      1500,
	}

	data, err := json.Marshal(user)
	if err != nil {
		t.Fatalf("Failed to marshal User: %v", err)
	}

	// Verifica che Password non sia incluso nel JSON (tag `-`)
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to unmarshal User JSON: %v", err)
	}

	if _, exists := result["password"]; exists {
		t.Error("Password dovrebbe essere omesso dal JSON")
	}

	// Verifica che gli altri campi siano presenti
	if result["id"] != float64(1) {
		t.Errorf("id = %v, want %v", result["id"], 1)
	}

	if result["username"] != "testuser" {
		t.Errorf("username = %v, want %v", result["username"], "testuser")
	}

	if result["email"] != "test@example.com" {
		t.Errorf("email = %v, want %v", result["email"], "test@example.com")
	}

	if result["elo"] != float64(1500) {
		t.Errorf("elo = %v, want %v", result["elo"], 1500)
	}
}

func TestRegisterRequest(t *testing.T) {
	req := RegisterRequest{
		Username: "newuser",
		Email:    "new@example.com",
		Password: "password123",
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Failed to marshal RegisterRequest: %v", err)
	}

	expected := `{"username":"newuser","email":"new@example.com","password":"password123"}`
	if string(data) != expected {
		t.Errorf("JSON = %v, want %v", string(data), expected)
	}
}

func TestLoginRequest(t *testing.T) {
	req := LoginRequest{
		Email:    "user@example.com",
		Password: "mypassword",
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Failed to marshal LoginRequest: %v", err)
	}

	expected := `{"email":"user@example.com","password":"mypassword"}`
	if string(data) != expected {
		t.Errorf("JSON = %v, want %v", string(data), expected)
	}
}

func TestMessageConstants(t *testing.T) {
	// Verifica che le costanti dei messaggi siano corrette
	tests := []struct {
		name     string
		constant string
		expected string
	}{
		{"MsgMove", MsgMove, "move"},
		{"MsgGameState", MsgGameState, "game_state"},
		{"MsgGameOver", MsgGameOver, "game_over"},
		{"MsgError", MsgError, "error"},
		{"MsgOpponentDisconnected", MsgOpponentDisconnected, "opponent_disconnected"},
		{"MsgDrawOffer", MsgDrawOffer, "draw_offer"},
		{"MsgDrawAccepted", MsgDrawAccepted, "draw_accepted"},
		{"MsgDrawDeclined", MsgDrawDeclined, "draw_declined"},
		{"MsgResign", MsgResign, "resign"},
		{"ResultWhiteWins", ResultWhiteWins, "1-0"},
		{"ResultBlackWins", ResultBlackWins, "0-1"},
		{"ResultDraw", ResultDraw, "1/2-1/2"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.constant != tt.expected {
				t.Errorf("%s = %v, want %v", tt.name, tt.constant, tt.expected)
			}
		})
	}
}
