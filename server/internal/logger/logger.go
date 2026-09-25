package logger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// L è l'istanza globale del logger
var L *zap.Logger

func Init(env string) error {
	var cfg zap.Config

	if env == "production" {
		// Produzione: JSON compatto, solo Warning e superiori
		cfg = zap.NewProductionConfig()
		cfg.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	} else {
		// Sviluppo: output leggibile, tutti i livelli
		cfg = zap.NewDevelopmentConfig()
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}

	var err error
	L, err = cfg.Build()
	if err != nil {
		return err
	}

	return nil
}

// Sync scarica i buffer del logger — va chiamato prima di uscire
func Sync() {
	if L != nil {
		L.Sync()
	}
}
