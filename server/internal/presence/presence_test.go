package presence

import (
	"testing"
	"time"
)

func TestTracker_Window(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	tr := New(func() time.Time { return now })

	if tr.Online(1) {
		t.Fatal("senza segnali nessuno è online")
	}
	tr.Touch(1)
	now = now.Add(Window)
	if !tr.Online(1) {
		t.Fatal("entro Window l'utente è online")
	}
	if ids := tr.OnlineIDs(); len(ids) != 1 || ids[0] != 1 {
		t.Fatalf("OnlineIDs = %v", ids)
	}

	now = now.Add(time.Second)
	if tr.Online(1) {
		t.Fatal("dopo Window l'utente è offline")
	}
	if ids := tr.OnlineIDs(); len(ids) != 0 {
		t.Fatalf("OnlineIDs = %v, atteso vuoto", ids)
	}

	// Il segnale successivo toglie le voci scadute e rimette online.
	tr.Touch(2)
	if _, ok := tr.seen[1]; ok {
		t.Error("la voce scaduta va tolta")
	}
	tr.Touch(1)
	if !tr.Online(1) || !tr.Online(2) {
		t.Error("dopo un nuovo segnale l'utente torna online")
	}
}
