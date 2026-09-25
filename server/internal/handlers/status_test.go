package handlers

import (
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Senza database configurato il health check risponde 503 con status
// "unavailable" (prima andava in panic).
func TestStatusHandler(t *testing.T) {
	req := httptest.NewRequest("GET", "/status", nil)
	rr := httptest.NewRecorder()

	StatusHandler(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusServiceUnavailable)
	}

	contentType := rr.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Content-Type = %v, want %v", contentType, "application/json")
	}

	var resp models.APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}
	if resp.Success {
		t.Error("Success dovrebbe essere false senza DB")
	}

	data, ok := resp.Data.(map[string]interface{})
	if !ok {
		t.Fatal("Data dovrebbe essere un map")
	}
	if data["status"] != "unavailable" {
		t.Errorf("status = %v, want %v", data["status"], "unavailable")
	}
	if data["version"] != "0.1.0" {
		t.Errorf("version = %v, want %v", data["version"], "0.1.0")
	}
}

func TestStatusHandler_MethodNotAllowed(t *testing.T) {
	// Test con metodi diversi da GET
	methods := []string{"POST", "PUT", "DELETE", "PATCH"}

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			req := httptest.NewRequest(method, "/status", nil)
			rr := httptest.NewRecorder()

			StatusHandler(rr, req)

			// Il handler non controlla il metodo, quindi dovrebbe rispondere
			// Questo test documenta il comportamento attuale
			if rr.Code != http.StatusOK {
				t.Logf("StatusHandler con metodo %s ritorna %d", method, rr.Code)
			}
		})
	}
}
