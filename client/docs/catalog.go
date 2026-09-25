package spells

// Catalogo magie CheckMage — 33 carte in 6 archetipi.
//
// Compatibile con lo schema esistente (Spell / Effect con Kind + Params).
// Estensioni PROPOSTE, da validare prima di integrare:
//   - Spell.Targets []TargetSpec  → sostituisce TargetType singolo, serve per
//     magie a più bersagli (Scambio, Blink) e per i filtri (no regina, solo congelati).
//   - Spell.Tags, Spell.MaxCopies → per il deckbuilding.
//   - SquareState (muri, rune, santuari) → mappa parallela a PieceState, ma per casa.
//
// Convenzioni:
//   - "duration" = numero di turni AVVERSARI in cui l'effetto è attivo.
//     Se RemainingTurns oggi decresce a ogni fine turno di entrambi,
//     il handler deve convertire (duration*2) o si cambia il decremento.
//   - Il re non è mai un bersaglio valido per effetti ostili: lo impone il
//     validatore globale, non la singola magia.
//   - Le magie che spostano pezzi usano "no_check": true → la posizione
//     risultante non può mettere sotto scacco il re avversario (altrimenti reject).

type PieceKind string

const (
	Pawn   PieceKind = "pawn"
	Knight PieceKind = "knight"
	Bishop PieceKind = "bishop"
	Rook   PieceKind = "rook"
	Queen  PieceKind = "queen"
)

var Minor = []PieceKind{Knight, Bishop}

type TargetSpec struct {
	Type          TargetType  // riusa i tuoi: TargetSquare, TargetOwnPiece, TargetEnemyPiece...
	Pieces        []PieceKind // pezzi ammessi; vuoto = tutti tranne il re
	RequireEffect string      // es. "frozen": il bersaglio deve avere questo effetto
	EmptySquare   bool        // per TargetSquare: la casa deve essere vuota
	MaxDistance   int         // distanza (Chebyshev) dal bersaglio precedente; 0 = nessun limite
	OwnRanks      []int       // traverse relative al lanciatore (1 = prima traversa)
	MinRank       int         // traversa relativa minima del bersaglio
}

type Rarity string

const (
	Common    Rarity = "common"    // max 2 copie
	Legendary Rarity = "legendary" // max 1 copia
)

var main = []Phase{PhaseMain1, PhaseMain2}
var preMove = []Phase{PhaseMain1} // magie che modificano la Move di questo turno

func sq(empty bool) TargetSpec { return TargetSpec{Type: TargetSquare, EmptySquare: empty} }

var Catalog = []Spell{

	// ───────────────────────── GELO ─────────────────────────

	{ID: "frost", Name: "Brina", ManaCost: 1, Phase: main, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: "freeze_piece", Params: map[string]any{"duration": 1}}}},

	{ID: "ice_wall", Name: "Muro di ghiaccio", ManaCost: 2, Phase: main, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{sq(true)},
		Effects: []Effect{{Kind: "create_wall", Params: map[string]any{"duration": 2}}}}, // NUOVO handler

	{ID: "ice_chain", Name: "Catena di ghiaccio", ManaCost: 3, Phase: main, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: Minor}},
		Effects: []Effect{{Kind: "freeze_piece", Params: map[string]any{"duration": 1}}}},

	{ID: "shatter", Name: "Frantumare", ManaCost: 4, Phase: main, Tags: []string{"gelo"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetEnemyPiece, Pieces: []PieceKind{Pawn, Knight, Bishop, Rook}, RequireEffect: "frozen"}},
		Effects: []Effect{{Kind: "destroy_piece"}}},

	{ID: "eternal_winter", Name: "Inverno eterno", ManaCost: 7, Phase: main, Tags: []string{"gelo"}, Rarity: Legendary,
		Targets: nil,
		Effects: []Effect{{Kind: "freeze_all", Params: map[string]any{"side": "enemy", "pieces": []PieceKind{Pawn}, "duration": 1}}}}, // NUOVO

	// ────────────────────── NECROMANZIA ──────────────────────

	{ID: "blood_pact", Name: "Patto di sangue", ManaCost: 0, Phase: main, Tags: []string{"necro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{
			{Kind: "destroy_piece", Params: map[string]any{"to_graveyard": true}},
			{Kind: "gain_mana", Params: map[string]any{"amount": 2, "can_exceed_cap": false}},
		},
		Limits: map[string]int{"per_turn": 1}}, // NUOVO: limite di cast per turno

	{ID: "restless_soul", Name: "Anima inquieta", ManaCost: 2, Phase: main, Tags: []string{"necro"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "add_trigger", Params: map[string]any{ // NUOVO: trigger a livello di giocatore
			"on": "own_piece_lost", "do": "draw_card", "amount": 1, "duration": 1}}}},

	{ID: "recall", Name: "Richiamo", ManaCost: 3, Phase: main, Tags: []string{"necro", "falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{2}}},
		Effects: []Effect{{Kind: "revive_piece", Params: map[string]any{"pieces": []PieceKind{Pawn}, "no_check": true}}}}, // NUOVO

	{ID: "echo_of_fallen", Name: "Eco del caduto", ManaCost: 4, Phase: preMove, Tags: []string{"necro", "arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: "borrow_movement", Params: map[string]any{ // NUOVO: il client sceglie un pezzo dal cimitero
			"from_graveyard": Minor, "duration": 1}}}},

	{ID: "resurrection", Name: "Resurrezione", ManaCost: 8, Phase: main, Tags: []string{"necro"}, Rarity: Legendary,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{1}}},
		Effects: []Effect{{Kind: "revive_piece", Params: map[string]any{"pieces": []PieceKind{Knight, Bishop, Rook}, "no_check": true}}}},

	// ───────────────────────── ARCANO ─────────────────────────

	{ID: "phase_step", Name: "Passo sfasato", ManaCost: 2, Phase: preMove, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: Minor}},
		Effects: []Effect{{Kind: "add_effect", Params: map[string]any{ // NUOVO kind generico per effetti di movimento
			"effect": "phasing", "no_capture": true, "duration": 0}}}}, // 0 = solo questo turno

	{ID: "swap", Name: "Scambio", ManaCost: 3, Phase: main, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece}, {Type: TargetOwnPiece}},
		Effects: []Effect{{Kind: "swap_pieces", Params: map[string]any{"no_check": true}}}}, // NUOVO

	{ID: "blink", Name: "Blink", ManaCost: 4, Phase: main, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: Minor}, {Type: TargetSquare, EmptySquare: true, MaxDistance: 2}},
		Effects: []Effect{{Kind: "move_piece", Params: map[string]any{"no_check": true}}}},

	{ID: "metamorphosis", Name: "Metamorfosi", ManaCost: 5, Phase: main, Tags: []string{"arcano"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: Minor}},
		Effects: []Effect{{Kind: "transform_piece", Params: map[string]any{ // NUOVO: cambia il carattere nella FEN, mantiene PieceID
			"map": map[PieceKind]PieceKind{Knight: Bishop, Bishop: Knight}, "no_check": true}}}},

	{ID: "haste", Name: "Fretta", ManaCost: 6, Phase: preMove, Tags: []string{"arcano", "falange"}, Rarity: Legendary,
		Targets: nil,
		Effects: []Effect{{Kind: "extra_move", Params: map[string]any{ // NUOVO: tocca la FSM della fase Move
			"pieces": []PieceKind{Pawn}, "no_capture": true}}}},

	// ───────────────────────── SACRO ─────────────────────────

	{ID: "shield", Name: "Scudo", ManaCost: 2, Phase: main, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn, Knight, Bishop, Rook}}},
		Effects: []Effect{{Kind: "shield_piece", Params: map[string]any{"duration": 1}}}},

	{ID: "royal_shield", Name: "Scudo reale", ManaCost: 4, Phase: main, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Queen}}},
		Effects: []Effect{{Kind: "shield_piece", Params: map[string]any{"duration": 1}}}},

	{ID: "royal_guard", Name: "Guardia reale", ManaCost: 3, Phase: main, Tags: []string{"sacro"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "shield_area", Params: map[string]any{ // NUOVO
			"around": "own_king", "radius": 1, "duration": 1}}}},

	{ID: "divine_castling", Name: "Arrocco divino", ManaCost: 4, Phase: preMove, Tags: []string{"sacro"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "restore_castling_rights"}}}, // NUOVO: riscrive i diritti di arrocco nella FEN

	{ID: "sanctuary", Name: "Santuario", ManaCost: 5, Phase: main, Tags: []string{"sacro"}, Rarity: Common,
		Targets: []TargetSpec{sq(false)},
		Effects: []Effect{{Kind: "create_square_effect", Params: map[string]any{ // NUOVO
			"effect": "no_capture", "duration": 3}}}},

	{ID: "reflection", Name: "Riflesso", ManaCost: 3, Phase: main, Tags: []string{"sacro", "rune"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "add_trigger", Params: map[string]any{
			"on": "shielded_piece_attacked", "do": "freeze_attacker", "duration": 1, "hidden": true}}}},

	// ───────────────────────── RUNE ─────────────────────────

	{ID: "revelation", Name: "Rivelazione", ManaCost: 1, Phase: main, Tags: []string{"rune"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{
			{Kind: "reveal_runes", Params: map[string]any{"side": "enemy"}}, // NUOVO
			{Kind: "draw_card", Params: map[string]any{"amount": 1}},
		}},

	{ID: "stasis_rune", Name: "Runa di stasi", ManaCost: 2, Phase: main, Tags: []string{"rune", "gelo"}, Rarity: Common,
		Targets: []TargetSpec{sq(true)},
		Effects: []Effect{{Kind: "place_rune", Params: map[string]any{ // NUOVO
			"on_enter": "freeze_piece", "duration": 2}}}},

	{ID: "repel_rune", Name: "Runa di respinta", ManaCost: 2, Phase: main, Tags: []string{"rune"}, Rarity: Common,
		Targets: []TargetSpec{sq(true)},
		Effects: []Effect{{Kind: "place_rune", Params: map[string]any{"on_enter": "return_to_origin"}}}},

	{ID: "explosive_rune", Name: "Runa esplosiva", ManaCost: 3, Phase: main, Tags: []string{"rune"}, Rarity: Common,
		Targets: []TargetSpec{sq(true)},
		Effects: []Effect{{Kind: "place_rune", Params: map[string]any{
			"on_enter": "destroy_piece", "only": []PieceKind{Pawn, Knight, Bishop},
			"fallback": "freeze_piece", "fallback_duration": 1}}}},

	{ID: "detonation", Name: "Detonazione", ManaCost: 4, Phase: main, Tags: []string{"rune", "gelo"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "detonate_runes", Params: map[string]any{ // NUOVO: consuma le rune
			"radius": 1, "do": "freeze_piece", "duration": 1}}}},

	{ID: "minefield", Name: "Campo minato", ManaCost: 7, Phase: main, Tags: []string{"rune"}, Rarity: Legendary,
		Targets: []TargetSpec{sq(true), sq(true), sq(true)},
		Effects: []Effect{{Kind: "place_rune", Params: map[string]any{"on_enter": "freeze_piece", "duration": 2}}}},

	// ──────────────────────── FALANGE ────────────────────────

	{ID: "forced_march", Name: "Marcia forzata", ManaCost: 1, Phase: main, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}}},
		Effects: []Effect{{Kind: "move_piece", Params: map[string]any{
			"relative": "forward", "squares": 1, "no_capture": true, "no_promotion": true, "no_check": true}}}},

	{ID: "phalanx", Name: "Falange", ManaCost: 3, Phase: main, Tags: []string{"falange", "sacro"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "shield_area", Params: map[string]any{
			"filter": "own_pawns_adjacent_to_own_pawn", "duration": 1}}}},

	{ID: "conscription", Name: "Leva militare", ManaCost: 4, Phase: main, Tags: []string{"falange"}, Rarity: Common,
		Targets: []TargetSpec{{Type: TargetSquare, EmptySquare: true, OwnRanks: []int{2}}},
		Effects: []Effect{{Kind: "summon_pawn", Params: map[string]any{"max_pawns": 8}}}},

	{ID: "banner", Name: "Stendardo", ManaCost: 2, Phase: main, Tags: []string{"falange"}, Rarity: Common,
		Targets: nil,
		Effects: []Effect{{Kind: "add_aura", Params: map[string]any{ // NUOVO: effetto permanente condizionale
			"condition": map[string]any{"own_pawns_gte": 6},
			"grant":     "pawn_sidestep", "duration": -1}}}}, // -1 = permanente

	{ID: "early_promotion", Name: "Promozione anticipata", ManaCost: 6, Phase: main, Tags: []string{"falange"}, Rarity: Legendary,
		Targets: []TargetSpec{{Type: TargetOwnPiece, Pieces: []PieceKind{Pawn}, MinRank: 6}},
		Effects: []Effect{{Kind: "promote_piece", Params: map[string]any{ // NUOVO: il client sceglie il pezzo
			"choices": []PieceKind{Knight, Bishop, Rook, Queen}, "no_check": true}}}},
}
