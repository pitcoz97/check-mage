package middleware

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		"type":     "access",
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

func signTestToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatalf("firma token: %v", err)
	}
	return s
}

// B3: un refresh token non deve aprire le rotte protette.
func TestAuth_RejectsRefreshToken(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}
	refresh := signTestToken(t, jwt.MapClaims{"user_id": float64(1), "type": "refresh"})

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+refresh)
	rr := httptest.NewRecorder()
	Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("un refresh token non deve superare il middleware")
	})).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusUnauthorized)
	}
}

// Un token firmato con un algoritmo diverso da HS256 viene rifiutato.
func TestParseAccessToken_RejectsOtherAlgorithms(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS512, jwt.MapClaims{
		"user_id": float64(1), "username": "u", "type": "access",
	}).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseAccessToken(tok); err == nil {
		t.Error("un token HS512 non deve essere accettato")
	}
}

func TestWSTicket_SingleUseAndExpiry(t *testing.T) {
	store := NewTicketStore(time.Minute)
	now := time.Now()
	store.now = func() time.Time { return now }

	ticket, ttl, err := store.Issue(jwt.MapClaims{"user_id": float64(3), "username": "dan", "type": "access"})
	if err != nil || ticket == "" || ttl != time.Minute {
		t.Fatalf("Issue: %q %v %v", ticket, ttl, err)
	}
	claims, ok := store.Consume(ticket)
	if !ok || claims["username"] != "dan" {
		t.Fatalf("Consume: %v %v", claims, ok)
	}
	if _, ok := store.Consume(ticket); ok {
		t.Error("un ticket non deve essere riutilizzabile")
	}

	expired, _, _ := store.Issue(jwt.MapClaims{"user_id": float64(3)})
	now = now.Add(2 * time.Minute)
	if _, ok := store.Consume(expired); ok {
		t.Error("un ticket scaduto non deve essere accettato")
	}
}

func TestWSAuth_WithTicket(t *testing.T) {
	config.C = &config.Config{JWTSecret: "test-secret"}
	ticket, _, err := WSTickets.Issue(jwt.MapClaims{"user_id": float64(4), "username": "eve", "type": "access"})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/ws?ticket="+ticket, nil)
	rr := httptest.NewRecorder()
	called := false
	WSAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = r.Context().Value(UserKey).(jwt.MapClaims)["username"] == "eve"
	})).ServeHTTP(rr, req)
	if !called {
		t.Error("un ticket valido deve autenticare il WebSocket")
	}

	rr = httptest.NewRecorder()
	WSAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("un ticket già usato non deve autenticare")
	})).ServeHTTP(rr, httptest.NewRequest("GET", "/ws?ticket="+ticket, nil))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Status = %v, want 401", rr.Code)
	}
}
