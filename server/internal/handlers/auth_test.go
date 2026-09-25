package handlers

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateJWT(t *testing.T) {
	// Setup config
	config.C = &config.Config{
		JWTSecret: "test-secret-key",
	}

	token, err := generateJWT(1, "testuser")
	if err != nil {
		t.Fatalf("generateJWT() error = %v", err)
	}

	if token == "" {
		t.Error("generateJWT() returned empty token")
	}

	// Verifica che il token sia valido
	parsedToken, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		return []byte("test-secret-key"), nil
	})

	if err != nil {
		t.Fatalf("Failed to parse generated token: %v", err)
	}

	if !parsedToken.Valid {
		t.Error("Generated token should be valid")
	}

	// Verifica claims
	claims, ok := parsedToken.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatal("Claims should be MapClaims")
	}

	if claims["user_id"] != float64(1) {
		t.Errorf("user_id = %v, want %v", claims["user_id"], float64(1))
	}

	if claims["username"] != "testuser" {
		t.Errorf("username = %v, want %v", claims["username"], "testuser")
	}

	// Verifica expirazione
	exp, ok := claims["exp"].(float64)
	if !ok {
		t.Fatal("exp should be a number")
	}

	// Dovrebbe scadere tra circa 24 ore
	expectedExp := time.Now().Add(24 * time.Hour).Unix()
	if int64(exp) < expectedExp-60 || int64(exp) > expectedExp+60 {
		t.Errorf("exp = %v, expected around %v", exp, expectedExp)
	}
}

func TestRegister_InvalidJSON(t *testing.T) {
	// Invia JSON malformato
	req := httptest.NewRequest("POST", "/auth/register", bytes.NewBufferString("{invalid json"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	Register(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusBadRequest)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Success != false {
		t.Errorf("Success = %v, want %v", resp.Success, false)
	}

	if resp.Error != "Dati non validi" {
		t.Errorf("Error = %v, want %v", resp.Error, "Dati non validi")
	}
}

func TestRegister_Validation(t *testing.T) {
	tests := []struct {
		name     string
		request  models.RegisterRequest
		wantCode int
		wantErr  string
	}{
		{
			name:     "Empty request",
			request:  models.RegisterRequest{},
			wantCode: http.StatusBadRequest,
			wantErr:  "Username, email e password sono obbligatori",
		},
		{
			name: "Missing username",
			request: models.RegisterRequest{
				Email:    "test@example.com",
				Password: "password123",
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "Username, email e password sono obbligatori",
		},
		{
			name: "Missing email",
			request: models.RegisterRequest{
				Username: "testuser",
				Password: "password123",
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "Username, email e password sono obbligatori",
		},
		{
			name: "Missing password",
			request: models.RegisterRequest{
				Username: "testuser",
				Email:    "test@example.com",
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "Username, email e password sono obbligatori",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.request)
			req := httptest.NewRequest("POST", "/auth/register", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			Register(rr, req)

			if rr.Code != tt.wantCode {
				t.Errorf("Status = %v, want %v", rr.Code, tt.wantCode)
			}

			var resp models.APIResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
				t.Fatalf("Failed to unmarshal response: %v", err)
			}

			if resp.Error != tt.wantErr {
				t.Errorf("Error = %v, want %v", resp.Error, tt.wantErr)
			}
		})
	}
}

func TestLogin_InvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", "/auth/login", bytes.NewBufferString("{invalid"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	Login(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusBadRequest)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Success != false {
		t.Errorf("Success = %v, want %v", resp.Success, false)
	}
}

// TestMe richiede che il middleware JWT abbia già iniettato i claims nel context
// Questo è un test unitario che verifica la logica, non l'integrazione
func TestMe_MissingContext(t *testing.T) {
	// Questo test verifica cosa succede quando il context non ha i claims
	// In produzione questo scenario non dovrebbe verificarsi grazie al middleware

	req := httptest.NewRequest("GET", "/me", nil)
	rr := httptest.NewRecorder()

	// Senza il context del middleware, questo causerà un panic
	// Il test serve a documentare questo comportamento
	defer func() {
		if r := recover(); r != nil {
			t.Logf("Me() panic without context (expected): %v", r)
		}
	}()

	Me(rr, req)
}
