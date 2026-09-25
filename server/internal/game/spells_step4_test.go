package game

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"

	"chess-server/internal/effects"
	"chess-server/internal/engine"
	"chess-server/internal/gameerr"
	"chess-server/internal/logger"
	"chess-server/internal/match"
	"chess-server/internal/models"
	"chess-server/internal/phase"
	"chess-server/internal/spells"
)

// withStockfish avvia Stockfish per i test che passano da handleMove; senza
// Stockfish il test viene saltato.
func withStockfish(t *testing.T) {
	t.Helper()
	if engine.SF != nil {
		return
	}
	if _, err := exec.LookPath("stockfish"); err != nil {
		t.Skip("Stockfish non installato")
	}
	if logger.L == nil {
		_ = logger.Init("test")
	}
	if err := engine.Init(); err != nil {
		engine.SF = nil
		t.Skipf("Stockfish non avviabile: %v", err)
	}
}

// moveIn gioca una mossa con handleMove per il lato al tratto della FEN, messo
// nella fase move, e restituisce i messaggi ricevuti da chi muove. Fallisce se
// la mossa è rifiutata.
func moveIn(t *testing.T, r *Room, move string) []models.WSMessage {
	t.Helper()
	resetManager()
	p := match.Player(sideToMove(r.Board.FEN))
	r.Match.ActivePlayer, r.Match.CurrentPhase = p, phase.PhaseMove
	r.Board.Turn = string(p)
	drain(r.White)
	drain(r.Black)
	r.handleMove(r.clientOf(p), move)
	msgs := drain(r.clientOf(p))
	for _, m := range msgs {
		if m.Type == models.MsgError {
			t.Fatalf("mossa %s rifiutata: %s", move, m.Payload)
		}
	}
	return msgs
}

// runeRoom è una room con 10 mana e una runa del proprietario già piazzata.
func runeRoom(fen, square string, owner effects.Color, spec effects.RuneSpec) *Room {
	r := richRoom(fen)
	r.Tracker.AddRune(square, owner, spec, "test_rune")
	return r
}

var (
	stasisSpec    = effects.RuneSpec{OnEnter: effects.RuneFreeze, Duration: 2}
	repelSpec     = effects.RuneSpec{OnEnter: effects.RuneReturn}
	explosiveSpec = effects.RuneSpec{OnEnter: effects.RuneDestroy, Only: []string{"pawn", "knight", "bishop"},
		Fallback: effects.RuneFreeze, FallbackDuration: 1}
)

func findMsg(msgs []models.WSMessage, typ string) (map[string]interface{}, bool) {
	for _, m := range msgs {
		if m.Type == typ {
			var p map[string]interface{}
			_ = json.Unmarshal(m.Payload, &p)
			return p, true
		}
	}
	return nil, false
}

// Ogni runa: cast valido (runa nascosta, FEN invariata), bersaglio non valido,
// mana insufficiente, fase sbagliata.
func TestRuneSpells_Cast(t *testing.T) {
	cases := []struct {
		id      string
		targets []string
		onEnter string
		cost    int
	}{
		{"stasis_rune", []string{"e5"}, effects.RuneFreeze, 2},
		{"repel_rune", []string{"e5"}, effects.RuneReturn, 2},
		{"explosive_rune", []string{"e5"}, effects.RuneDestroy, 3},
		{"minefield", []string{"c5", "e5", "g5"}, effects.RuneFreeze, 7},
	}
	for _, c := range cases {
		r := richRoom(startFEN)
		if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, c.id, c.targets...); err != nil {
			t.Fatalf("%s: %v", c.id, err)
		}
		for _, sq := range c.targets {
			rn, ok := r.Tracker.RuneAt(sq, effects.White)
			if !ok || !rn.Hidden || rn.Rune.OnEnter != c.onEnter || rn.SourceSpellID != c.id {
				t.Errorf("%s: runa in %s = %+v", c.id, sq, rn)
			}
		}
		if r.Board.FEN != startFEN || r.Match.White.Mana != 10-c.cost {
			t.Errorf("%s: FEN invariata e mana %d: %s, %d", c.id, 10-c.cost, r.Board.FEN, r.Match.White.Mana)
		}

		bad := append([]string{}, c.targets...)
		bad[0] = "e2"
		if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMain1, c.id, bad...); reasonOf(err) != effects.ReasonNotEmpty {
			t.Errorf("%s su una casa occupata: %v", c.id, err)
		}
		poor := richRoom(startFEN)
		poor.Match.White.Mana = c.cost - 1
		if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, c.id, c.targets...); code(err) != gameerr.InsufficientMana {
			t.Errorf("%s: mana insufficiente: %v", c.id, err)
		}
		if err := castIn(richRoom(startFEN), match.PlayerWhite, phase.PhaseMove, c.id, c.targets...); code(err) != gameerr.WrongPhase {
			t.Errorf("%s: fase sbagliata: %v", c.id, err)
		}
	}
}

// Una casa con una runa resta vuota per i bersagli (M39): ci si fa sopra un muro
// o un'altra runa; una seconda runa propria sostituisce la prima, quella
// avversaria convive. Una casa col muro invece non è vuota.
func TestRunes_SquareStaysEmpty(t *testing.T) {
	r := richRoom(startFEN)
	castIn(r, match.PlayerWhite, phase.PhaseMain1, "stasis_rune", "e5")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "repel_rune", "e5"); err != nil {
		t.Fatalf("seconda runa propria: %v", err)
	}
	if rn, _ := r.Tracker.RuneAt("e5", effects.White); rn.Rune.OnEnter != effects.RuneReturn {
		t.Errorf("la seconda runa sostituisce la prima: %+v", rn.Rune)
	}
	if err := castIn(r, match.PlayerBlack, phase.PhaseMain1, "stasis_rune", "e5"); err != nil {
		t.Fatalf("runa avversaria sulla stessa casa: %v", err)
	}
	if err := castIn(r, match.PlayerBlack, phase.PhaseMain1, "ice_wall", "e5"); err != nil {
		t.Errorf("muro su una casa con le rune: %v", err)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "stasis_rune", "e5"); reasonOf(err) != effects.ReasonWall {
		t.Errorf("runa su un muro: %v", err)
	}
	if len(r.Tracker.SquareEffects()[0].Effects) != 3 {
		t.Errorf("muro e due rune: %+v", r.Tracker.SquareEffects())
	}
}

// L'avversario non riceve la runa nascosta: né in game_state (anche nella
// riconnessione) né in square_effects_changed; il suo spell_cast non ha carta né
// bersagli (M42). Il proprietario riceve tutto.
func TestRunes_HiddenFromOpponent(t *testing.T) {
	// Il Bianco lancia in main2: il Nero è al tratto, così il cast non interroga Stockfish.
	r := richRoom("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
	r.Match.ActivePlayer, r.Match.CurrentPhase = match.PlayerWhite, phase.PhaseMain2
	r.Match.White.Hand = append(r.Match.White.Hand, "stasis_rune", "frost")
	drain(r.White)
	drain(r.Black)
	r.handleCastSpell(r.White, "stasis_rune", []string{"e5"}, spells.Choice{})
	own, opp := drain(r.White), drain(r.Black)

	full, _ := findMsg(own, models.MsgSpellCast)
	if full["spell_id"] != "stasis_rune" || full["hidden"] != nil {
		t.Errorf("il proprietario riceve lo spell_cast completo: %v", full)
	}
	hidden, ok := findMsg(opp, models.MsgSpellCast)
	if !ok || hidden["hidden"] != true || hidden["player"] != "white" {
		t.Fatalf("spell_cast nascosto: %v", hidden)
	}
	if _, has := hidden["spell_id"]; has {
		t.Error("lo spell_cast nascosto non ha spell_id")
	}
	if _, has := hidden["targets"]; has {
		t.Error("lo spell_cast nascosto non ha bersagli")
	}
	if effs := hidden["effects_applied"].([]interface{}); len(effs) != 1 || effs[0].(map[string]interface{})["kind"] != "hidden_effect" {
		t.Errorf("effects_applied nascosto: %v", effs)
	}
	for _, m := range opp {
		if m.Type != models.MsgSpellCast && containsSquare(m.Payload, "e5") {
			t.Errorf("%s all'avversario contiene la runa: %s", m.Type, m.Payload)
		}
	}
	if sq, ok := findMsg(own, models.MsgSquareEffectsChanged); !ok || len(sq["square_effects"].([]interface{})) != 1 {
		t.Errorf("square_effects_changed del proprietario: %v", sq)
	}
	if sq, ok := findMsg(opp, models.MsgSquareEffectsChanged); ok && len(sq["square_effects"].([]interface{})) != 0 {
		t.Errorf("square_effects_changed dell'avversario: %v", sq)
	}
	if got := r.publicState(match.PlayerBlack)["square_effects"].([]effects.SquareEffectInfo); len(got) != 0 {
		t.Errorf("game_state del Nero: %v", got)
	}
	if got := r.publicState(match.PlayerWhite)["square_effects"].([]effects.SquareEffectInfo); len(got) != 1 {
		t.Errorf("game_state del Bianco: %v", got)
	}

	// Riconnessione del Nero: niente runa.
	back := newTestClient(2, "bob")
	r.Reconnect(back)
	state, _ := findMsg(drain(back), models.MsgGameState)
	if list := state["square_effects"].([]interface{}); len(list) != 0 {
		t.Errorf("game_state di riconnessione del Nero: %v", list)
	}
	r.closeTimerLocked()
}

// containsSquare dice se un payload JSON nomina la casa.
func containsSquare(payload json.RawMessage, square string) bool {
	return strings.Contains(string(payload), `"`+square+`"`)
}

// Rivelazione: le rune nemiche esistenti diventano visibili per sempre, quelle
// piazzate dopo no; si pesca una carta.
func TestRevelation(t *testing.T) {
	r := richRoom(startFEN)
	castIn(r, match.PlayerWhite, phase.PhaseMain1, "stasis_rune", "e5")
	hand, deck := len(r.Match.Black.Hand), len(r.Match.Black.Deck)
	if err := castIn(r, match.PlayerBlack, phase.PhaseMain1, "revelation"); err != nil {
		t.Fatalf("rivelazione: %v", err)
	}
	// castIn mette la carta in mano: esce la Rivelazione, entra la carta pescata.
	if len(r.Match.Black.Deck) != deck-1 || len(r.Match.Black.Hand) != hand+1 {
		t.Errorf("pesca una carta: mano %d→%d, mazzo %d→%d",
			hand, len(r.Match.Black.Hand), deck, len(r.Match.Black.Deck))
	}
	if got := r.squareEffects(match.PlayerBlack); len(got) != 1 || got[0].Effects[0].Hidden {
		t.Errorf("il Nero vede la runa rivelata: %+v", got)
	}
	castIn(r, match.PlayerWhite, phase.PhaseMain1, "stasis_rune", "d5")
	if got := r.squareEffects(match.PlayerBlack); len(got) != 1 || got[0].Square != "e5" {
		t.Errorf("la runa nuova è di nuovo nascosta: %+v", got)
	}
	if err := castIn(r, match.PlayerBlack, phase.PhaseMove, "revelation"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}
	poor := richRoom(startFEN)
	poor.Match.Black.Mana = 0
	if err := castIn(poor, match.PlayerBlack, phase.PhaseMain1, "revelation"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
}

// Detonazione: congela i nemici attorno a ogni propria runa (non il re), consuma
// le rune; senza rune è no_effect. Poi Frantumare sul pezzo congelato.
func TestDetonation(t *testing.T) {
	r := richRoom("4k3/8/8/3n4/8/8/3P4/4K3 w - - 0 1")
	r.Tracker.AddRune("e3", effects.White, stasisSpec, "stasis_rune") // accanto al proprio pedone in d2
	r.Tracker.AddRune("e6", effects.White, stasisSpec, "stasis_rune") // accanto al cavallo nero in d5
	r.Tracker.AddRune("d4", effects.Black, stasisSpec, "stasis_rune")

	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "detonation"); err != nil {
		t.Fatalf("detonazione: %v", err)
	}
	if !r.Tracker.IsFrozen("d5") {
		t.Error("il cavallo nero in d5, accanto alla runa in e6, è congelato")
	}
	if r.Tracker.IsFrozen("d2") || r.Tracker.IsFrozen("e1") {
		t.Error("i pezzi propri non si congelano")
	}
	if len(r.Tracker.RunesOf(effects.White)) != 0 || len(r.Tracker.RunesOf(effects.Black)) != 1 {
		t.Errorf("consuma solo le proprie rune: %+v", r.Tracker.SquareEffects())
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "shatter", "d5"); err != nil {
		t.Errorf("Detonazione → Frantumare: %v", err)
	}

	// Il re accanto alla runa non si congela; senza nemici attorno le rune si consumano comunque.
	r = richRoom(kingsOnly)
	r.Tracker.AddRune("e7", effects.White, stasisSpec, "stasis_rune")
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "detonation"); err != nil {
		t.Fatalf("detonazione accanto al re: %v", err)
	}
	if r.Tracker.IsFrozen("e8") || len(r.Tracker.RunesOf(effects.White)) != 0 {
		t.Error("il re non si congela e la runa si consuma")
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "detonation"); code(err) != gameerr.NoEffect || reasonOf(err) != effects.ReasonNoRunes {
		t.Errorf("senza rune: %v", err)
	}
	if r.Match.White.Mana != 6 {
		t.Errorf("il cast rifiutato non costa mana: %d", r.Match.White.Mana)
	}
	if err := castIn(r, match.PlayerWhite, phase.PhaseMove, "detonation"); code(err) != gameerr.WrongPhase {
		t.Errorf("fase sbagliata: %v", err)
	}
	poor := richRoom(kingsOnly)
	poor.Match.White.Mana = 3
	if err := castIn(poor, match.PlayerWhite, phase.PhaseMain1, "detonation"); code(err) != gameerr.InsufficientMana {
		t.Errorf("mana insufficiente: %v", err)
	}
}

// Un pezzo arrivato per magia non fa scattare la runa (M34).
func TestRunes_NotTriggeredBySpells(t *testing.T) {
	r := runeRoom("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1", "c3", effects.Black, stasisSpec)
	if err := castIn(r, match.PlayerWhite, phase.PhaseMain1, "blink", "b1", "c3"); err != nil {
		t.Fatalf("blink sulla runa: %v", err)
	}
	if r.Tracker.IsFrozen("c3") {
		t.Error("il cavallo arrivato per magia non si congela")
	}
	if _, ok := r.Tracker.RuneAt("c3", effects.Black); !ok {
		t.Error("la runa resta")
	}
}

// Runa di stasi: scatta col pezzo nemico che entra muovendo, lo congela per i
// suoi 2 turni successivi e si consuma; rune_triggered va a entrambi.
func TestStasisRune_Trigger(t *testing.T) {
	withStockfish(t)
	r := runeRoom("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "e5", effects.White, stasisSpec)

	msgs := moveIn(t, r, "e7e5")
	if !r.Tracker.IsFrozen("e5") {
		t.Fatal("il pedone nero entrato in e5 è congelato")
	}
	if _, ok := r.Tracker.RuneAt("e5", effects.White); ok {
		t.Error("la runa si consuma")
	}
	trig, ok := findMsg(msgs, models.MsgRuneTriggered)
	if !ok || trig["square"] != "e5" || trig["owner"] != "white" || trig["on_enter"] != effects.RuneFreeze {
		t.Fatalf("rune_triggered: %v", trig)
	}
	if res := trig["result"].(map[string]interface{}); res["kind"] != effects.RuneFreeze || res["target"] != "e5" || res["remaining_turns"] != 3.0 {
		t.Errorf("result: %v", res)
	}
	if _, ok := findMsg(drain(r.White), models.MsgRuneTriggered); !ok {
		t.Error("anche il proprietario riceve rune_triggered")
	}
	// Il turno in corso del Nero non conta: congelato nei suoi 2 turni successivi.
	for i, finishing := range []effects.Color{effects.Black, effects.White, effects.Black, effects.White} {
		r.Tracker.TickTurnEnd(finishing)
		if !r.Tracker.IsFrozen("e5") {
			t.Fatalf("scongelato troppo presto (tick %d)", i)
		}
	}
	r.Tracker.TickTurnEnd(effects.Black)
	if r.Tracker.IsFrozen("e5") {
		t.Error("dopo 2 turni del Nero il gelo scade")
	}
}

// La runa non scatta coi propri pezzi né col re (M36); scatta con una cattura,
// con l'en passant e con la torre dell'arrocco.
func TestRunes_WhoTriggers(t *testing.T) {
	withStockfish(t)

	r := runeRoom(startFEN, "e4", effects.White, stasisSpec)
	moveIn(t, r, "e2e4")
	if r.Tracker.IsFrozen("e4") || len(r.Tracker.RunesOf(effects.White)) != 1 {
		t.Error("il proprio pedone non fa scattare la runa")
	}

	r = runeRoom("4k3/8/8/8/8/8/8/4K3 b - - 0 1", "e7", effects.White, stasisSpec)
	moveIn(t, r, "e8e7")
	if r.Tracker.IsFrozen("e7") || len(r.Tracker.RunesOf(effects.White)) != 1 {
		t.Error("il re non fa scattare la runa e la runa resta")
	}

	// Cattura: il pedone nero prende in d5, dove c'è una runa del Bianco.
	r = runeRoom("4k3/8/4p3/3P4/8/8/8/4K3 b - - 0 1", "d5", effects.White, stasisSpec)
	moveIn(t, r, "e6d5")
	if !r.Tracker.IsFrozen("d5") || len(r.Tracker.RunesOf(effects.White)) != 0 {
		t.Error("la cattura fa scattare la runa")
	}

	// En passant: il pedone bianco entra in d6.
	r = runeRoom("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "d6", effects.Black, stasisSpec)
	moveIn(t, r, "e5d6")
	if !r.Tracker.IsFrozen("d6") {
		t.Error("l'en passant fa scattare la runa")
	}

	// Arrocco: entra la torre, non il re.
	r = runeRoom("r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1", "f8", effects.White, stasisSpec)
	r.Tracker.AddRune("g8", effects.White, stasisSpec, "stasis_rune")
	moveIn(t, r, "e8g8")
	if !r.Tracker.IsFrozen("f8") || r.Tracker.IsFrozen("g8") {
		t.Error("nell'arrocco scatta la runa della torre, non quella del re")
	}
	if _, ok := r.Tracker.RuneAt("g8", effects.White); !ok {
		t.Error("la runa sotto il re resta")
	}
}

// Runa esplosiva: distrugge pedoni e pezzi minori (nel cimitero), congela torre
// e regina; su un santuario congela invece di distruggere.
func TestExplosiveRune(t *testing.T) {
	withStockfish(t)

	r := runeRoom("4k3/8/8/8/8/8/3N4/4K3 w - - 0 1", "e4", effects.Black, explosiveSpec)
	msgs := moveIn(t, r, "d2e4")
	if p := pieceAt(t, r.Board.FEN, "e4"); p != 0 {
		t.Fatalf("il cavallo esplode: %s", r.Board.FEN)
	}
	if g := r.Match.White.GraveyardKinds(); len(g) != 1 || g[0] != spells.Knight {
		t.Errorf("il cavallo va nel cimitero del Bianco: %v", g)
	}
	trig, _ := findMsg(msgs, models.MsgRuneTriggered)
	if res := trig["result"].(map[string]interface{}); res["kind"] != effects.RuneDestroy || res["piece_destroyed"] != "knight" {
		t.Errorf("result: %v", res)
	}
	if _, ok := findMsg(msgs, models.MsgGraveyardChanged); !ok {
		t.Error("graveyard_changed")
	}

	r = runeRoom("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a5", effects.Black, explosiveSpec)
	moveIn(t, r, "a1a5")
	if pieceAt(t, r.Board.FEN, "a5") != 'R' || !r.Tracker.IsFrozen("a5") {
		t.Errorf("la torre si congela: %s", r.Board.FEN)
	}

	r = runeRoom("4k3/8/8/8/8/8/3N4/4K3 w - - 0 1", "e4", effects.Black, explosiveSpec)
	r.Tracker.AddSquareEffect("e4", effects.KindNoCapture, 3, "sanctuary", effects.White)
	moveIn(t, r, "d2e4")
	if pieceAt(t, r.Board.FEN, "e4") != 'N' || !r.Tracker.IsFrozen("e4") {
		t.Errorf("sul santuario il cavallo si congela: %s", r.Board.FEN)
	}

	// M35: distruggere il pezzo che para lo scacco lascerebbe il re sotto scacco.
	r = runeRoom("4k3/8/8/8/7q/8/4N3/4K3 w - - 0 1", "g3", effects.Black, explosiveSpec)
	moveIn(t, r, "e2g3")
	if pieceAt(t, r.Board.FEN, "g3") != 'N' || len(r.Tracker.RunesOf(effects.Black)) != 1 {
		t.Errorf("la runa non scatta e resta: %s", r.Board.FEN)
	}
}

// Runa di respinta: il pezzo torna com'era prima della mossa (il pedone promosso
// torna pedone), con id ed effetti; la cattura fatta entrando resta. Non scatta
// se lascerebbe il re sotto scacco (M35).
func TestRepelRune(t *testing.T) {
	withStockfish(t)

	r := runeRoom("4r2k/3P4/8/8/8/8/8/4K3 w - - 0 1", "e8", effects.Black, repelSpec)
	id, _, _ := r.Tracker.Info("d7")
	effects.ShieldPiece(r.Tracker, "d7", effects.White, 1, "shield")

	msgs := moveIn(t, r, "d7e8q")
	if !strings.HasPrefix(r.Board.FEN, "7k/3P4/8/8/8/8/8/4K3 b") {
		t.Fatalf("il pedone torna in d7 e la torre catturata resta fuori: %s", r.Board.FEN)
	}
	if got, p, _ := r.Tracker.Info("d7"); got != id || p != 'P' || !r.Tracker.HasShield("d7") {
		t.Errorf("stesso id, di nuovo pedone, stesso scudo: id %d/%d, %c", got, id, p)
	}
	if g := r.Match.Black.GraveyardKinds(); len(g) != 1 || g[0] != spells.Rook {
		t.Errorf("la torre catturata è nel cimitero: %v", g)
	}
	trig, _ := findMsg(msgs, models.MsgRuneTriggered)
	if res := trig["result"].(map[string]interface{}); res["kind"] != effects.RuneReturn || res["from"] != "e8" || res["to"] != "d7" {
		t.Errorf("result: %v", res)
	}

	// Il cavallo para lo scacco in g3: tornare in e2 lascerebbe il re sotto scacco.
	r = runeRoom("4k3/8/8/8/7q/8/4N3/4K3 w - - 0 1", "g3", effects.Black, repelSpec)
	moveIn(t, r, "e2g3")
	if pieceAt(t, r.Board.FEN, "g3") != 'N' || len(r.Tracker.RunesOf(effects.Black)) != 1 {
		t.Errorf("la runa non scatta e resta: %s", r.Board.FEN)
	}
}

// Snapshot: rune nascoste e rivelate tornano uguali dopo salvataggio e ripristino.
func TestRunes_Snapshot(t *testing.T) {
	r := richRoom(startFEN)
	castIn(r, match.PlayerWhite, phase.PhaseMain1, "explosive_rune", "e5")
	castIn(r, match.PlayerBlack, phase.PhaseMain1, "stasis_rune", "d4")
	castIn(r, match.PlayerWhite, phase.PhaseMain1, "revelation")
	data, err := json.Marshal(r.buildSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	var snap roomSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatal(err)
	}
	restored := roomFromSnapshot(snap)
	white, _ := restored.Tracker.RuneAt("e5", effects.White)
	black, _ := restored.Tracker.RuneAt("d4", effects.Black)
	if !white.Hidden || white.Rune == nil || white.Rune.Fallback != effects.RuneFreeze {
		t.Errorf("runa bianca nascosta: %+v", white)
	}
	if black.Hidden || black.Rune == nil || black.Rune.Duration != 2 {
		t.Errorf("runa nera rivelata: %+v", black)
	}
	if got := restored.squareEffects(match.PlayerBlack); len(got) != 1 || got[0].Square != "d4" {
		t.Errorf("il Nero vede solo la sua: %+v", got)
	}
}
