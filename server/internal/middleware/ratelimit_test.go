package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestNewRateLimiter(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(10), 20)

	if rl == nil {
		t.Fatal("NewRateLimiter() returned nil")
	}

	if rl.rate != rate.Limit(10) {
		t.Errorf("rate = %v, want %v", rl.rate, rate.Limit(10))
	}

	if rl.burst != 20 {
		t.Errorf("burst = %v, want %v", rl.burst, 20)
	}

	if rl.limiters == nil {
		t.Error("limiters map non inizializzato")
	}
}

func TestRateLimiter_GetLimiter(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(10), 5)

	// Ottieni limiter per un IP
	limiter := rl.getLimiter("192.168.1.1")
	if limiter == nil {
		t.Fatal("getLimiter() returned nil")
	}

	// Verifica che ritorni lo stesso limiter per lo stesso IP
	limiter2 := rl.getLimiter("192.168.1.1")
	if limiter != limiter2 {
		t.Error("Dovrebbe restituire lo stesso limiter per lo stesso IP")
	}

	// Verifica che crei un nuovo limiter per IP diverso
	limiter3 := rl.getLimiter("192.168.1.2")
	if limiter == limiter3 {
		t.Error("Dovrebbe creare un nuovo limiter per IP diverso")
	}
}

func TestRateLimiter_Middleware_Allow(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(100), 100) // Alto limite per evitare blocchi

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusOK)
	}

	if rr.Body.String() != "OK" {
		t.Errorf("Body = %v, want %v", rr.Body.String(), "OK")
	}
}

func TestRateLimiter_Middleware_Block(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(0), 0) // Zero limit, nessuna richiesta consentita

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Handler non dovrebbe essere chiamato quando rate limitato")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("Status = %v, want %v", rr.Code, http.StatusTooManyRequests)
	}
}

func TestGetIP(t *testing.T) {
	tests := []struct {
		name       string
		headers    map[string]string
		remoteAddr string
		want       string
	}{
		{
			name:       "X-Forwarded-For header",
			headers:    map[string]string{"X-Forwarded-For": "10.0.0.1"},
			remoteAddr: "192.168.1.1:1234",
			want:       "10.0.0.1",
		},
		{
			name:       "X-Real-IP header",
			headers:    map[string]string{"X-Real-IP": "10.0.0.2"},
			remoteAddr: "192.168.1.1:1234",
			want:       "10.0.0.2",
		},
		{
			name:       "RemoteAddr fallback",
			headers:    map[string]string{},
			remoteAddr: "192.168.1.1:1234",
			want:       "192.168.1.1:1234",
		},
		{
			name: "X-Forwarded-For takes precedence over X-Real-IP",
			headers: map[string]string{
				"X-Forwarded-For": "10.0.0.1",
				"X-Real-IP":       "10.0.0.2",
			},
			remoteAddr: "192.168.1.1:1234",
			want:       "10.0.0.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test", nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			req.RemoteAddr = tt.remoteAddr

			got := getIP(req)
			if got != tt.want {
				t.Errorf("getIP() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	rl := NewRateLimiter(rate.Limit(10), 5)

	// Crea un limiter
	rl.getLimiter("192.168.1.1")

	// Verifica che esista
	rl.mu.Lock()
	_, exists := rl.limiters["192.168.1.1"]
	rl.mu.Unlock()

	if !exists {
		t.Fatal("Limiter dovrebbe esistere")
	}

	// Simula tempo passato modificando lastSeen
	rl.mu.Lock()
	if l, ok := rl.limiters["192.168.1.1"]; ok {
		l.lastSeen = time.Now().Add(-4 * time.Minute)
	}
	rl.mu.Unlock()

	// Chiama cleanup manualmente
	rl.mu.Lock()
	for ip, l := range rl.limiters {
		if time.Since(l.lastSeen) > 3*time.Minute {
			delete(rl.limiters, ip)
		}
	}
	rl.mu.Unlock()

	// Verifica che sia stato rimosso
	rl.mu.Lock()
	_, exists = rl.limiters["192.168.1.1"]
	rl.mu.Unlock()

	if exists {
		t.Error("Limiter inattivo dovrebbe essere stato rimosso")
	}
}
