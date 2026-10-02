package db

import "testing"

func TestBotAccountsWithoutDB(t *testing.T) {
	if DB != nil {
		t.Skip("test senza DB")
	}
	if err := EnsureBotAccounts([]string{"base", "intermediate", "advanced"}); err != nil {
		t.Fatalf("EnsureBotAccounts: %v", err)
	}
	for level, want := range map[string]int{"base": -1, "intermediate": -2, "advanced": -3} {
		if id, ok := BotAccountID(level); !ok || id != want {
			t.Errorf("BotAccountID(%s) = %d %v, atteso %d", level, id, ok, want)
		}
	}
	if _, ok := BotAccountID("grandmaster"); ok {
		t.Error("un livello sconosciuto non ha un account")
	}
	if got := BotUsername("base"); got != "#bot-base" {
		t.Errorf("BotUsername = %q", got)
	}
}
