package game

import (
	"chess-server/internal/bot"
	"chess-server/internal/config"
	"chess-server/internal/db"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"encoding/json"
	mrand "math/rand/v2"
	"testing"
	"time"
)

// botSetup prepara manager, configurazione e account dei bot (senza DB: id -1,
// -2, -3) e sostituisce le dipendenze del bot. Con la pausa di un'ora il bot
// non agisce da solo: i test chiamano act quando serve.
func botSetup(t *testing.T) {
	t.Helper()
	resetManager()
	config.C = &config.Config{DefaultBaseTime: 10 * time.Minute, DefaultIncrement: 5 * time.Second, ReconnectTimeout: time.Minute}
	if err := db.EnsureBotAccounts(bot.LevelNames()); err != nil {
		t.Fatal(err)
	}
	prevAvailable, prevEngine, prevDelay := botAvailable, botEngine, botDelay
	botAvailable = func() bool { return true }
	botEngine = func() bot.Engine { return nil }
	botDelay = func(*mrand.Rand) time.Duration { return time.Hour }
	t.Cleanup(func() {
		endBotRooms()
		botAvailable, botEngine, botDelay = prevAvailable, prevEngine, prevDelay
	})
}

// endBotRooms chiude le partite create dal test: si fermano i timer e i bot
// ricevono game_over, così nessun bot resta ad agire nei test successivi.
func endBotRooms() {
	GameManager.mu.Lock()
	rooms := make([]*Room, 0, len(GameManager.rooms))
	for _, r := range GameManager.rooms {
		rooms = append(rooms, r)
	}
	GameManager.mu.Unlock()
	for _, r := range rooms {
		r.mu.Lock()
		end := r.finishLocked(models.ResultDraw, "agreement", StatusDraw)
		r.mu.Unlock()
		r.announceEnd(end)
	}
}

// playerOf legge white_player o black_player dal primo game_state.
func playerOf(t *testing.T, msgs []models.WSMessage, side string) playerInfo {
	t.Helper()
	var p playerInfo
	if err := json.Unmarshal(gameStateOf(t, msgs)[side], &p); err != nil {
		t.Fatalf("%s non valido: %v", side, err)
	}
	return p
}

func TestJoinBot_ColorChosenByThePlayer(t *testing.T) {
	botSetup(t)
	human := newTestClient(1, "alice")
	if GameManager.JoinBot(human, "intermediate", "white") {
		t.Fatal("non è una riconnessione")
	}
	room := human.Room
	if room == nil || room.White != human || room.Black.UserID != -2 {
		t.Fatalf("il giocatore col bianco contro il bot intermedio (id -2): %+v", room)
	}
	if !room.Friendly || room.Bot == nil || room.Bot.Level != bot.Intermediate || room.Bot.Color != match.PlayerBlack {
		t.Errorf("partita amichevole col bot nero: friendly=%v bot=%+v", room.Friendly, room.Bot)
	}
	msgs := drain(human)
	if p := playerOf(t, msgs, "black_player"); p.Bot != "intermediate" || p.Username != "#bot-intermediate" {
		t.Errorf("black_player = %+v, atteso il bot intermedio", p)
	}
	if p := playerOf(t, msgs, "white_player"); p.Bot != "" {
		t.Errorf("white_player = %+v, il giocatore non è un bot", p)
	}

	other := newTestClient(2, "bob")
	GameManager.JoinBot(other, "advanced", "black")
	if other.Room.Black != other || other.Room.Bot.Color != match.PlayerWhite || other.Room.White.UserID != -3 {
		t.Errorf("col nero il bot avanzato ha il bianco: %+v", other.Room.Bot)
	}
}

// Lo stesso bot gioca più partite insieme e non è mai «in partita».
func TestJoinBot_ParallelGamesSameLevel(t *testing.T) {
	botSetup(t)
	a, b := newTestClient(1, "alice"), newTestClient(2, "bob")
	GameManager.JoinBot(a, "base", "white")
	GameManager.JoinBot(b, "base", "white")
	if a.Room == nil || b.Room == nil || a.Room == b.Room {
		t.Fatal("due partite distinte contro il bot base")
	}
	if GameManager.userRooms[a.UserID] != a.Room.ID || GameManager.userRooms[b.UserID] != b.Room.ID {
		t.Error("le partite vanno registrate per i giocatori")
	}
	if _, ok := GameManager.userRooms[-1]; ok {
		t.Error("il bot non va registrato come giocatore in partita")
	}
	for _, id := range GameManager.PlayingIDs() {
		if id < 0 {
			t.Errorf("il bot (%d) non compare fra chi sta giocando", id)
		}
	}
	// Una seconda connessione dello stesso giocatore riprende la sua partita.
	again := newTestClient(1, "alice")
	if !GameManager.JoinBot(again, "advanced", "black") {
		t.Error("con una partita in corso è una riconnessione")
	}
}

func TestJoinBot_Unavailable(t *testing.T) {
	botSetup(t)
	unknown := newTestClient(1, "alice")
	GameManager.JoinBot(unknown, "grandmaster", "white")
	if unknown.Room != nil || lastErrorCode(t, drain(unknown)) != string(gameerr.BotUnavailable) {
		t.Error("livello sconosciuto: bot_unavailable, nessuna partita")
	}
	botAvailable = func() bool { return false }
	noEngine := newTestClient(2, "bob")
	GameManager.JoinBot(noEngine, "base", "white")
	if noEngine.Room != nil || lastErrorCode(t, drain(noEngine)) != string(gameerr.BotUnavailable) {
		t.Error("motore del bot spento: bot_unavailable, nessuna partita")
	}
}

// testDriver è un bot sul lato bianco di una room di test, senza goroutine.
func testDriver(room *Room, level bot.Level) *botDriver {
	room.Bot = &botSeat{Level: level, Color: match.PlayerWhite}
	return &botDriver{
		room:     room,
		client:   room.White,
		level:    level,
		color:    match.PlayerWhite,
		rng:      mrand.New(mrand.NewPCG(1, 2)),
		rejected: map[string]bool{},
	}
}

func inMain1(room *Room, hand []string, mana int) {
	room.Match.ActivePlayer, room.Match.CurrentPhase = match.PlayerWhite, phase.PhaseMain1
	room.Match.White.Hand, room.Match.White.Mana = hand, mana
}

func TestBotDriver_PassesWithoutUsefulSpells(t *testing.T) {
	botSetup(t)
	room, _, _ := newTestRoom(startFEN)
	d := testDriver(room, bot.Advanced)
	inMain1(room, []string{"shield"}, 5) // nessun pezzo minacciato: lo scudo non serve
	d.act()
	if room.Match.CurrentPhase != phase.PhaseMove {
		t.Errorf("fase = %s, il bot doveva passare alla move", room.Match.CurrentPhase)
	}
}

func TestBotDriver_CastsUsefulSpell(t *testing.T) {
	botSetup(t)
	// La torre bianca in a1 è minacciata dall'alfiere nero in h8.
	room, _, _ := newTestRoom("4k2b/7p/8/8/8/8/4P3/R3K3 w - - 0 1")
	d := testDriver(room, bot.Intermediate)
	inMain1(room, []string{"shield"}, 5)
	d.act()
	if !room.Tracker.HasShield("a1") {
		t.Error("il bot doveva proteggere la torre minacciata")
	}
	if len(room.Match.White.Hand) != 0 || room.Match.White.Mana != 3 {
		t.Errorf("mano %v, mana %d: la carta va giocata e pagata", room.Match.White.Hand, room.Match.White.Mana)
	}
}

// Una magia rifiutata dal server non si ritenta: alla volta dopo il bot passa.
func TestBotDriver_RejectedSpellNotRetried(t *testing.T) {
	botSetup(t)
	// Marcia forzata su d6 darebbe scacco al re in e8: il server la rifiuta.
	room, _, _ := newTestRoom("4k3/8/3P4/8/8/8/8/4K3 w - - 0 1")
	d := testDriver(room, bot.Intermediate)
	inMain1(room, []string{"forced_march"}, 3)
	d.act()
	if room.Match.CurrentPhase != phase.PhaseMain1 || !d.rejected["forced_march"] {
		t.Fatalf("fase %s, rifiutate %v: la magia rifiutata va ricordata", room.Match.CurrentPhase, d.rejected)
	}
	d.act()
	if room.Match.CurrentPhase != phase.PhaseMove {
		t.Errorf("fase = %s, dopo il rifiuto il bot passa", room.Match.CurrentPhase)
	}
}

// Il bot non accetta patte.
func TestBotDriver_DeclinesDraws(t *testing.T) {
	botSetup(t)
	botDelay = func(*mrand.Rand) time.Duration { return time.Millisecond }
	human := newTestClient(1, "alice")
	GameManager.JoinBot(human, "base", "white")
	room := human.Room
	drain(human)
	room.handleDrawOffer(human)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		room.mu.Lock()
		pending := room.drawOfferer != nil
		room.mu.Unlock()
		if !pending {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Error("l'offerta di patta doveva essere rifiutata")
}

// Una room contro il bot ripristinata dal DB ritrova il bot, che non è
// registrato come giocatore.
func TestBotRestoredFromSnapshot(t *testing.T) {
	botSetup(t)
	human := newTestClient(1, "alice")
	GameManager.JoinBot(human, "advanced", "white")
	snap := human.Room.buildSnapshot()
	if snap.Bot == nil || snap.Bot.Level != bot.Advanced || snap.Bot.Color != match.PlayerBlack {
		t.Fatalf("lo snapshot deve salvare il bot: %+v", snap.Bot)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	var back roomSnapshot
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}

	endBotRooms() // la room originale non deve restare attiva dopo il reset del manager
	resetManager()
	room := roomFromSnapshot(back)
	if room.Bot == nil || room.botLevelOf(match.PlayerBlack) != "advanced" {
		t.Errorf("il bot va ripristinato: %+v", room.Bot)
	}
	if !room.Friendly {
		t.Error("resta amichevole")
	}
}
