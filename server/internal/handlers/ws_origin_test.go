package handlers

import (
	"chess-server/internal/config"
	"net/http/httptest"
	"testing"
)

func TestMatchOrigin(t *testing.T) {
	cases := []struct {
		pattern, origin string
		want            bool
	}{
		{"https://checkmage.example", "https://checkmage.example", true},
		{"https://checkmage.example", "HTTPS://CheckMage.example", true},
		{"https://checkmage.example", "https://evil.example", false},
		{"https://*", "https://anything.example", true},
		{"https://*", "http://anything.example", false},
		{"https://*.checkmage.example", "https://www.checkmage.example", true},
		{"https://*.checkmage.example", "https://checkmage.example.evil", false},
		{"capacitor://localhost", "capacitor://localhost", true},
		{"*", "https://x", true},
	}
	for _, c := range cases {
		if got := matchOrigin(c.pattern, c.origin); got != c.want {
			t.Errorf("matchOrigin(%q, %q) = %v, atteso %v", c.pattern, c.origin, got, c.want)
		}
	}
}

// P2-16: l'handshake WebSocket accetta solo le origini ammesse; senza Origin passa.
func TestAllowedOrigin(t *testing.T) {
	previous := config.C
	config.C = &config.Config{CORSAllowedOrigins: []string{"https://checkmage.example", "https://localhost", "capacitor://localhost"}}
	t.Cleanup(func() { config.C = previous })

	for origin, want := range map[string]bool{
		"":                          true,
		"https://checkmage.example": true,
		"https://localhost":         true,
		"capacitor://localhost":     true,
		"https://evil.example":      false,
		"http://checkmage.example":  false,
	} {
		req := httptest.NewRequest("GET", "/ws", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if got := allowedOrigin(req); got != want {
			t.Errorf("Origin %q: %v, atteso %v", origin, got, want)
		}
	}
}
