package config

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	// Database
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string

	// sslmode di lib/pq: disable (stessa macchina o rete Docker), require, verify-full…
	DBSSLMode string

	// JWT
	JWTSecret string

	// Server
	ServerPort string

	// Game
	PhaseTimeMain    time.Duration // tempo di una fase Magie (main1, main2)
	PhaseTimeMove    time.Duration // tempo della fase Mossa
	ReconnectTimeout time.Duration

	// Rate limiting
	RateGeneral float64
	RateAuth    float64
	RateWS      float64

	// HTTP
	CORSAllowedOrigins []string // origini ammesse (pattern go-chi/cors, es. "https://*")
	TrustedProxies     []string // IP o CIDR dei reverse proxy di cui fidarsi per X-Forwarded-For

	// Environment
	Env string
}

// C è l'istanza globale della configurazione
var C *Config

func Load() {
	// Carica il file .env se esiste
	// Non è un errore fatale se non esiste (in produzione si usano variabili di sistema)
	if err := godotenv.Load(); err != nil {
		log.Println("Nessun file .env trovato, uso variabili di sistema")
	}

	C = &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "chessuser"),
		DBPassword: getEnv("DB_PASSWORD", ""),
		DBName:     getEnv("DB_NAME", "chessdb"),
		DBSSLMode:  getEnv("DB_SSLMODE", "disable"),

		JWTSecret: getEnv("JWT_SECRET", ""),

		ServerPort: getEnv("SERVER_PORT", "8080"),

		PhaseTimeMain:    getDuration("PHASE_TIME_MAIN", 90*time.Second),
		PhaseTimeMove:    getDuration("PHASE_TIME_MOVE", 120*time.Second),
		ReconnectTimeout: getDuration("RECONNECT_TIMEOUT", 30*time.Second),

		RateGeneral: getFloat("RATE_GENERAL", 10),
		RateAuth:    getFloat("RATE_AUTH", 3),
		RateWS:      getFloat("RATE_WS", 1),

		CORSAllowedOrigins: getList("CORS_ALLOWED_ORIGINS",
			[]string{"https://*", "http://*", "capacitor://localhost"}),
		TrustedProxies: getList("TRUSTED_PROXIES", nil),

		Env: getEnv("ENV", "development"),
	}

	// JWT secret è obbligatorio
	if C.JWTSecret == "" {
		log.Fatal("JWT_SECRET non impostato — imposta la variabile d'ambiente")
	}

	log.Println("Configurazione caricata!")
}

// getEnv legge una variabile d'ambiente con un valore di default
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// getDuration legge una durata (es. "10m", "5s") con un valore di default
func getDuration(key string, defaultVal time.Duration) time.Duration {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	d, err := time.ParseDuration(val)
	if err != nil {
		log.Printf("Valore non valido per %s: %s, uso default %v", key, val, defaultVal)
		return defaultVal
	}
	return d
}

func getFloat(key string, defaultVal float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	var f float64
	if _, err := fmt.Sscanf(val, "%f", &f); err != nil {
		log.Printf("Valore non valido per %s: %s, uso default %v", key, val, defaultVal)
		return defaultVal
	}
	return f
}

// getList legge una lista separata da virgole (spazi ignorati) con un default.
func getList(key string, defaultVal []string) []string {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	var out []string
	for _, item := range strings.Split(val, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}
