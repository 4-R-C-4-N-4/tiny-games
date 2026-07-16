//! # td_sim — Phase 0 deterministic simulation core
//!
//! ONE ENGINE, TWO CONSUMERS. This crate is the single source of truth for game
//! rules. It is driven identically by:
//!   1. the live game (browser, via WASM) — attacker = the distilled model
//!   2. the training harness (native) — attacker = branching search
//!
//! Nothing here renders, learns, or searches. Those are the *consumers*. This is
//! the contract they share. If a rule lives in two places it will drift; it lives
//! here once.
//!
//! ## Determinism contract (the thing everything depends on)
//! Given `(seed, initial Grid, the ordered stream of player + attacker decisions)`
//! the entire tick history is bit-identical on every platform. To hold that across
//! native and WASM we avoid float nondeterminism by doing sim math in **fixed point**
//! and by iterating entities in **stable id order** (Vec-indexed, never HashMap).
//! See `PHASE0.md` for the full contract and the one open decision (fixed vs f32).

#![allow(dead_code)]

// ===================================================================================
// Fixed-point scalar. All positions, HP, damage, time accumulators use this.
// ===================================================================================

/// Q22.10 fixed-point in an i32. Range ±2.1M with 1/1024 resolution — ample for a grid.
pub type Fx = i32;
pub const FX_SHIFT: u32 = 10;
pub const FX_ONE: Fx = 1 << FX_SHIFT; // 1024

#[inline] pub fn fx(n: i32) -> Fx { n << FX_SHIFT }
#[inline] pub fn fx_mul(a: Fx, b: Fx) -> Fx { ((a as i64 * b as i64) >> FX_SHIFT) as Fx }
#[inline] pub fn fx_div(a: Fx, b: Fx) -> Fx { (((a as i64) << FX_SHIFT) / b as i64) as Fx }

/// Deterministic PRNG (xorshift64). Used sparingly — the sim is deterministic by
/// construction; RNG is only for tie-breaks/jitter that must still be reproducible.
pub struct Rng { state: u64 }
impl Rng {
    pub fn new(seed: u64) -> Self { Self { state: seed | 1 } }
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        self.state = x; x
    }
    #[inline] pub fn below(&mut self, n: u32) -> u32 { (self.next_u64() % n as u64) as u32 }
}

// ===================================================================================
// Coordinates & identifiers
// ===================================================================================

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Cell { pub x: u16, pub y: u16 }

#[derive(Clone, Copy, Debug)]
pub struct Pos { pub x: Fx, pub y: Fx }

/// Entities are stored in Vecs; the id is the index. Iteration is therefore stable,
/// which the determinism contract requires. (Slot reuse via a freelist in the impl.)
pub type MobId = u32;
pub type TowerId = u32;

// ===================================================================================
// Element lattice — §3.1. ONE symmetric taxonomy for both attack and defense.
// Wheel: Sonic > Earth > Zap > Ice > Fire > Sonic.  Light <> Dark mutual (both 1.5x).
// Element index order is fixed (used to index the [Fx; 7] observation channels).
// ===================================================================================

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Element { Fire, Ice, Earth, Sonic, Zap, Light, Dark }
pub const N_ELEMENTS: usize = 7;
impl Element {
    #[inline] pub fn index(self) -> usize { self as usize } // stable channel index
}

/// The 7x7 effectiveness multiplier (fixed-point). Single source of truth for §3.1.
/// Default strong/weak = 1.5 / 0.5 (== fx_mul-ready constants); neutral = FX_ONE.
pub fn type_mult(_atk: Element, _def: Element) -> Fx { todo!("wheel + Light/Dark mutual; else FX_ONE") }

/// Mob TRAIT (mechanical threat). Orthogonal to Element. Armor classes are gone —
/// a mob's "resistance" is just its Element.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Trait { Grunt, Swarm, Tank, Runner, Flier, Shade, Shielded, Mender, Breaker }

/// Skill-tree tier. Starting element has an expedited path to T2 (§3.4).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Tier { T1, T2, T3 }

/// The three node kinds a tree slot can be. Actives double as the §2 in-wave verbs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeKind { Turret, Structure, Active }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TargetPriority { First, Strongest, Fastest, Flying }

// ===================================================================================
// Grid & occupancy. Buildability is a static map property; occupancy is dynamic.
// CONFIRMED DECISION (§9.4): only walls block movement. Towers never affect pathing.
// ===================================================================================

#[derive(Clone, Copy, Debug)]
pub enum Occupant {
    Empty,
    Wall { hp: Fx },
    Tower(TowerId),
    Core,
    Spawn,
}

#[derive(Clone, Copy, Debug)]
pub struct CellInfo { pub buildable: bool, pub occ: Occupant }

pub struct Grid { pub w: u16, pub h: u16, pub cells: Vec<CellInfo> }
impl Grid {
    #[inline] pub fn idx(&self, c: Cell) -> usize { c.y as usize * self.w as usize + c.x as usize }
    #[inline] pub fn get(&self, c: Cell) -> CellInfo { self.cells[self.idx(c)] }
    /// Walls block; everything else is passable (towers included).
    #[inline] pub fn blocks(&self, c: Cell) -> bool { matches!(self.get(c).occ, Occupant::Wall { .. }) }
}

// ===================================================================================
// Entities
// ===================================================================================

#[derive(Clone, Copy, Debug)]
pub struct TowerFlags { pub anti_air: bool, pub detection: bool, pub splash: Fx, pub slow: Fx }

pub struct Tower {
    pub cell: Cell,
    pub element: Element,
    pub tier: Tier,
    pub kind: NodeKind,
    pub dps: Fx,
    pub range: Fx,
    pub priority: TargetPriority,
    pub flags: TowerFlags,
}

#[derive(Clone, Copy, Debug)]
pub struct MobFlags { pub flier: bool, pub stealth: bool, pub breaker: bool, pub regen: Fx }

pub struct Mob {
    pub id: MobId,
    pub element: Element,   // decides matchup (which tower color counters it)
    pub trait_: Trait,      // decides mechanical threat
    pub pos: Pos,
    pub hp: Fx,
    pub max_hp: Fx,
    pub speed: Fx,
    pub flags: MobFlags,
    pub shield_hits: u8,   // Shielded: absorbs first N hits
    pub entry_x: u16,
}

// ===================================================================================
// Pathing — dual flow fields. §3.5
//   cost_walled: walls impassable → the route mobs actually take.
//   cost_open:   walls passable   → the "if I could go straight" field that tells a
//                blocked mob / Breaker WHICH wall to break (the one on this gradient).
// Recomputed only when the maze changes (build/sell wall, or a breach). Towers never
// dirty the field. Fliers ignore both (straight line to Core).
// ===================================================================================

pub const UNREACHABLE: u32 = u32::MAX;

pub struct Fields {
    pub cost_walled: Vec<u32>,
    pub cost_open: Vec<u32>,
    pub dirty: bool,
}
impl Fields {
    pub fn new(_grid: &Grid) -> Self { todo!("alloc, then recompute") }
    /// BFS/Dijkstra from Core over both wall-modes. O(cells); cheap enough per maze-change.
    pub fn recompute(&mut self, _grid: &Grid) { todo!() }
    /// Next cell down the walled gradient, or None if this cell is UNREACHABLE.
    pub fn step_walled(&self, _grid: &Grid, _from: Cell) -> Option<Cell> { todo!() }
    /// The wall a blocked mob at `from` should attack: first wall along the open gradient.
    pub fn breach_target(&self, _grid: &Grid, _from: Cell) -> Option<Cell> { todo!() }
}

// ===================================================================================
// Wave DSL — the serialized attacker plan. §4.3
// This AST is BOTH the grammar-constrained model output (parsed from text) AND the
// telegraph/replay representation. The grammar in `wave.ebnf` maps 1:1 to these types.
// ===================================================================================

#[derive(Clone, Debug)]
pub struct MobGroup { pub element: Element, pub trait_: Trait, pub count: u16 }

/// A telegraphed opener spawn: `SPAWN t=.. x=.. ELEMENT TRAIT xN`.
#[derive(Clone, Debug)]
pub struct Spawn { pub t: Fx, pub x: u16, pub group: MobGroup }

/// A reserve commit fired at a decision point. `Breach` = spawn a group aimed at a gate.
#[derive(Clone, Debug)]
pub enum Commit {
    Spawn  { x: u16, group: MobGroup },
    Breach { x: u16, group: MobGroup, gate: Cell },
}

/// Small, CLOSED predicate set so grammar-constrained decoding has a finite space.
#[derive(Clone, Debug)]
pub enum Cond {
    DpsNearLt { x: u16, element: Element, thresh: Fx },
    WallHpLt  { gate: Cell, thresh: Fx },
    CoreHpLt  { thresh: Fx },
    And(Box<Cond>, Box<Cond>),
}

/// Guards evaluated in order at a decision point; first satisfied one fires.
/// A trailing guard with `cond: None` is the `ELSE`.
#[derive(Clone, Debug)]
pub struct GuardedCommit { pub cond: Option<Cond>, pub commit: Vec<Commit> }

#[derive(Clone, Debug)]
pub struct DecisionPointPlan { pub t: Fx, pub guards: Vec<GuardedCommit> }

#[derive(Clone, Debug)]
pub struct Reserve { pub pool: u32, pub points: Vec<DecisionPointPlan> }

#[derive(Clone, Debug)]
pub struct Wave { pub budget: u32, pub diff: u8, pub opener: Vec<Spawn>, pub reserve: Reserve }

pub type Opener = Vec<Spawn>;

/// Parse grammar-constrained text (model output) into a validated `Wave`.
/// Validation enforces the invariants the grammar can't: cost <= budget, x in range,
/// gate cells are real walls, timings within the wave window.
pub fn parse_wave(_src: &str) -> Result<Wave, WaveError> { todo!() }

#[derive(Debug)]
pub enum WaveError { Syntax(String), OverBudget, BadCell, BadTiming }

// ===================================================================================
// Observation — what the attacker sees. §4.2
// Open field ⇒ a spatial feature grid (not a lane vector). This is the model's input
// tensor and the search's read model. Channels below.
// ===================================================================================

#[derive(Clone, Copy, Debug, Default)]
pub struct CellFeatures {
    pub dps: [Fx; N_ELEMENTS],  // per-element coverage reaching this cell (§3.1 order)
    pub control: Fx,      // slow coverage
    pub anti_air: Fx,
    pub detection: Fx,
    pub wall_hp: Fx,      // 0 if no wall
    pub buildable: bool,
    pub dist_core: u32,   // from cost_walled (maze geometry the model must read)
}

/// Compact, high-signal summary of what the player is teched into (§3.4). Lets the
/// attacker ANTICIPATE branches, not just react to current DPS.
#[derive(Clone, Copy, Debug)]
pub struct BuildProfile {
    pub starting: Element,
    pub attuned: [bool; N_ELEMENTS],
    pub depth: [u8; N_ELEMENTS],   // highest tier reached per element (0 = none)
}

pub struct Observation {
    pub w: u16,
    pub h: u16,
    pub cells: Vec<CellFeatures>,
    pub profile: BuildProfile,
    pub budget: u32,
    pub wave: u32,
    pub diff: u8,
}

/// Extra state handed to the attacker at a decision point (the reactive delta).
pub struct DecisionContext<'a> {
    pub obs: &'a Observation,   // recomputed feature grid (observed DPS so far, new geometry)
    pub reserve_left: u32,
    pub core_hp: Fx,
    pub t: Fx,
    pub point_index: u8,
}

// ===================================================================================
// Attacker — the runtime interface both consumers implement. §7 "key discipline".
//   PlanAttacker : executes a compiled Wave (the model's parsed DSL, or a replay).
//   SearchAttacker (native, in the training crate) : searches live, implements the same trait.
// The Sim never knows which is behind the trait object.
// ===================================================================================

pub trait Attacker {
    /// Plan the telegraphed opener + declare the hidden reserve pool for this wave.
    fn open(&mut self, obs: &Observation) -> (Opener, u32);
    /// React at a decision point: choose commits from the remaining reserve.
    fn commit(&mut self, ctx: &DecisionContext) -> Vec<Commit>;
}

/// Executes a pre-computed Wave. Used for the model's output and for deterministic replays.
pub struct PlanAttacker { pub wave: Wave, cursor: usize }
impl PlanAttacker {
    pub fn new(wave: Wave) -> Self { Self { wave, cursor: 0 } }
}
impl Attacker for PlanAttacker {
    fn open(&mut self, _obs: &Observation) -> (Opener, u32) { todo!("return opener + reserve.pool") }
    fn commit(&mut self, _ctx: &DecisionContext) -> Vec<Commit> { todo!("eval guards of the next DecisionPointPlan, fire first match") }
}

// ===================================================================================
// Player-side inputs
// ===================================================================================

#[derive(Clone, Copy, Debug)]
pub enum PlayerVerb {
    FocusFire { cell: Cell, target: MobId },
    Overcharge { cell: Cell },
    Reinforce { cell: Cell },
    Reveal { cell: Cell },
}

// ===================================================================================
// The simulator
// ===================================================================================

pub struct Config {
    pub dt: Fx,               // fixed timestep (e.g. fx(1)/30)
    pub seed: u64,
    pub decision_points: u8,  // §9.1 — start at 2
    pub reserve_frac: Fx,     // §9.1 — start ~0.35
}

/// Per-wave scorecard = the multi-term objective the search optimizes AND the game score.
#[derive(Clone, Copy, Debug, Default)]
pub struct Metrics {
    pub leaked_hp: Fx,
    pub time_to_first_leak: Fx,   // -1 sentinel if none
    pub overkill: Fx,
    pub dps_util: [Fx; N_ELEMENTS],
    pub currency_delta: i64,      // economy-denial term
    pub breaches: u32,
    pub fire_misalloc: Fx,        // tempo/bluff term
}

/// What one `step()` produced. The driver loop dispatches on this — see the doc example.
pub enum StepOutcome {
    Continue,
    DecisionPoint(Observation),
    WaveComplete(Metrics),
    GameOver,
}

/// Player economy + skill-tree state (§3.4). Owned by the Sim; summarized into
/// `BuildProfile` for the attacker's observation.
pub struct PlayerState {
    pub currency: i64,
    pub starting: Element,
    pub attuned: [bool; N_ELEMENTS],   // starting element is pre-attuned
    pub depth: [u8; N_ELEMENTS],       // highest tier owned per element
    pub attune_count: u8,              // drives the escalating attunement cost
}
impl PlayerState {
    pub fn new(starting: Element) -> Self { todo!("pre-attune `starting`, seed currency") }
    /// Escalating attunement price — the breadth-vs-depth knob (§3.4). Rises with count.
    pub fn attune_cost(&self, _e: Element) -> i64 { todo!() }
    /// Tier-gate cost. Starting element's T2 is waived/discounted (the expedited path).
    pub fn tier_cost(&self, _e: Element, _tier: Tier) -> i64 { todo!("cheap T2 iff e == starting") }
    pub fn can_build(&self, _e: Element, _tier: Tier) -> bool { todo!("attuned && depth reached && affordable") }
}

pub struct Sim {
    grid: Grid,
    fields: Fields,
    towers: Vec<Tower>,
    mobs: Vec<Mob>,
    player: PlayerState,
    rng: Rng,
    tick: u64,
    core_hp: Fx,
    cfg: Config,
    // active-wave schedule, decision-point ticks, metrics accumulator … (impl detail)
}

impl Sim {
    pub fn new(_cfg: Config, _grid: Grid, _starting: Element) -> Self { todo!() }

    // ---- build phase (player) -----------------------------------------------------
    /// Pay the one-time attunement cost to unlock a non-starting element's tree.
    pub fn attune(&mut self, _e: Element) -> bool { todo!("charge attune_cost; set attuned; bump count") }
    /// Build an element node. Requires attuned + tier reachable + affordable.
    pub fn build_tower(&mut self, _cell: Cell, _e: Element, _tier: Tier, _kind: NodeKind) -> bool { todo!("no field recompute") }
    /// The universal, non-elemental breakable wall (§3.3) — available to everyone.
    pub fn build_wall(&mut self, _cell: Cell) -> bool { todo!("checks buildable+empty+cost; marks fields dirty") }
    pub fn sell(&mut self, _cell: Cell) -> bool { todo!("refund; if wall, fields dirty") }

    // ---- wave lifecycle -----------------------------------------------------------
    pub fn begin_wave(&mut self, _opener: &Opener, _reserve_pool: u32, _wave: u32, _diff: u8) { todo!() }
    pub fn observe(&self) -> Observation { todo!("build the feature grid from towers+walls+fields") }
    pub fn commit(&mut self, _commits: &[Commit]) { todo!("spend reserve, inject spawns/breachers") }
    pub fn player_verb(&mut self, _verb: PlayerVerb) { todo!() }
    pub fn core_hp(&self) -> Fx { self.core_hp }

    /// Advance exactly one fixed tick. THE UPDATE ORDER BELOW IS PART OF THE
    /// DETERMINISM CONTRACT — do not reorder:
    ///   1. tick += 1
    ///   2. process scheduled opener/reserve spawns due this tick
    ///   3. mobs sample flow field → intended movement (fliers: straight to Core)
    ///   4. move mobs; any reaching Core → leak (damage Core, despawn, metrics)
    ///   5. breaching mobs damage target walls; walls at 0 hp removed → maze dirty
    ///   6. if maze dirty → recompute fields ONCE
    ///   7. towers acquire targets (priority, then stable id order) and fire; apply
    ///      typing/shield/splash/slow; accumulate dps_util
    ///   8. resolve mob deaths → bounty → currency
    ///   9. mender regen
    ///  10. accumulate metrics
    ///  11. if this tick is a decision point → return DecisionPoint(observe())
    ///      else if wave schedule exhausted & no mobs → WaveComplete(metrics)
    ///      else if core_hp <= 0 → GameOver
    ///      else Continue
    pub fn step(&mut self) -> StepOutcome { todo!() }
}

// ===================================================================================
// Driver loop — IDENTICAL for live play and training. This is the whole point.
//
//   let mut sim = Sim::new(cfg, grid);
//   // ... player build phase (live) or generated layout (training) ...
//   let (opener, pool) = attacker.open(&sim.observe());
//   sim.begin_wave(&opener, pool, wave, diff);
//   loop {
//       match sim.step() {
//           StepOutcome::Continue            => {}
//           StepOutcome::DecisionPoint(obs)  => {
//               let ctx = DecisionContext { obs: &obs, reserve_left, core_hp: sim.core_hp(), t, point_index };
//               let commits = attacker.commit(&ctx);
//               sim.commit(&commits);
//           }
//           StepOutcome::WaveComplete(m)     => break m,
//           StepOutcome::GameOver            => break Metrics::default(),
//       }
//   }
//
// Live:     attacker = PlanAttacker(parse_wave(model_output))
// Training: attacker = SearchAttacker::new(...)   (native-only crate)
// ===================================================================================
