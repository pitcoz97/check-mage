package db

import (
	"fmt"
	"sync"
)

// Account dei bot avversari: uno per livello, servono solo come giocatori delle
// partite salvate (le chiavi esterne di games). Non sono registrabili (# e -
// non passano la validazione), non possono entrare (password vuota, email
// .invalid) e sono nascosti da ogni elenco: classifica, profilo, ricerca, amici
// (bot_level IS NULL).

// BotUsername è il nome dell'account del bot di un livello.
func BotUsername(level string) string {
	return "#bot-" + level
}

// EnsureBotSchema aggiunge a users la colonna del livello dei bot.
func EnsureBotSchema() error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_level VARCHAR(16)`)
	return err
}

var (
	botMu  sync.RWMutex
	botIDs = map[string]int{}
)

// EnsureBotAccounts crea gli account dei bot che mancano e ne ricorda gli id.
// Senza DB (test) gli id sono fissi e negativi, così non collidono con gli
// utenti veri: -1, -2, … nell'ordine di levels.
func EnsureBotAccounts(levels []string) error {
	for i, level := range levels {
		id := -(i + 1)
		if DB != nil {
			err := DB.QueryRow(`
				INSERT INTO users (username, email, password, bot_level)
				VALUES ($1, $2, '', $3)
				ON CONFLICT (username) DO UPDATE SET bot_level = EXCLUDED.bot_level
				RETURNING id`,
				BotUsername(level), fmt.Sprintf("bot-%s@bot.invalid", level), level,
			).Scan(&id)
			if err != nil {
				return fmt.Errorf("account del bot %s: %w", level, err)
			}
		}
		botMu.Lock()
		botIDs[level] = id
		botMu.Unlock()
	}
	return nil
}

// BotAccountID è l'id dell'account del bot di un livello; false se l'account
// non c'è (EnsureBotAccounts non chiamata o fallita).
func BotAccountID(level string) (int, bool) {
	botMu.RLock()
	defer botMu.RUnlock()
	id, ok := botIDs[level]
	return id, ok
}
