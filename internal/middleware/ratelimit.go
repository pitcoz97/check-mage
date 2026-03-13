package middleware

import (
	"chess-server/internal/config"
	"chess-server/internal/models"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// limiter rappresenta il rate limiter di un singolo IP
type limiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimiter gestisce i limiter per tutti gli IP
type RateLimiter struct {
	limiters map[string]*limiter
	mu       sync.Mutex
	rate     rate.Limit // richieste al secondo
	burst    int        // massimo burst consentito
}

func NewRateLimiter(r rate.Limit, burst int) *RateLimiter {
	rl := &RateLimiter{
		limiters: make(map[string]*limiter),
		rate:     r,
		burst:    burst,
	}

	// Goroutine che pulisce i limiter inattivi ogni minuto
	go rl.cleanup()

	return rl
}

// getLimiter ritorna il limiter per un IP, creandolo se non esiste
func (rl *RateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	l, exists := rl.limiters[ip]
	if !exists {
		l = &limiter{
			limiter: rate.NewLimiter(rl.rate, rl.burst),
		}
		rl.limiters[ip] = l
	}

	l.lastSeen = time.Now()
	return l.limiter
}

// cleanup rimuove i limiter degli IP inattivi da più di 3 minuti
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		for ip, l := range rl.limiters {
			if time.Since(l.lastSeen) > 3*time.Minute {
				delete(rl.limiters, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware ritorna un handler Chi per il rate limiting
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getIP(r)
		l := rl.getLimiter(ip)

		if !l.Allow() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(models.APIResponse{
				Success: false,
				Error:   "Troppe richieste, rallenta!",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getIP estrae l'IP reale dalla richiesta
// considera anche il caso in cui c'è un reverse proxy (Nginx)
func getIP(r *http.Request) string {
	// X-Forwarded-For è impostato da Nginx/proxy
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// Limiter predefiniti pronti all'uso
var (
	GeneralLimiter *RateLimiter
	AuthLimiter    *RateLimiter
	WSLimiter      *RateLimiter
)

func InitLimiters() {
	GeneralLimiter = NewRateLimiter(rate.Limit(config.C.RateGeneral), 20)
	AuthLimiter = NewRateLimiter(rate.Limit(config.C.RateAuth), 5)
	WSLimiter = NewRateLimiter(rate.Limit(config.C.RateWS), 3)
}
