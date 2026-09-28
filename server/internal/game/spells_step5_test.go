package game

import (
	"encoding/json"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/gameerr"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

var restlessSoul = spells.Trigger{On: spells.TriggerOnOwnPieceLost, Do: spells.TriggerDoDrawCard, Amount: 1,
	RemainingTurns: 1, SourceSpellID: "restless_soul"}

var reflection = spells.Trigger{On: spells.TriggerOnShieldedAttacked, Do: spells.TriggerDoFreezeAttacker, Amount: 1,
	RemainingTurns: 1, Hidden: true, OneShot: true, SourceSpellID: "reflection"}

// Anima inquieta: si registra dal lancio e ripaga subito il proprio Patto di
// sangue (M48).
func TestRestlessSoul_CastAndOwnSacrifice(t *testing.T) {
	r := richRoom(startFEN)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "restless_soul"); err != nil {
		t.Fatalf("anima inquieta: %v", err)
	}
	if got := r.Match.White.Triggers; len(got) != 1 || got[0].RemainingTurns != 1 || got[0].Hidden {
		t.Fatalf("trigger registrato: %+v", got)
	}
	deck := len(r.Match.White.Deck)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "a2"); err != nil {
		t.Fatalf("patto di sangue: %v", err)
	}
	if len(r.Match.White.Deck) != deck-1 {
		t.Errorf("il sacrificio deve far pescare una carta: mazzo %d → %d", deck, len(r.Match.White.Deck))
	}

	poor := roomWithMana(startFEN)
	poor.Match.White.Mana = 1
	if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, "restless_soul"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMove, "restless_soul"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}
}

// Anima inquieta: a mazzo vuoto non pesca; scade dopo il turno avversario.
func TestRestlessSoul_EmptyDeckAndExpiry(t *testing.T) {
	r := richRoom(startFEN)
	r.Match.White.Triggers = []spells.Trigger{restlessSoul}
	r.Match.White.Deck = nil
	var ev eventLog
	r.onPieceLost(&ev, match.PlayerWhite, 2)
	if len(ev.draws) != 0 || len(ev.fired) != 1 || ev.fired[0].Result["count"] != 0 {
		t.Errorf("a mazzo vuoto nessuna pesca: %+v", ev)
	}

	newTurn := func(next match.Player) bool {
		var ev eventLog
		r.tickTriggers(&ev, []match.AdvanceResult{{NewTurn: true, ActivePlayer: next}})
		return ev.playerEffects
	}
	if newTurn(match.PlayerBlack) || len(r.Match.White.Triggers) != 1 {
		t.Fatal("la fine del turno di chi lancia non la fa scadere")
	}
	if !newTurn(match.PlayerWhite) || len(r.Match.White.Triggers) != 0 {
		t.Error("scade alla fine del turno avversario")
	}
}

// Anima inquieta: la cattura nel turno avversario fa pescare il proprietario,
// e la carta arriva solo a lui; una cattura assorbita dallo scudo no.
func TestRestlessSoul_CaptureInOpponentTurn(t *testing.T) {
	withStockfish(t)
	const fen = "4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1"
	r := richRoom(fen)
	r.Match.White.Triggers = []spells.Trigger{restlessSoul}
	msgs := moveIn(t, r, "d5e4")
	// La pesca d'inizio turno del Bianco può arrivare nello stesso passaggio: si
	// guarda il trigger, non il mazzo.
	if fired, ok := findMsg(msgs, models.MsgTriggerFired); !ok || fired["player"] != "white" ||
		fired["result"].(map[string]interface{})["count"] != float64(1) {
		t.Fatalf("trigger_fired a entrambi, con una carta pescata: %v", fired)
	}
	if _, ok := findMsg(msgs, models.MsgCardDrawn); ok {
		t.Error("chi ha catturato non riceve la carta pescata")
	}

	shielded := richRoom(fen)
	shielded.Match.White.Triggers = []spells.Trigger{restlessSoul}
	effects.ShieldPiece(shielded.Tracker, "e4", effects.White, 1, "shield")
	if _, ok := findMsg(moveIn(t, shielded, "d5e4"), models.MsgTriggerFired); ok {
		t.Error("la cattura assorbita dallo scudo non fa pescare")
	}
}

// Riflesso: il cast è nascosto all'avversario e il trigger non compare nel suo
// stato, nemmeno alla riconnessione (M46, M51).
func TestReflection_Hidden(t *testing.T) {
	r := richRoom("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
	r.Match.ActivePlayer, r.Match.CurrentPhase = match.PlayerWhite, phase.PhaseMain2
	r.Match.White.Hand = append(r.Match.White.Hand, "reflection", "frost")
	drain(r.White)
	drain(r.Black)
	r.handleCastSpell(r.White, "reflection", nil, spells.Choice{})
	own, opp := drain(r.White), drain(r.Black)

	if full, _ := findMsg(own, models.MsgSpellCast); full["spell_id"] != "reflection" {
		t.Errorf("il proprietario riceve lo spell_cast completo: %v", full)
	}
	if hidden, _ := findMsg(opp, models.MsgSpellCast); hidden["hidden"] != true || hidden["spell_id"] != nil {
		t.Errorf("spell_cast nascosto all'avversario: %v", hidden)
	}
	if list, ok := findMsg(own, models.MsgPlayerEffectsChanged); !ok || len(list["triggers"].([]interface{})) != 1 {
		t.Errorf("player_effects_changed del proprietario: %v", list)
	}
	if list, ok := findMsg(opp, models.MsgPlayerEffectsChanged); ok && len(list["triggers"].([]interface{})) != 0 {
		t.Errorf("player_effects_changed dell'avversario: %v", list)
	}
	if got := r.publicState(match.PlayerBlack)["triggers"].([]triggerView); len(got) != 0 {
		t.Errorf("game_state del Nero: %v", got)
	}
	if got := r.publicState(match.PlayerWhite)["triggers"].([]triggerView); len(got) != 1 || !got[0].Hidden {
		t.Errorf("game_state del Bianco: %v", got)
	}
	back := newTestClient(2, "bob")
	r.Reconnect(back)
	state, _ := findMsg(drain(back), models.MsgGameState)
	if list := state["triggers"].([]interface{}); len(list) != 0 {
		t.Errorf("game_state di riconnessione del Nero: %v", list)
	}
	r.closeTimerLocked()
}

// Riflesso: lo scudo assorbe, l'attaccante resta sulla sua casa ed è congelato
// per il suo turno successivo (M47); il trigger si consuma (M46).
func TestReflection_ShieldAbsorbs(t *testing.T) {
	withStockfish(t)
	r := richRoom("4k3/8/8/4p3/3N4/8/8/4K3 b - - 0 1")
	effects.ShieldPiece(r.Tracker, "d4", effects.White, 1, "shield")
	r.Match.White.Triggers = []spells.Trigger{reflection}
	msgs := moveIn(t, r, "e5d4")
	if !r.Tracker.IsFrozen("e5") {
		t.Fatal("l'attaccante resta in e5 ed è congelato")
	}
	if fired, ok := findMsg(msgs, models.MsgTriggerFired); !ok || fired["on"] != spells.TriggerOnShieldedAttacked {
		t.Errorf("trigger_fired: %v", fired)
	}
	if len(r.Match.White.Triggers) != 0 {
		t.Error("Riflesso scatta una volta sola")
	}
	// Durata 1 + il turno in corso (M47): 2 finché il Nero non chiude il turno, poi 1.
	want := 2
	if r.Match.ActivePlayer == match.PlayerWhite {
		want = 1
	}
	for _, info := range r.Tracker.ActiveEffects() {
		if info.Square == "e5" && info.Effects[0].RemainingTurns != want {
			t.Errorf("gelo: il turno in corso non conta (%d, atteso %d)", info.Effects[0].RemainingTurns, want)
		}
	}
}

// Riflesso: se lo scudo si rompe (la cattura era l'unico modo di uscire dallo
// scacco) la cattura avviene e il pezzo che ha catturato è congelato.
func TestReflection_ShieldBreaks(t *testing.T) {
	withStockfish(t)
	r := richRoom("3qkb2/2pppp2/3N4/8/8/8/8/4K3 b - - 0 1")
	effects.ShieldPiece(r.Tracker, "d6", effects.White, 1, "shield")
	r.Match.White.Triggers = []spells.Trigger{reflection}
	moveIn(t, r, "c7d6")
	if p, _ := effects.PieceAt(r.Board.FEN, "d6"); p != 'p' {
		t.Fatalf("la cattura avviene: %s", r.Board.FEN)
	}
	if !r.Tracker.IsFrozen("d6") {
		t.Error("il pedone che ha catturato è congelato")
	}
}

// Il re che prova a catturare un pezzo scudato non viene congelato: il trigger resta.
func TestReflection_KingIsNeverHit(t *testing.T) {
	r := richRoom("4k3/8/8/8/8/8/3N4/4K3 w - - 0 1")
	r.Match.Black.Triggers = []spells.Trigger{reflection}
	id, _, _ := r.Tracker.Info("e1")
	var ev eventLog
	r.onCaptureAttempt(&ev, match.PlayerWhite, id)
	if len(ev.fired) != 0 || len(r.Match.Black.Triggers) != 1 || r.Tracker.IsFrozen("e1") {
		t.Errorf("il re non è mai un bersaglio: %+v", ev)
	}
}

// Stendardo: l'aura si registra anche sotto soglia, si accende e si spegne con
// la soglia di 6 pedoni; il secondo Stendardo non ha effetto (M49).
func TestBanner_Aura(t *testing.T) {
	r := richRoom("4k3/8/8/8/8/8/PPPPPP2/4K3 w - - 0 1") // 6 pedoni
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "banner"); err != nil {
		t.Fatalf("stendardo: %v", err)
	}
	if got := r.Match.White.Auras; len(got) != 1 || !got[0].Active || got[0].MinOwnPawns != 6 {
		t.Fatalf("aura attiva con 6 pedoni: %+v", got)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "banner"); code(err) != gameerr.NoEffect || reasonOf(err) != "aura_present" {
		t.Errorf("secondo stendardo: %v", err)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blood_pact", "a2"); err != nil {
		t.Fatalf("patto di sangue: %v", err)
	}
	if r.Match.White.Auras[0].Active {
		t.Error("con 5 pedoni l'aura si spegne")
	}
	var ev eventLog
	r.Board.FEN = "4k3/8/8/8/8/8/PPPPPP2/4K3 w - - 0 1"
	r.refreshAuras(&ev)
	if !r.Match.White.Auras[0].Active || len(ev.auras) != 1 || !ev.auras[0].Active {
		t.Errorf("tornando a 6 pedoni si riaccende: %+v", ev.auras)
	}

	low := richRoom("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1")
	if err := castIn(low, match.PlayerWhite, phase.PhaseMain1, "banner"); err != nil || low.Match.White.Auras[0].Active {
		t.Errorf("sotto soglia l'aura si registra spenta: %v %+v", err, low.Match.White.Auras)
	}
	if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMove, "banner"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}
}

// Trigger e aure sopravvivono a salvataggio e ripristino.
func TestPlayerEffects_Snapshot(t *testing.T) {
	r := richRoom(startFEN)
	r.Match.White.Triggers = []spells.Trigger{reflection}
	r.Match.Black.Auras = []spells.Aura{{Grant: spells.AuraGrantPawnSidestep, MinOwnPawns: 6, Active: true, SourceSpellID: "banner"}}
	data, err := json.Marshal(r.buildSnapshot())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	back := roomFromSnapshot(snap)
	if got := back.Match.White.Triggers; len(got) != 1 || !got[0].Hidden || !got[0].OneShot {
		t.Errorf("trigger ripristinato: %+v", got)
	}
	if got := back.Match.Black.Auras; len(got) != 1 || !got[0].Active {
		t.Errorf("aura ripristinata: %+v", got)
	}
}
