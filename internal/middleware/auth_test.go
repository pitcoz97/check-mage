package middleware

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestAuth_MissingHeader(t *testing.T) {
	// Configurazione necessaria
	config.C = &config.Config{JWTSecret: "test-secret"}

	req := httptest.NewRequest("GET", "/protected", nil)
	rr := httptest.NewRecorder()

	handler := Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Handler non dovrebbe essere chiamato senza token")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusUnauthorized)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Success != false {
		t.Errorf("Success = %v, want %v", resp.Success, false)
	}

	if !strings.Contains(resp.Error, "Token mancante") {
		t.Errorf("Error message = %v, should contain 'Token mancante'", resp.Error)
	}
}

func TestAuth_InvalidToken(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rr := httptest.NewRecorder()

	handler := Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Handler non dovrebbe essere chiamato con token invalido")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusUnauthorized)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Success != false {
		t.Errorf("Success = %v, want %v", resp.Success, false)
	}

	if !strings.Contains(resp.Error, "non valido") {
		t.Errorf("Error message = %v, should contain 'non valido'", resp.Error)
	}
}

func TestAuth_ValidToken(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}

	// Crea un token valido
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  float64(1),
		"username": "testuser",
	})
	tokenString, err := token.SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("Failed to sign token: %v", err)
	}

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rr := httptest.NewRecorder()

	var capturedContextUser interface{}
	handler := Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedContextUser = r.Context().Value(UserKey)
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusOK)
	}

	if capturedContextUser == nil {
		t.Error("User claims dovrebbero essere nel context")
	}
}

func TestAuth_WrongHeaderFormat(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}

	// Test senza "Bearer "
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "just-token-here")
	rr := httptest.NewRecorder()

	handler := Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Handler non dovrebbe essere chiamato")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusUnauthorized)
	}
}
