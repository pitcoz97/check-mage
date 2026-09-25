package config

import (
	"os"
	"testing"
	"time"
)

func TestGetEnv(t *testing.T) {
	// Test con variabile esistente
	os.Setenv("TEST_KEY", "test_value")
	defer os.Unsetenv("TEST_KEY")

	val := getEnv("TEST_KEY", "default")
	if val != "test_value" {
		t.Errorf("getEnv() = %v, want %v", val, "test_value")
	}

	// Test con variabile non esistente (usa default)
	val = getEnv("NON_EXISTENT_KEY", "default")
	if val != "default" {
		t.Errorf("getEnv() = %v, want %v", val, "default")
	}
}

func TestGetDuration(t *testing.T) {
	// Test con variabile valida
	os.Setenv("TEST_DURATION", "5m")
	defer os.Unsetenv("TEST_DURATION")

	val := getDuration("TEST_DURATION", 10*time.Minute)
	if val != 5*time.Minute {
		t.Errorf("getDuration() = %v, want %v", val, 5*time.Minute)
	}

	// Test con variabile non esistente (usa default)
	val = getDuration("NON_EXISTENT", 10*time.Minute)
	if val != 10*time.Minute {
		t.Errorf("getDuration() = %v, want %v", val, 10*time.Minute)
	}

	// Test con valore non valido (usa default)
	os.Setenv("TEST_DURATION_INVALID", "invalid")
	defer os.Unsetenv("TEST_DURATION_INVALID")

	val = getDuration("TEST_DURATION_INVALID", 10*time.Minute)
	if val != 10*time.Minute {
		t.Errorf("getDuration() con valore non valido = %v, want %v", val, 10*time.Minute)
	}
}

func TestGetFloat(t *testing.T) {
	// Test con variabile valida
	os.Setenv("TEST_FLOAT", "10.5")
	defer os.Unsetenv("TEST_FLOAT")

	val := getFloat("TEST_FLOAT", 5.0)
	if val != 10.5 {
		t.Errorf("getFloat() = %v, want %v", val, 10.5)
	}

	// Test con variabile non esistente (usa default)
	val = getFloat("NON_EXISTENT", 5.0)
	if val != 5.0 {
		t.Errorf("getFloat() = %v, want %v", val, 5.0)
	}

	// Test con valore non valido (usa default)
	os.Setenv("TEST_FLOAT_INVALID", "not_a_number")
	defer os.Unsetenv("TEST_FLOAT_INVALID")

	val = getFloat("TEST_FLOAT_INVALID", 5.0)
	if val != 5.0 {
		t.Errorf("getFloat() con valore non valido = %v, want %v", val, 5.0)
	}
}

func TestLoad_DefaultValues(t *testing.T) {
	// Pulisce eventuali variabili d'ambiente esistenti
	varsToClear := []string{
		"DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME",
		"JWT_SECRET", "SERVER_PORT", "DEFAULT_BASE_TIME", "DEFAULT_INCREMENT",
		"RECONNECT_TIMEOUT", "RATE_GENERAL", "RATE_AUTH", "RATE_WS", "ENV",
	}

	for _, v := range varsToClear {
		os.Unsetenv(v)
	}

	// Imposta solo JWT_SECRET che è obbligatorio
	os.Setenv("JWT_SECRET", "test-secret")
	defer os.Unsetenv("JWT_SECRET")

	// Deve fare panic se JWT_SECRET è vuoto, quindi testiamo con un valore
	Load()

	if C == nil {
		t.Fatal("Config non inizializzata")
	}

	// Verifica valori di default
	if C.DBHost != "localhost" {
		t.Errorf("DBHost = %v, want %v", C.DBHost, "localhost")
	}
	if C.DBPort != "5432" {
		t.Errorf("DBPort = %v, want %v", C.DBPort, "5432")
	}
	if C.DefaultBaseTime != 10*time.Minute {
		t.Errorf("DefaultBaseTime = %v, want %v", C.DefaultBaseTime, 10*time.Minute)
	}
}
