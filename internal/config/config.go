package config

import (
	"fmt"
	"log"
	"os"
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

	// JWT
	JWTSecret string

	// Server
	ServerPort string

	// Game
	DefaultBaseTime  time.Duration
	DefaultIncrement time.Duration
	ReconnectTimeout time.Duration

	// Rate limiting
	RateGeneral float64
	RateAuth    float64
	RateWS      float64

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

		JWTSecret: getEnv("JWT_SECRET", ""),

		ServerPort: getEnv("SERVER_PORT", "8080"),

		DefaultBaseTime:  getDuration("DEFAULT_BASE_TIME", 10*time.Minute),
		DefaultIncrement: getDuration("DEFAULT_INCREMENT", 5*time.Second),
		ReconnectTimeout: getDuration("RECONNECT_TIMEOUT", 30*time.Second),

		RateGeneral: getFloat("RATE_GENERAL", 10),
		RateAuth:    getFloat("RATE_AUTH", 3),
		RateWS:      getFloat("RATE_WS", 1),

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
