// Shared possession/trip kernel used by Havoc and Cap Rush.
//
// TypeScript prepares the team tables (the same `prepareTeam` output used by
// the TypeScript reference stepper) and owns every mode rule through the hook
// imports. Rust owns the per-trip state machine, seeded draws, clock, fouls,
// shots, free throws, rebounds, continuations, and stat accounting.
const CAPACITY: usize = 131_072;
const OUTPUT_CAPACITY: usize = 2_048;
const MAX_UNITS: usize = 11;
const STAT_FIELDS: usize = 40;

static mut INPUT: [f64; CAPACITY] = [0.0; CAPACITY];
static mut OUTPUT: [f64; OUTPUT_CAPACITY] = [0.0; OUTPUT_CAPACITY];
static mut HOOK_OUT: [f64; 64] = [0.0; 64];

#[derive(Clone)]
struct ApronFact {
    kind: u32,
    ordinal: u32,
    passer: String,
    defender: String,
}

struct ApronState {
    active: bool,
    side: u32,
    payroll: u32,
    ordinals: [u32; 2],
    offense: u32,
    ordinal: u32,
    offense_ordinal: u32,
    defense_ordinal: u32,
    strike: bool,
    facts: Vec<ApronFact>,
}

impl ApronState {
    fn new(side: u32, payroll: u32) -> Self {
        Self {
            active: false,
            side,
            payroll,
            ordinals: [0, 0],
            offense: 0,
            ordinal: 0,
            offense_ordinal: 0,
            defense_ordinal: 0,
            strike: false,
            facts: Vec::new(),
        }
    }
    fn push_fact(&mut self, kind: u32, ordinal: u32) {
        self.facts.push(ApronFact {
            kind,
            ordinal,
            passer: String::new(),
            defender: String::new(),
        });
    }
}

static mut APRON_STATES: Vec<Option<ApronState>> = Vec::new();

fn apron_ref(handle: u32) -> Option<&'static ApronState> {
    if handle == 0 {
        return None;
    }
    unsafe {
        let states = &*core::ptr::addr_of!(APRON_STATES);
        states
            .get(handle as usize - 1)
            .and_then(|state| state.as_ref())
    }
}

fn apron_mut(handle: u32) -> Option<&'static mut ApronState> {
    if handle == 0 {
        return None;
    }
    unsafe {
        let states = &mut *core::ptr::addr_of_mut!(APRON_STATES);
        states
            .get_mut(handle as usize - 1)
            .and_then(|state| state.as_mut())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_create(side: u32, payroll: u32) -> u32 {
    if side > 1 || (payroll != 1 && payroll != 2) {
        return 0;
    }
    let state = ApronState::new(side, payroll);
    unsafe {
        let states = &mut *core::ptr::addr_of_mut!(APRON_STATES);
        for (index, slot) in states.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(state);
                return index as u32 + 1;
            }
        }
        states.push(Some(state));
        states.len() as u32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_destroy(handle: u32) {
    unsafe {
        let states = &mut *core::ptr::addr_of_mut!(APRON_STATES);
        if let Some(slot) = states.get_mut(handle as usize - 1) {
            *slot = None;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_reset(handle: u32, side: u32, payroll: u32) -> u32 {
    if side > 1 || (payroll != 1 && payroll != 2) {
        return 1;
    }
    let Some(state) = apron_mut(handle) else {
        return 1;
    };
    *state = ApronState::new(side, payroll);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_begin(handle: u32, offense: u32) -> u32 {
    if offense > 1 {
        return 1;
    }
    let Some(state) = apron_mut(handle) else {
        return 1;
    };
    let index = offense as usize;
    state.ordinals[index] += 1;
    let ordinal = state.ordinals[index];
    let defense_ordinal = state.ordinals[1 - index];
    let strike = offense != state.side && state.payroll == 2 && ordinal % 8 == 0;
    state.active = true;
    state.offense = offense;
    state.ordinal = ordinal;
    state.offense_ordinal = ordinal;
    state.defense_ordinal = defense_ordinal;
    state.strike = strike;
    if strike {
        state.push_fact(1, ordinal);
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_end(handle: u32) {
    if let Some(state) = apron_mut(handle) {
        state.active = false;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_offense_ordinal(handle: u32) -> u32 {
    apron_ref(handle).map_or(0, |state| state.offense_ordinal)
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_defense_ordinal(handle: u32) -> u32 {
    apron_ref(handle).map_or(0, |state| state.defense_ordinal)
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_isolation(_handle: u32) -> u32 {
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_strike(handle: u32) -> u32 {
    apron_ref(handle).map_or(0, |state| (state.active && state.strike) as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_interception_chance(handle: u32, offense: u32) -> f64 {
    let Some(state) = apron_ref(handle) else {
        return 0.0;
    };
    if offense != state.side {
        return 0.0;
    }
    if state.payroll == 1 { 0.015 } else { 0.07 }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_record_interception(handle: u32) -> u32 {
    let Some(state) = apron_mut(handle) else {
        return 1;
    };
    if !state.active {
        return 1;
    }
    let ordinal = state.ordinal;
    state.push_fact(2, ordinal);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_fact_count(handle: u32) -> u32 {
    apron_ref(handle).map_or(0, |state| state.facts.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_fact_kind(handle: u32, index: u32) -> u32 {
    apron_ref(handle)
        .and_then(|state| state.facts.get(index as usize))
        .map_or(0, |fact| fact.kind)
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_fact_ordinal(handle: u32, index: u32) -> u32 {
    apron_ref(handle)
        .and_then(|state| state.facts.get(index as usize))
        .map_or(0, |fact| fact.ordinal)
}

#[unsafe(no_mangle)]
pub extern "C" fn input_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(INPUT).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(OUTPUT).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn hook_output_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(HOOK_OUT).cast()
}

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn derived_create(seed: *const u8, length: u32) -> u32;
    fn derived_next_host(handle: u32) -> f64;
    fn derived_pick_host(handle: u32, weights: *const f64, length: u32, total: f64) -> u32;
    fn derived_int_host(handle: u32, min: i32, max: i32) -> i32;

    fn rng_next() -> f64;
    fn rng_chance(probability: f64) -> u32;
    fn rng_pick(table: *const f64, length: u32) -> u32;

    fn hook_sync(remaining: f64, clock: f64, has_clock: u32);
    fn hook_full_clock(side: u32) -> f64;
    fn hook_rebound_clock(side: u32) -> f64;
    fn hook_shot_clock_violation(side: u32, limit_seconds: f64);
    fn hook_cancel_turnover(offense: u32, handler: u32) -> u32;
    fn hook_turnover(offense: u32, handler: u32, cancelled: u32);
    fn hook_steal(defense: u32, stealer: u32);
    fn hook_shot_plan(
        out: *mut f64,
        offense: u32,
        defense: u32,
        shooter: u32,
        zone: u32,
        action: u32,
        passed: u32,
    ) -> u32;
    fn hook_foul(
        out: *mut f64,
        fouler_side: u32,
        fouler: u32,
        offense_side: u32,
        shooter: i32,
        shooting: u32,
        made: u32,
        in_bonus: u32,
        zone: i32,
    ) -> u32;
    fn hook_field_goal(
        offense: u32,
        shooter: u32,
        made: u32,
        three: u32,
        passed: u32,
        shot_kind: u32,
        putback: u32,
        zone: u32,
    );
    fn hook_free_throw(side: u32, shooter: u32, made: u32, bonus: u32);
    fn hook_assist(offense: u32, assister: u32, scorer: u32);
    fn hook_rebound(side: u32, rebounder: u32, offensive: u32);
    fn hook_block(defense: u32, blocker: u32, shooter: u32);
    fn hook_pass_intercepted(passer: u32, defender: u32);
    fn hook_effects_trip(
        handler_valid: u32,
        handler: u32,
        shooter_valid: u32,
        shooter: u32,
        defender_valid: u32,
        defender: u32,
        rebound0: f64,
        rebound1: f64,
    );
}

struct Reader<'a> {
    data: &'a [f64],
    cursor: usize,
}
impl<'a> Reader<'a> {
    fn f(&mut self) -> f64 {
        let value = self.data[self.cursor];
        self.cursor += 1;
        value
    }
    fn slice(&mut self, count: usize) -> &'a [f64] {
        let result = &self.data[self.cursor..self.cursor + count];
        self.cursor += count;
        result
    }
    fn usize(&mut self) -> usize {
        self.f() as usize
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
struct Constants {
    mean_trip: f64,
    era_poss: f64,
    pass_anchor: f64,
    min_start: f64,
    min_trip: f64,
    shot_clock: f64,
    inbound: f64,
    continuation: f64,
    non_shooting_foul: f64,
    offensive_foul_share: f64,
    foul_trouble_start: f64,
    foul_avoid_per: f64,
    foul_avoid_floor: f64,
    bonus_regulation: f64,
    bonus_overtime: f64,
    fouled_shot_scale: f64,
    home_defense: f64,
    away_turnover: f64,
    has_havoc: bool,
    twenty_second: bool,
    deep_four: bool,
    has_race: bool,
    has_effects: bool,
    has_apron: bool,
    off_rebound_rate: f64,
    off_rebound_scale: f64,
    off_rebound_range: f64,
    off_rebound_rim_bonus: f64,
    off_rebound_perimeter_penalty: f64,
    deep_four_split: f64,
    deep_four_make_scale: f64,
    deep_four_ft_miss: usize,
    internal_rng: bool,
}

struct Adjusted<'a> {
    struck: bool,
    count: usize,
    map: &'a [f64],
    defensive_rebound_mean: f64,
    stealer: &'a [f64],
    defensive_rebound: &'a [f64],
    defenders: &'a [f64],
    uniform: &'a [f64],
}
impl<'a> Adjusted<'a> {
    fn none() -> Self {
        Self {
            struck: false,
            count: 0,
            map: &[],
            defensive_rebound_mean: 0.0,
            stealer: &[],
            defensive_rebound: &[],
            defenders: &[],
            uniform: &[],
        }
    }
}

#[allow(dead_code)]
struct Team<'a> {
    count: usize,
    initiator: &'a [f64],
    fouler: &'a [f64],
    stealer: &'a [f64],
    offensive_rebound: &'a [f64],
    defensive_rebound: &'a [f64],
    free_throw: &'a [f64],
    free_throw_shooter: &'a [f64],
    offensive_rebound_mean: f64,
    defensive_rebound_mean: f64,
    spacing: f64,
    pressure: f64,
    steal_probability: f64,
    turnover: [&'a [f64]; 2],
    actions: &'a [f64],
    passes: &'a [f64],
    teammates: &'a [f64],
    zones: &'a [f64],
    defenders: &'a [f64],
    contests: &'a [f64],
    shot: [[&'a [f64]; 7]; 2],
    anchor: &'a [f64],
    block_value: [&'a [f64]; 2],
    block_max: [&'a [f64]; 2],
    shooting_foul: &'a [f64],
    assist: [&'a [f64]; 2],
    make_adjustment: &'a [f64],
    assist_adjustment: f64,
    adjusted: Adjusted<'a>,
}
impl<'a> Team<'a> {
    fn read(r: &mut Reader<'a>, count: usize, shooters: usize) -> Self {
        let initiator = r.slice(count + 1);
        let fouler = r.slice(count + 1);
        let stealer = r.slice(count + 1);
        let offensive_rebound = r.slice(count + 1);
        let defensive_rebound = r.slice(count + 1);
        let free_throw = r.slice(count);
        let free_throw_shooter = r.slice(count + 1);
        let offensive_rebound_mean = r.f();
        let defensive_rebound_mean = r.f();
        let spacing = r.f();
        let pressure = r.f();
        let steal_probability = r.f();
        let turnover = [r.slice(count), r.slice(count)];
        let actions = r.slice(count * 6 * 8);
        let passes = r.slice(count * 7);
        let teammates = r.slice(count * 7 * count);
        let zones = r.slice(count * 7 * 6);
        let defenders = r.slice(5 * count * (count + 1));
        let contests = r.slice(count * 5);
        let cell = count * 7 * 5;
        let mut shot = [[&[] as &[f64]; 7]; 2];
        for variant in 0..2 {
            for component in 0..7 {
                shot[variant][component] = r.slice(cell);
            }
        }
        let anchor = r.slice(count);
        let block_value = [r.slice(cell), r.slice(cell)];
        let block_max = [r.slice(cell), r.slice(cell)];
        let shooting_foul = r.slice(count * shooters * 5);
        let assist_cell = count * count * 7 * 5;
        let assist = [r.slice(assist_cell), r.slice(assist_cell)];
        let make_adjustment = r.slice(count * 2);
        let assist_adjustment = r.f();
        let struck = r.f() != 0.0;
        let adjusted_count = r.usize();
        let adjusted = if struck {
            let map = r.slice(adjusted_count);
            let defensive_rebound_mean = r.f();
            let stealer = r.slice(adjusted_count + 1);
            let defensive_rebound = r.slice(adjusted_count + 1);
            let defenders = r.slice(5 * shooters * (adjusted_count + 1));
            let uniform = r.slice(adjusted_count + 1);
            Adjusted {
                struck,
                count: adjusted_count,
                map,
                defensive_rebound_mean,
                stealer,
                defensive_rebound,
                defenders,
                uniform,
            }
        } else {
            Adjusted::none()
        };
        Self {
            count,
            initiator,
            fouler,
            stealer,
            offensive_rebound,
            defensive_rebound,
            free_throw,
            free_throw_shooter,
            offensive_rebound_mean,
            defensive_rebound_mean,
            spacing,
            pressure,
            steal_probability,
            turnover,
            actions,
            passes,
            teammates,
            zones,
            defenders,
            contests,
            shot,
            anchor,
            block_value,
            block_max,
            shooting_foul,
            assist,
            make_adjustment,
            assist_adjustment,
            adjusted,
        }
    }
    fn shot_index(&self, shooter: usize, action: usize, zone: usize) -> usize {
        (shooter * 7 + action) * 5 + zone
    }
}

struct Rng {
    state: u32,
    internal: bool,
}
impl Rng {
    fn next(&mut self) -> f64 {
        if !self.internal {
            return unsafe { rng_next() };
        }
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = (self.state ^ (self.state >> 15)).wrapping_mul(1 | self.state);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    fn chance(&mut self, probability: f64) -> bool {
        if !self.internal {
            return unsafe { rng_chance(probability) != 0 };
        }
        if probability <= 0.0 {
            false
        } else if probability >= 1.0 {
            true
        } else {
            self.next() < probability
        }
    }
    fn pick(&mut self, table: &[f64]) -> usize {
        if !self.internal {
            return unsafe { rng_pick(table.as_ptr(), table.len() as u32) as usize };
        }
        let count = table.len() - 1;
        if table[0] <= 0.0 {
            return if count == 1 {
                0
            } else {
                (self.next() * count as f64).floor() as usize
            };
        }
        let mut roll = self.next() * table[0];
        for index in 0..count {
            let weight = table[index + 1];
            if roll < weight {
                return index;
            }
            roll -= weight;
        }
        count - 1
    }
}

const START_MADE: usize = 1;
const START_DEAD: usize = 2;
const START_TURNOVER: usize = 3;
const START_DEFENSIVE_REBOUND: usize = 4;
const START_OFFENSIVE_REBOUND: usize = 5;

#[derive(Clone, Copy)]
struct Plan {
    has: bool,
    defender: i32,
    contest_scale: f64,
    contest_delta: f64,
    make_delta: f64,
    block_delta: f64,
    shot_kind: usize,
    putback: bool,
    reach_contest: [f64; 10],
    reach_block: [f64; 10],
}

impl Plan {
    fn none() -> Self {
        Self {
            has: false,
            defender: -1,
            contest_scale: 1.0,
            contest_delta: 0.0,
            make_delta: 0.0,
            block_delta: 0.0,
            shot_kind: 0,
            putback: false,
            reach_contest: [0.0; 10],
            reach_block: [0.0; 10],
        }
    }
}

#[derive(Clone, Copy)]
struct FoulAwards {
    free_throws: usize,
    bonus_attempts: usize,
    technical: usize,
    technical_for_defense: bool,
    double_or_nothing: usize,
}

impl FoulAwards {
    fn none() -> Self {
        Self {
            free_throws: 0,
            bonus_attempts: 0,
            technical: 0,
            technical_for_defense: false,
            double_or_nothing: 0,
        }
    }
}

#[derive(Clone, Copy)]
struct FreeThrows {
    continues: bool,
    live_rebound_end: bool,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
struct Outcome {
    continues: bool,
    live_rebound_end: bool,
    shooter: i32,
    defender: i32,
}

struct Trip<'a> {
    c: &'a Constants,
    teams: &'a [Team<'a>; 2],
    dynamic: &'a [f64],
    battle: u32,
    rng: Rng,
    offense: usize,
    remaining: f64,
    started_remaining: f64,
    period_index: usize,
    period_fouls: [f64; 2],
    personal: [[f64; 10]; 2],
    possession_start: usize,
    clock: Option<f64>,
    dead: bool,
    foul_index: usize,
    continuations: usize,
    rush_penalty: f64,
    handler: i32,
    shooter: i32,
    defender: i32,
    trip_rebounds: [f64; 2],
    stats: [[[f64; STAT_FIELDS]; MAX_UNITS]; 2],
    race_decided: usize,
    race_home: f64,
    race_away: f64,
    race_target: f64,
    evidence_base: usize,
    done: bool,
    ended: bool,
    period_ended: bool,
}

impl Trip<'_> {
    fn evidence_variant(&self, side: usize, player: usize) -> usize {
        let base = self.evidence_base + if side == 0 { 0 } else { self.teams[0].count };
        (self.dynamic[base + player] as usize).min(1)
    }
    fn sync(&self) {
        if self.battle != 0 {
            battle_sync(self.battle, self.remaining, self.clock);
            return;
        }
        unsafe {
            hook_sync(
                self.remaining,
                self.clock.unwrap_or(-1.0),
                self.clock.is_some() as u32,
            );
        }
    }
    fn host_full_clock(&self, side: usize) -> f64 {
        if self.battle != 0 {
            return battle_full_clock(self.battle, side);
        }
        unsafe { hook_full_clock(side as u32) }
    }
    fn host_rebound_clock(&self, side: usize) -> f64 {
        if self.battle != 0 {
            return battle_rebound_clock(self.battle, side);
        }
        unsafe { hook_rebound_clock(side as u32) }
    }
    fn host_shot_clock_violation(&mut self, side: usize, limit: f64) {
        if self.battle != 0 {
            battle_shot_clock_violation(self.battle, side, limit, self.remaining);
            return;
        }
        unsafe {
            hook_shot_clock_violation(side as u32, limit);
        }
    }
    fn host_cancel_turnover(&mut self, offense: usize, handler: usize) -> bool {
        if self.battle != 0 {
            return battle_cancel_turnover(self.battle, offense, handler);
        }
        unsafe { hook_cancel_turnover(offense as u32, handler as u32) != 0 }
    }
    fn host_turnover(&mut self, offense: usize, handler: usize, cancelled: bool) {
        if self.battle != 0 {
            battle_turnover(self.battle, offense, handler, cancelled);
            return;
        }
        unsafe {
            hook_turnover(offense as u32, handler as u32, cancelled as u32);
        }
    }
    fn host_steal(&mut self, defense: usize, stealer: usize) {
        if self.battle != 0 {
            battle_steal(self.battle, defense, stealer);
            return;
        }
        unsafe {
            hook_steal(defense as u32, stealer as u32);
        }
    }
    fn host_pass_intercepted(&mut self, offense: usize, passer: usize, defender: usize) {
        if self.battle != 0 {
            battle_pass_intercepted(self.battle, offense, passer, defender);
            return;
        }
        unsafe {
            hook_pass_intercepted(passer as u32, defender as u32);
        }
    }
    fn host_plan(
        &mut self,
        offense: usize,
        defense: usize,
        shooter: usize,
        zone: usize,
        action: usize,
        passed: bool,
    ) -> Plan {
        if self.battle != 0 {
            return battle_plan_shot(self.battle, offense, defense, shooter, zone, action, passed);
        }
        let out = core::ptr::addr_of_mut!(HOOK_OUT).cast::<f64>();
        let has = unsafe {
            hook_shot_plan(
                out,
                offense as u32,
                defense as u32,
                shooter as u32,
                zone as u32,
                action as u32,
                passed as u32,
            ) != 0
        };
        if !has {
            return Plan::none();
        }
        let values = unsafe { core::slice::from_raw_parts(out, 28) };
        let mut reach_contest = [0.0; 10];
        let mut reach_block = [0.0; 10];
        for index in 0..10 {
            reach_contest[index] = values[8 + index];
            reach_block[index] = values[18 + index];
        }
        Plan {
            has: true,
            defender: values[0] as i32,
            contest_scale: values[1],
            contest_delta: values[2],
            make_delta: values[3],
            block_delta: values[4],
            shot_kind: values[5] as usize,
            putback: values[6] != 0.0,
            reach_contest,
            reach_block,
        }
    }
    fn host_foul(
        &mut self,
        fouler: usize,
        fouler_side: usize,
        offense_side: usize,
        shooter: i32,
        shooting: bool,
        made_shot: bool,
        in_bonus: bool,
        zone: i32,
    ) -> FoulAwards {
        if self.battle != 0 {
            return battle_foul(
                self.battle,
                fouler,
                fouler_side,
                offense_side,
                shooter,
                shooting,
                made_shot,
                in_bonus,
                zone,
            );
        }
        if !self.c.has_havoc {
            return FoulAwards::none();
        }
        let out = core::ptr::addr_of_mut!(HOOK_OUT).cast::<f64>();
        let has = unsafe {
            hook_foul(
                out,
                fouler_side as u32,
                fouler as u32,
                offense_side as u32,
                shooter,
                shooting as u32,
                made_shot as u32,
                in_bonus as u32,
                zone,
            ) != 0
        };
        if !has {
            return FoulAwards::none();
        }
        let values = unsafe { core::slice::from_raw_parts(out, 8) };
        FoulAwards {
            free_throws: values[0] as usize,
            bonus_attempts: values[1] as usize,
            technical: values[2] as usize,
            technical_for_defense: values[3] != 0.0,
            double_or_nothing: values[4] as usize,
        }
    }
    fn host_field_goal(
        &mut self,
        offense: usize,
        shooter: usize,
        made: bool,
        three: bool,
        passed: bool,
        shot_kind: usize,
        putback: bool,
        zone: usize,
    ) {
        if self.battle != 0 {
            battle_field_goal(
                self.battle,
                offense,
                shooter,
                made,
                three,
                passed,
                shot_kind,
                putback,
                zone,
            );
            return;
        }
        unsafe {
            hook_field_goal(
                offense as u32,
                shooter as u32,
                made as u32,
                three as u32,
                passed as u32,
                shot_kind as u32,
                putback as u32,
                zone as u32,
            );
        }
    }
    fn host_free_throw(&mut self, side: usize, shooter: usize, made: bool, bonus: bool) {
        if self.battle != 0 {
            battle_free_throw(self.battle, side, shooter, made, bonus);
            return;
        }
        unsafe {
            hook_free_throw(side as u32, shooter as u32, made as u32, bonus as u32);
        }
    }
    fn host_assist(&mut self, offense: usize, assister: usize, scorer: usize) {
        if self.battle != 0 {
            battle_assist(self.battle, offense, assister, scorer);
            return;
        }
        unsafe {
            hook_assist(offense as u32, assister as u32, scorer as u32);
        }
    }
    fn host_rebound(&mut self, side: usize, rebounder: usize, offensive: bool) {
        if self.battle != 0 {
            battle_rebound(self.battle, side, rebounder, offensive);
            return;
        }
        unsafe {
            hook_rebound(side as u32, rebounder as u32, offensive as u32);
        }
    }
    fn host_block(&mut self, defense: usize, blocker: usize, shooter: usize) {
        if self.battle != 0 {
            battle_block(self.battle, defense, blocker, shooter);
            return;
        }
        unsafe {
            hook_block(defense as u32, blocker as u32, shooter as u32);
        }
    }
    fn consume(&mut self, seconds: f64) -> f64 {
        let consumed = if seconds < self.remaining {
            seconds
        } else {
            self.remaining
        };
        self.remaining -= consumed;
        consumed
    }
    fn add(&mut self, side: usize, unit: usize, field: usize) {
        self.stats[side][0][field] += 1.0;
        self.stats[side][unit][field] += 1.0;
    }
    fn points(&mut self, side: usize, unit: usize, points: f64) {
        self.stats[side][0][0] += points;
        self.stats[side][unit][0] += points;
    }
    fn team_add(&mut self, side: usize, field: usize) {
        self.stats[side][0][field] += 1.0;
    }
    fn foul(&mut self, side: usize, player: usize) {
        self.add(side, player + 1, 13);
        self.period_fouls[side] += 1.0;
    }
    fn record_personal_foul(&mut self, side: usize, player: usize) {
        self.personal[side][player] += 1.0;
    }
    fn avoidance(&self, side: usize, player: usize) -> f64 {
        let trouble = (self.personal[side][player] - self.c.foul_trouble_start).max(0.0);
        (1.0 - self.c.foul_avoid_per * trouble * trouble).max(self.c.foul_avoid_floor)
    }
    fn fouler(&mut self, side: usize) -> usize {
        loop {
            let table = self.teams[side].fouler;
            let player = self.rng.pick(table);
            if self.rng.chance(self.avoidance(side, player)) {
                return player;
            }
        }
    }
    fn rebound_probability(&self, offense: usize, defense: usize, zone: usize) -> f64 {
        let team = &self.teams[offense];
        let defense_team = &self.teams[defense];
        let defensive_mean = if defense_team.adjusted.struck {
            defense_team.adjusted.defensive_rebound_mean
        } else {
            defense_team.defensive_rebound_mean
        };
        let ratio = (team.offensive_rebound_mean - defensive_mean) / self.c.off_rebound_range;
        let zone_adjust = if zone < 2 {
            self.c.off_rebound_rim_bonus
        } else {
            -self.c.off_rebound_perimeter_penalty
        };
        let base = self.c.off_rebound_rate + ratio * self.c.off_rebound_scale + zone_adjust;
        0.45_f64.min(0.12_f64.max(base))
    }
    fn record_rebound_chances(&mut self, offense: usize, defense: usize) {
        for unit in 1..=self.teams[offense].count {
            self.stats[offense][unit][21] += 1.0;
        }
        for unit in 1..=self.teams[defense].count {
            self.stats[defense][unit][22] += 1.0;
        }
        self.team_add(offense, 17);
        self.trip_rebounds[offense] += 1.0;
        self.trip_rebounds[defense] += 1.0;
    }
    fn rebound_clock(&self, side: usize) -> f64 {
        if self.c.has_havoc {
            self.host_rebound_clock(side).min(14.0)
        } else {
            14.0
        }
    }
    fn offensive_rebound(&mut self, offense: usize) -> usize {
        let table = self.teams[offense].offensive_rebound;
        let player = self.rng.pick(table);
        self.add(offense, player + 1, 7);
        if self.c.has_havoc {
            self.host_rebound(offense, player, true);
        }
        self.possession_start = START_OFFENSIVE_REBOUND;
        if self.clock.is_some() {
            self.clock = Some(self.rebound_clock(offense));
        }
        player
    }
    fn adjusted_index(&self, side: usize, index: usize) -> usize {
        let adjusted = &self.teams[side].adjusted;
        if adjusted.struck && index < adjusted.count {
            adjusted.map[index] as usize
        } else {
            index
        }
    }
    fn record_trip(&mut self) {
        if !self.c.has_effects {
            return;
        }
        unsafe {
            hook_effects_trip(
                (self.handler >= 0) as u32,
                self.handler.max(0) as u32,
                (self.shooter >= 0) as u32,
                self.shooter.max(0) as u32,
                (self.defender >= 0) as u32,
                self.defender.max(0) as u32,
                self.trip_rebounds[0],
                self.trip_rebounds[1],
            );
        }
    }
    fn finish_end(&mut self, ended: bool, period_ended: bool) {
        self.record_trip();
        self.done = true;
        self.ended = ended;
        self.period_ended = period_ended;
    }
    fn finish_plain(&mut self, ended: bool, period_ended: bool) {
        self.done = true;
        self.ended = ended;
        self.period_ended = period_ended;
    }
    fn race_points(&mut self, side: usize, points: f64) {
        if !self.c.has_race || self.race_decided != 0 {
            return;
        }
        if side == 0 {
            self.race_home += points;
        } else {
            self.race_away += points;
        }
        if self.race_home >= self.race_target {
            self.race_decided = 1;
        } else if self.race_away >= self.race_target {
            self.race_decided = 2;
        }
    }
    fn sample_havoc(&mut self) {
        if self.remaining < self.c.min_start {
            self.finish_plain(false, true);
            return;
        }
        let offense = self.offense;
        let full = self.host_full_clock(offense);
        let raw = self.c.mean_trip * (0.6 + self.rng.next() * 0.8);
        let planned = if full == self.c.shot_clock {
            (raw * full / self.c.shot_clock).max(self.c.min_trip)
        } else {
            raw.max(self.c.min_trip)
        };
        let clock = self.clock.unwrap_or(0.0);
        if planned > clock && planned <= self.remaining {
            let overrun = if planned > 0.0 {
                ((planned - clock) / planned).max(0.0).min(1.0)
            } else {
                0.0
            };
            let violation_probability = (overrun * 0.35).min(0.25);
            let violation = self.rng.chance(violation_probability);
            let make_penalty = (0.02 + overrun * 0.3).min(0.1);
            if violation {
                let table = self.teams[offense].initiator;
                let handler = self.rng.pick(table);
                self.handler = handler as i32;
                let seconds = clock.max(0.0).min(self.remaining);
                self.consume(seconds);
                self.clock = Some(0.0);
                self.add(offense, handler + 1, 12);
                self.team_add(offense, 24);
                self.sync();
                self.host_shot_clock_violation(offense, full);
                self.team_add(offense, 15);
                self.possession_start = START_DEAD;
                let period_ended = self.remaining <= 0.0;
                self.finish_end(true, period_ended);
                return;
            }
            let seconds = clock.max(0.0).min(self.remaining);
            let rushed = self.consume(seconds);
            self.clock = Some(0.0);
            self.rush_penalty = make_penalty;
            self.dead = rushed >= self.started_remaining - self.c.min_start;
        } else {
            let consumed = self.consume(planned.min(self.remaining));
            let clock = self.clock.unwrap_or(0.0) - consumed;
            self.clock = Some(clock.max(0.0));
            if self.remaining <= 0.0 {
                self.finish_plain(false, true);
                return;
            }
            self.dead = consumed >= self.started_remaining - self.c.min_start;
        }
        self.phase_security();
    }
    fn sample_twenty(&mut self) {
        if self.remaining < self.c.min_start {
            self.finish_plain(false, true);
            return;
        }
        let offense = self.offense;
        let clock = self.clock.unwrap_or(0.0);
        let raw = self.c.mean_trip * (0.6 + self.rng.next() * 0.8);
        let planned = (raw * 20.0 / 24.0).max(self.c.min_trip);
        if planned > clock && planned <= self.remaining {
            let table = self.teams[offense].initiator;
            let handler = self.rng.pick(table);
            self.handler = handler as i32;
            let seconds = clock.min(self.remaining);
            self.consume(seconds);
            self.clock = Some(0.0);
            self.add(offense, handler + 1, 12);
            self.team_add(offense, 24);
            self.team_add(offense, 15);
            self.possession_start = START_DEAD;
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        let consumed = self.consume(planned.min(self.remaining));
        let clock = self.clock.unwrap_or(0.0) - consumed;
        self.clock = Some(clock.max(0.0));
        if self.remaining <= 0.0 {
            self.finish_plain(false, true);
            return;
        }
        self.dead = consumed >= self.started_remaining - self.c.min_start;
        self.phase_security();
    }
    fn sample_generic(&mut self) {
        if self.remaining < self.c.min_start {
            self.finish_plain(false, true);
            return;
        }
        let raw = self.c.mean_trip * (0.6 + self.rng.next() * 0.8);
        let clamped = raw.max(self.c.min_trip).min(self.c.shot_clock);
        let sampled = clamped.min(self.remaining);
        let consumed = self.consume(sampled);
        self.dead = consumed >= self.started_remaining - self.c.min_start;
        self.phase_security();
    }
    fn phase_security(&mut self) {
        self.sync();
        let offense = self.offense;
        let defense = 1 - offense;
        let forced = self.dynamic[11 + offense] as i32;
        let handler = if forced >= 0 {
            forced as usize
        } else {
            let table = self.teams[offense].initiator;
            self.rng.pick(table)
        };
        self.handler = handler as i32;
        let evidence_variant = if self.c.has_havoc {
            self.evidence_variant(offense, handler)
        } else {
            0
        };
        let probability = self.teams[offense].turnover[evidence_variant][handler];
        if self.rng.chance(probability) {
            let cancelled = if self.c.has_havoc {
                self.host_cancel_turnover(offense, handler)
            } else {
                false
            };
            if self.c.has_havoc {
                self.host_turnover(offense, handler, cancelled);
            }
            if cancelled {
                self.phase_foul();
                return;
            }
            self.add(offense, handler + 1, 12);
            let steal_probability = self.teams[defense].steal_probability;
            if self.rng.chance(steal_probability) {
                let adjusted = self.teams[defense].adjusted.struck;
                let picked = if adjusted {
                    let table = self.teams[defense].adjusted.stealer;
                    self.rng.pick(table)
                } else {
                    let table = self.teams[defense].stealer;
                    self.rng.pick(table)
                };
                let player = self.adjusted_index(defense, picked);
                self.add(defense, player + 1, 10);
                if self.c.has_havoc {
                    self.host_steal(defense, player);
                }
            }
            self.possession_start = START_TURNOVER;
            self.team_add(offense, 15);
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        self.phase_foul();
    }
    fn phase_foul(&mut self) {
        self.sync();
        let offense = self.offense;
        let defense = 1 - offense;
        if self.foul_index >= 4 {
            self.phase_shot();
            return;
        }
        self.foul_index += 1;
        if !self.rng.chance(self.c.non_shooting_foul) {
            self.phase_shot();
            return;
        }
        if self.rng.chance(self.c.offensive_foul_share) {
            let fouler = self.fouler(offense);
            let cancelled = if self.c.has_havoc {
                self.host_cancel_turnover(offense, fouler)
            } else {
                false
            };
            if self.c.has_havoc {
                self.host_turnover(offense, fouler, cancelled);
            }
            self.foul(offense, fouler);
            self.record_personal_foul(offense, fouler);
            let awards = self.call_foul(fouler, offense, offense, -1, false, false, false, -1);
            if !cancelled {
                self.add(offense, fouler + 1, 12);
            }
            if awards.technical > 0 && awards.technical_for_defense {
                self.granted_free_throw(defense, offense, true);
            }
            for _ in 0..awards.double_or_nothing {
                self.granted_free_throw(defense, offense, false);
            }
            if cancelled {
                self.phase_shot();
                return;
            }
            self.team_add(offense, 15);
            self.possession_start = START_DEAD;
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        let fouler = self.fouler(defense);
        self.foul(defense, fouler);
        self.record_personal_foul(defense, fouler);
        let in_bonus = self.period_fouls[defense]
            >= if self.period_index >= 4 {
                self.c.bonus_overtime
            } else {
                self.c.bonus_regulation
            };
        let awards = self.call_foul(fouler, defense, offense, -1, false, false, in_bonus, -1);
        if in_bonus {
            let shooter = if self.handler >= 0 {
                self.handler as usize
            } else {
                let table = self.teams[offense].initiator;
                self.rng.pick(table)
            };
            self.possession_start = START_DEAD;
            let attempts = 2 + awards.technical + awards.double_or_nothing;
            let bonus_attempts = 2 + awards.technical;
            let free_throws = self.resolve_free_throws(
                offense,
                defense,
                shooter,
                attempts,
                self.dead,
                bonus_attempts,
                awards.double_or_nothing,
            );
            if free_throws.continues {
                self.phase_continuation();
                return;
            }
            self.team_add(offense, 15);
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        if awards.technical > 0 || awards.double_or_nothing > 0 {
            let table = self.teams[offense].free_throw_shooter;
            let shooter = self.rng.pick(table);
            let attempts = awards.technical + awards.double_or_nothing;
            self.resolve_free_throws(
                offense,
                defense,
                shooter,
                attempts,
                true,
                awards.technical,
                awards.double_or_nothing,
            );
            self.possession_start = START_DEAD;
        }
        if let Some(clock) = self.clock {
            let reset = if self.c.has_havoc {
                self.host_full_clock(offense).min(14.0)
            } else {
                14.0
            };
            self.clock = Some(clock.max(reset));
        }
        self.phase_inbound();
    }
    fn phase_inbound(&mut self) {
        self.consume(self.c.inbound);
        if self.clock.is_some() {
            let value = self.clock.unwrap_or(0.0) - self.c.inbound;
            self.clock = Some(if self.c.has_havoc {
                value.max(0.0)
            } else {
                value
            });
        }
        self.phase_foul();
    }
    fn phase_shot(&mut self) {
        self.sync();
        let offense = self.offense;
        let defense = 1 - offense;
        let handler = if self.continuations == 0 {
            self.handler
        } else {
            -1
        };
        let outcome = self.resolve_shot(offense, defense, handler);
        self.shooter = outcome.shooter;
        self.defender = outcome.defender;
        if !outcome.continues {
            self.team_add(offense, 15);
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        if self.continuations >= 4 {
            self.team_add(offense, 15);
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        self.phase_continuation();
    }
    fn phase_continuation(&mut self) {
        let offense = self.offense;
        self.continuations += 1;
        self.consume(self.c.continuation);
        self.sync();
        if self.clock.is_some() {
            let value = self.clock.unwrap_or(0.0) - self.c.continuation;
            self.clock = Some(value.max(0.0));
        }
        if self.c.has_havoc && self.clock.unwrap_or(f64::INFINITY) <= 0.0 {
            let handler = self.handler.max(0) as usize;
            self.add(offense, handler + 1, 12);
            self.team_add(offense, 24);
            let full = self.host_full_clock(offense);
            self.host_shot_clock_violation(offense, full);
            self.team_add(offense, 15);
            let period_ended = self.remaining <= 0.0;
            self.finish_end(true, period_ended);
            return;
        }
        if self.remaining < self.c.min_start {
            self.team_add(offense, 15);
            self.finish_end(true, true);
            return;
        }
        self.phase_shot();
    }
    fn resolve_shot(&mut self, offense: usize, defense: usize, handler: i32) -> Outcome {
        let forced = self.dynamic[11 + offense] as i32;
        let initiator = if forced >= 0 {
            forced as usize
        } else if handler >= 0 {
            handler as usize
        } else {
            let table = self.teams[offense].initiator;
            self.rng.pick(table)
        };
        let action = if forced >= 0 {
            0
        } else {
            let table = self.teams[offense].actions;
            let start = self.possession_start;
            let offset = (initiator * 6 + start) * 8;
            self.rng.pick(&table[offset..offset + 8])
        };
        let mut shooter = initiator;
        let mut passed = false;
        if forced < 0 {
            let count = self.teams[offense].count;
            let passes = self.teams[offense].passes;
            let pass_probability = passes[initiator * 7 + action];
            if self.rng.chance(pass_probability) {
                let teammates = self.teams[offense].teammates;
                let offset = (initiator * 7 + action) * count;
                let index = self.rng.pick(&teammates[offset..offset + count]);
                shooter = if index >= initiator { index + 1 } else { index };
                passed = true;
            }
        }
        let interception = if passed {
            self.dynamic[13 + offense]
        } else {
            0.0
        };
        if interception > 0.0 && self.rng.chance(interception) {
            let cancelled = if self.c.has_havoc {
                self.host_cancel_turnover(offense, initiator)
            } else {
                false
            };
            if self.c.has_havoc {
                self.host_turnover(offense, initiator, cancelled);
            }
            if !cancelled {
                let adjusted = self.teams[defense].adjusted.struck;
                let picked = if adjusted {
                    let table = self.teams[defense].adjusted.stealer;
                    self.rng.pick(table)
                } else {
                    let table = self.teams[defense].stealer;
                    self.rng.pick(table)
                };
                let stealer = self.adjusted_index(defense, picked);
                self.add(offense, initiator + 1, 12);
                self.add(defense, stealer + 1, 10);
                if self.c.has_havoc {
                    self.host_steal(defense, stealer);
                    self.host_pass_intercepted(offense, initiator, stealer);
                }
                self.possession_start = START_TURNOVER;
                return Outcome {
                    continues: false,
                    live_rebound_end: true,
                    shooter: -1,
                    defender: -1,
                };
            }
        }
        let zones = self.teams[offense].zones;
        let offset = (shooter * 7 + action) * 6;
        let zone = self.rng.pick(&zones[offset..offset + 6]);
        let deep = self.c.deep_four && zone == 4 && self.rng.chance(self.c.deep_four_split);
        let mut rule_scale = if deep {
            self.c.deep_four_make_scale
        } else {
            1.0
        };
        if self.c.twenty_second {
            if let Some(clock) = self.clock {
                let pressure = if clock >= 4.0 {
                    1.0
                } else {
                    let clamped = clock.max(0.0);
                    1.0 - 0.1 * (1.0 - clamped / 4.0)
                };
                rule_scale *= pressure;
            }
        }
        let mut plan = if self.c.has_havoc {
            self.host_plan(offense, defense, shooter, zone, action, passed)
        } else {
            Plan::none()
        };
        let has_plan_defender = plan.has && plan.defender >= 0;
        let defender_raw = if has_plan_defender {
            plan.defender as usize
        } else {
            self.pick_defender(defense, zone, shooter, !self.c.has_havoc)
        };
        let defender =
            if !has_plan_defender && !self.c.has_havoc && self.teams[defense].adjusted.struck {
                self.adjusted_index(defense, defender_raw)
            } else {
                defender_raw
            };
        if plan.has && !has_plan_defender {
            plan.contest_delta = plan.reach_contest[defender];
            plan.block_delta = plan.reach_block[defender];
        }
        if defender < self.teams[defense].count {
            self.add(defense, defender + 1, 23);
        }
        let shooter_variant = if self.c.has_havoc {
            self.evidence_variant(offense, shooter)
        } else {
            0
        };
        let defender_variant = if self.c.has_havoc && defender < self.teams[defense].count {
            self.evidence_variant(defense, defender)
        } else {
            0
        };
        let three = zone >= 3;
        let defense_count = self.teams[defense].count;
        let foul_probability =
            self.teams[offense].shooting_foul[(shooter * defense_count + defender) * 5 + zone];
        let mut drawn = self.rng.chance(foul_probability);
        if drawn {
            drawn = self.rng.chance(self.avoidance(defense, defender));
        }
        if drawn {
            self.foul(defense, defender);
            self.record_personal_foul(defense, defender);
            let make_delta = if plan.has {
                plan.make_delta - self.rush_penalty
            } else {
                0.0
            };
            let mut probability = self.make_probability(
                offense,
                defense,
                shooter,
                action,
                zone,
                defender,
                shooter_variant,
                plan,
                make_delta,
            );
            probability *= self.c.fouled_shot_scale;
            let made = self.rng.chance(probability * rule_scale);
            let awards = self.call_foul(
                defender,
                defense,
                offense,
                shooter as i32,
                true,
                made,
                false,
                zone as i32,
            );
            self.field_goal_attempt(offense, shooter, zone, made, three, passed, deep);
            self.havoc_record(plan, offense, shooter, made, three, passed, zone);
            if made {
                self.race_points(
                    offense,
                    if deep {
                        4.0
                    } else if three {
                        3.0
                    } else {
                        2.0
                    },
                );
            }
            if self.race_decided != 0 {
                self.possession_start = START_DEAD;
                return Outcome {
                    continues: false,
                    live_rebound_end: false,
                    shooter: shooter as i32,
                    defender: defender as i32,
                };
            }
            let technical = awards.technical;
            let extra = awards.double_or_nothing;
            let bonus_attempts = awards.bonus_attempts + technical;
            let free_throws = if made {
                self.credit_assist(offense, shooter, initiator, action, zone, passed);
                self.resolve_free_throws(
                    offense,
                    defense,
                    shooter,
                    awards.free_throws.max(1) + technical + extra,
                    false,
                    bonus_attempts,
                    extra,
                )
            } else {
                self.team_add(defense, 14);
                let attempts = awards.free_throws.max(if deep {
                    self.c.deep_four_ft_miss
                } else if three {
                    3
                } else {
                    2
                });
                self.resolve_free_throws(
                    offense,
                    defense,
                    shooter,
                    attempts + technical + extra,
                    self.dead,
                    bonus_attempts,
                    extra,
                )
            };
            if free_throws.continues {
                return Outcome {
                    continues: true,
                    live_rebound_end: false,
                    shooter: shooter as i32,
                    defender: defender as i32,
                };
            }
            if !free_throws.live_rebound_end {
                self.possession_start = START_DEAD;
            }
            return Outcome {
                continues: false,
                live_rebound_end: free_throws.live_rebound_end,
                shooter: shooter as i32,
                defender: defender as i32,
            };
        }
        let block_index = (defender * 7 + action) * 5 + zone;
        let block_value = self.teams[defense].block_value[defender_variant][block_index];
        let block_maximum = self.teams[defense].block_max[defender_variant][block_index];
        let block_delta = if plan.has { plan.block_delta } else { 0.0 };
        let upper = block_maximum + if block_delta > 0.0 { block_delta } else { 0.0 };
        let block_probability = upper.min((block_value + block_delta).max(0.0));
        if self.rng.chance(block_probability) {
            self.add(defense, defender + 1, 11);
            if self.c.has_havoc {
                self.host_block(defense, defender, shooter);
            }
            self.field_goal_attempt(offense, shooter, zone, false, three, passed, deep);
            self.havoc_record(plan, offense, shooter, false, three, passed, zone);
            return self.rebound_after_miss(
                offense,
                defense,
                zone,
                self.dead,
                shooter as i32,
                defender as i32,
            );
        }
        let make_delta = if plan.has {
            plan.make_delta - self.rush_penalty
        } else {
            0.0
        };
        let base_probability = self.make_probability(
            offense,
            defense,
            shooter,
            action,
            zone,
            defender,
            shooter_variant,
            plan,
            make_delta,
        );
        let anchor = self.teams[offense].anchor[shooter];
        let shot_probability = if anchor >= 0.0 && !three {
            (base_probability / 0.5_f64.max(1.0 - block_probability)).min(0.97)
        } else {
            base_probability
        };
        let made = self.rng.chance(shot_probability * rule_scale);
        self.field_goal_attempt(offense, shooter, zone, made, three, passed, deep);
        self.havoc_record(plan, offense, shooter, made, three, passed, zone);
        if made {
            self.race_points(
                offense,
                if deep {
                    4.0
                } else if three {
                    3.0
                } else {
                    2.0
                },
            );
        }
        if made {
            self.credit_assist(offense, shooter, initiator, action, zone, passed);
            self.possession_start = START_MADE;
            return Outcome {
                continues: false,
                live_rebound_end: false,
                shooter: shooter as i32,
                defender: defender as i32,
            };
        }
        self.rebound_after_miss(
            offense,
            defense,
            zone,
            self.dead,
            shooter as i32,
            defender as i32,
        )
    }
    fn pick_defender(
        &mut self,
        defense: usize,
        zone: usize,
        shooter_slot: usize,
        use_adjusted: bool,
    ) -> usize {
        let count = self.teams[defense].count;
        let shooters = self.teams[self.offense].count;
        if use_adjusted && self.teams[defense].adjusted.struck {
            let adjusted = &self.teams[defense].adjusted;
            if shooter_slot < adjusted.count {
                let offset = (zone * shooters + shooter_slot) * (adjusted.count + 1);
                let slice = &adjusted.defenders[offset..offset + adjusted.count + 1];
                return self.rng.pick(slice);
            }
            let uniform = self.teams[defense].adjusted.uniform;
            return self.rng.pick(uniform);
        }
        let offset = (zone * shooters + shooter_slot) * (count + 1);
        let slice = &self.teams[defense].defenders[offset..offset + count + 1];
        self.rng.pick(slice)
    }
    fn make_probability(
        &mut self,
        offense: usize,
        defense: usize,
        shooter: usize,
        action: usize,
        zone: usize,
        defender: usize,
        variant: usize,
        plan: Plan,
        make_delta: f64,
    ) -> f64 {
        let index = self.teams[offense].shot_index(shooter, action, zone);
        let base = self.teams[offense].shot[variant][0][index];
        let skill = self.teams[offense].shot[variant][1][index];
        let era = self.teams[offense].shot[variant][2][index];
        let spacing = self.teams[offense].shot[variant][3][index];
        let quality = self.teams[offense].shot[variant][4][index];
        let calibration = self.teams[offense].shot[variant][5][index];
        let floor = self.teams[offense].shot[variant][6][index];
        let penalty = self.teams[defense].contests[defender * 5 + zone];
        let contest_scale = if plan.has { plan.contest_scale } else { 1.0 };
        let contest_delta = if plan.has { plan.contest_delta } else { 0.0 };
        let contest = -penalty * contest_scale + contest_delta + make_delta;
        let late = if self.remaining <= 4.0 {
            -(0.04 + ((4.0 - self.remaining) / 4.0).max(0.0).min(1.0) * 0.06)
        } else {
            0.0
        };
        let home = if defense == 0 {
            self.c.home_defense
        } else {
            0.0
        };
        let effects = self.teams[offense].make_adjustment[shooter * 2 + defense];
        let raw =
            base + skill + contest + era + spacing + quality + late + calibration + home + effects;
        0.97_f64.min(floor.max(0.03_f64.max(raw)))
    }
    fn field_goal_attempt(
        &mut self,
        side: usize,
        player: usize,
        zone: usize,
        made: bool,
        three: bool,
        passed: bool,
        deep: bool,
    ) {
        let unit = player + 1;
        self.add(side, unit, 2);
        self.add(side, unit, 25 + zone);
        if made {
            self.add(side, unit, 1);
            self.add(side, unit, 30 + zone);
            self.team_add(side, if passed { 18 } else { 19 });
            self.points(
                side,
                unit,
                if deep {
                    4.0
                } else if three {
                    3.0
                } else {
                    2.0
                },
            );
        }
        if deep {
            self.add(side, unit, 35);
            if made {
                self.add(side, unit, 36);
            }
        } else if three {
            self.add(side, unit, 4);
            if made {
                self.add(side, unit, 3);
            }
        }
    }
    fn credit_assist(
        &mut self,
        offense: usize,
        shooter: usize,
        initiator: usize,
        action: usize,
        zone: usize,
        passed: bool,
    ) {
        if !passed {
            return;
        }
        self.stats[offense][initiator + 1][20] += 1.0;
        let variant = if self.c.has_havoc {
            self.evidence_variant(offense, initiator)
        } else {
            0
        };
        let count = self.teams[offense].count;
        let index = ((initiator * count + shooter) * 7 + action) * 5 + zone;
        let base = self.teams[offense].assist[variant][index];
        let adjustment = self.teams[offense].assist_adjustment;
        let probability = 0.99_f64.min(0.05_f64.max(base + adjustment));
        if !self.rng.chance(probability) {
            return;
        }
        self.add(offense, initiator + 1, 9);
        if self.c.has_havoc {
            self.host_assist(offense, initiator, shooter);
        }
    }
    fn resolve_free_throws(
        &mut self,
        offense: usize,
        defense: usize,
        shooter: usize,
        attempts: usize,
        dead_ball: bool,
        bonus_attempts: usize,
        trailing_attempts: usize,
    ) -> FreeThrows {
        let probability = self.teams[offense].free_throw[shooter];
        let bonus_from = attempts.saturating_sub(trailing_attempts + bonus_attempts);
        let bonus_until = attempts.saturating_sub(trailing_attempts);
        let mut outcome = FreeThrows {
            continues: false,
            live_rebound_end: false,
        };
        for index in 0..attempts {
            if self.race_decided != 0 {
                break;
            }
            let last = index == attempts - 1;
            let made = self.rng.chance(probability);
            self.add(offense, shooter + 1, 6);
            if made {
                self.add(offense, shooter + 1, 5);
                self.points(offense, shooter + 1, 1.0);
            }
            if self.c.has_havoc {
                let bonus = bonus_attempts > 0 && index >= bonus_from && index < bonus_until;
                self.host_free_throw(offense, shooter, made, bonus);
            }
            if made {
                self.race_points(offense, 1.0);
                continue;
            }
            if last {
                if dead_ball {
                    self.team_add(defense, 14);
                } else {
                    outcome = self.rebound_from_live_missed_free_throw(offense, defense);
                }
                break;
            }
            self.team_add(defense, 14);
        }
        self.team_add(offense, 16);
        outcome
    }
    fn rebound_from_live_missed_free_throw(
        &mut self,
        offense: usize,
        defense: usize,
    ) -> FreeThrows {
        self.record_rebound_chances(offense, defense);
        let ratio = (self.teams[offense].offensive_rebound_mean
            - self.teams[defense].defensive_rebound_mean)
            / self.c.off_rebound_range;
        let base = self.c.off_rebound_rate
            + ratio * self.c.off_rebound_scale
            + self.c.off_rebound_rim_bonus;
        let probability = 0.45_f64.min(0.12_f64.max(base));
        if self.rng.chance(probability) {
            self.offensive_rebound(offense);
            return FreeThrows {
                continues: true,
                live_rebound_end: false,
            };
        }
        let table = self.teams[defense].defensive_rebound;
        let rebounder = self.rng.pick(table);
        self.add(defense, rebounder + 1, 8);
        if self.c.has_havoc {
            self.host_rebound(defense, rebounder, false);
        }
        self.possession_start = START_DEFENSIVE_REBOUND;
        FreeThrows {
            continues: false,
            live_rebound_end: true,
        }
    }
    fn rebound_after_miss(
        &mut self,
        offense: usize,
        defense: usize,
        zone: usize,
        dead: bool,
        shooter: i32,
        defender: i32,
    ) -> Outcome {
        if !dead {
            self.record_rebound_chances(offense, defense);
        }
        if dead {
            self.team_add(defense, 14);
            self.possession_start = START_DEAD;
            return Outcome {
                continues: false,
                live_rebound_end: false,
                shooter,
                defender,
            };
        }
        let probability = self.rebound_probability(offense, defense, zone);
        if self.rng.chance(probability) {
            self.offensive_rebound(offense);
            return Outcome {
                continues: true,
                live_rebound_end: false,
                shooter,
                defender,
            };
        }
        let adjusted = self.teams[defense].adjusted.struck;
        let picked = if adjusted {
            let table = self.teams[defense].adjusted.defensive_rebound;
            let picked = self.rng.pick(table);
            self.adjusted_index(defense, picked)
        } else {
            let table = self.teams[defense].defensive_rebound;
            self.rng.pick(table)
        };
        self.add(defense, picked + 1, 8);
        if self.c.has_havoc {
            self.host_rebound(defense, picked, false);
        }
        self.possession_start = START_DEFENSIVE_REBOUND;
        Outcome {
            continues: false,
            live_rebound_end: true,
            shooter,
            defender,
        }
    }
    fn granted_free_throw(&mut self, offense: usize, defense: usize, bonus: bool) {
        let table = self.teams[offense].free_throw_shooter;
        let shooter = self.rng.pick(table);
        self.resolve_free_throws(
            offense,
            defense,
            shooter,
            1,
            true,
            if bonus { 1 } else { 0 },
            0,
        );
    }
    fn call_foul(
        &mut self,
        fouler: usize,
        fouler_side: usize,
        offense_side: usize,
        shooter: i32,
        shooting: bool,
        made_shot: bool,
        in_bonus: bool,
        zone: i32,
    ) -> FoulAwards {
        if !self.c.has_havoc {
            return FoulAwards::none();
        }
        self.host_foul(
            fouler,
            fouler_side,
            offense_side,
            shooter,
            shooting,
            made_shot,
            in_bonus,
            zone,
        )
    }
    fn havoc_record(
        &mut self,
        plan: Plan,
        offense: usize,
        shooter: usize,
        made: bool,
        three: bool,
        passed: bool,
        zone: usize,
    ) {
        if !self.c.has_havoc || !plan.has {
            return;
        }
        self.host_field_goal(
            offense,
            shooter,
            made,
            three,
            passed,
            plan.shot_kind,
            plan.putback,
            zone,
        );
    }
    fn write_output(&self) {
        let output = unsafe { core::slice::from_raw_parts_mut(output_ptr(), OUTPUT_CAPACITY) };
        output[0] = self.ended as u32 as f64;
        output[1] = self.period_ended as u32 as f64;
        output[2] = self.remaining;
        output[3] = self.period_fouls[0];
        output[4] = self.period_fouls[1];
        output[5] = self.possession_start as f64;
        output[6] = self.clock.unwrap_or(-1.0);
        output[7] = (self.handler >= 0) as u32 as f64;
        output[8] = self.handler.max(0) as f64;
        output[9] = (self.shooter >= 0) as u32 as f64;
        output[10] = self.shooter.max(0) as f64;
        output[11] = (self.defender >= 0) as u32 as f64;
        output[12] = self.defender.max(0) as f64;
        output[13] = self.trip_rebounds[0];
        output[14] = self.trip_rebounds[1];
        output[15] = self.race_home;
        output[16] = self.race_away;
        output[17] = self.race_decided as f64;
        output[18] = self.rng.state as f64;
        let mut cursor = 19;
        for side in 0..2 {
            for player in 0..self.teams[side].count {
                output[cursor] = self.personal[side][player];
                cursor += 1;
            }
        }
        for side in 0..2 {
            for unit in 0..=self.teams[side].count {
                for field in 0..STAT_FIELDS {
                    output[cursor] = self.stats[side][unit][field];
                    cursor += 1;
                }
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn run_trip() -> u32 {
    let data = unsafe { core::slice::from_raw_parts(input_ptr(), CAPACITY) };
    let mut reader = Reader { data, cursor: 0 };
    if reader.f() != 1.0 {
        return 1;
    }
    let dynamic_offset = reader.usize();
    let mut c = Constants {
        mean_trip: reader.f(),
        era_poss: reader.f(),
        pass_anchor: reader.f(),
        min_start: reader.f(),
        min_trip: reader.f(),
        shot_clock: reader.f(),
        inbound: reader.f(),
        continuation: reader.f(),
        non_shooting_foul: reader.f(),
        offensive_foul_share: reader.f(),
        foul_trouble_start: reader.f(),
        foul_avoid_per: reader.f(),
        foul_avoid_floor: reader.f(),
        bonus_regulation: reader.f(),
        bonus_overtime: reader.f(),
        fouled_shot_scale: reader.f(),
        home_defense: reader.f(),
        away_turnover: reader.f(),
        has_havoc: reader.f() != 0.0,
        twenty_second: reader.f() != 0.0,
        deep_four: reader.f() != 0.0,
        has_race: reader.f() != 0.0,
        has_effects: reader.f() != 0.0,
        has_apron: reader.f() != 0.0,
        off_rebound_rate: reader.f(),
        off_rebound_scale: reader.f(),
        off_rebound_range: reader.f(),
        off_rebound_rim_bonus: reader.f(),
        off_rebound_perimeter_penalty: reader.f(),
        deep_four_split: reader.f(),
        deep_four_make_scale: reader.f(),
        deep_four_ft_miss: reader.f() as usize,
        internal_rng: false,
    };
    let count0 = reader.usize();
    let count1 = reader.usize();
    let _struck0 = reader.f();
    let _struck1 = reader.f();
    let internal_rng = reader.f() != 0.0;
    c.internal_rng = internal_rng;
    if count0 < 2 || count0 > 10 || count1 < 2 || count1 > 10 {
        return 2;
    }
    let team0 = Team::read(&mut reader, count0, count1);
    let team1 = Team::read(&mut reader, count1, count0);
    let teams = [team0, team1];
    if reader.cursor != dynamic_offset {
        return 4;
    }
    let dynamic = &data[dynamic_offset..];
    let offense = dynamic[0] as usize;
    if offense > 1 {
        return 3;
    }
    let clock_init = dynamic[6];
    let mut personal = [[0.0_f64; 10]; 2];
    let evidence_base = 16 + count0 + count1;
    let mut cursor = 16;
    for side in 0..2 {
        for player in 0..teams[side].count {
            personal[side][player] = dynamic[cursor];
            cursor += 1;
        }
    }
    unsafe {
        (&mut *core::ptr::addr_of_mut!(OUTPUT)).fill(0.0);
    }
    let mut trip = Trip {
        c: &c,
        teams: &teams,
        dynamic,
        battle: 0,
        rng: Rng {
            state: dynamic[15] as u32,
            internal: c.internal_rng,
        },
        offense,
        remaining: dynamic[1],
        started_remaining: dynamic[1],
        period_index: dynamic[2] as usize,
        period_fouls: [dynamic[3], dynamic[4]],
        personal,
        possession_start: dynamic[5] as usize,
        clock: if clock_init >= 0.0 {
            Some(clock_init)
        } else {
            None
        },
        dead: false,
        foul_index: 0,
        continuations: 0,
        rush_penalty: 0.0,
        handler: -1,
        shooter: -1,
        defender: -1,
        trip_rebounds: [0.0, 0.0],
        stats: [[[0.0; STAT_FIELDS]; MAX_UNITS]; 2],
        race_decided: dynamic[7] as usize,
        race_home: dynamic[8],
        race_away: dynamic[9],
        race_target: dynamic[10],
        evidence_base,
        done: false,
        ended: false,
        period_ended: false,
    };
    if c.has_havoc {
        trip.sample_havoc();
    } else if c.twenty_second && trip.clock.is_some() {
        trip.sample_twenty();
    } else {
        trip.sample_generic();
    }
    trip.write_output();
    0
}

// ---------------------------------------------------------------------------
// Havoc battle kernel
//
// The battle kernel owns participant state, mutation execution, scoring
// attribution, the event/scoring ledger, recorder totals, and tape decoding
// inputs. TypeScript validates inputs, prepares team tables, and decodes the
// final numeric records into the frozen wire contracts.
// ---------------------------------------------------------------------------

const BATTLE_SCRATCH_DOUBLES: usize = 65_536;
const BATTLE_SCRATCH_BYTES: usize = 1_048_576;
const MAX_PARTICIPANTS: usize = 40;
const MUTATION_COUNT: usize = 46;
const RATING_COUNT: usize = 18;
const TENDENCY_COUNT: usize = 23;
const CHANNEL_COUNT: usize = 9;
const EVENT_FIELDS: usize = 25;
const SCORING_FIELDS: usize = 44;
const ROLLUP_FIELDS: usize = 15;
const HIGHLIGHT_FIELDS: usize = 6;
const PARTICIPANT_RECORD_FIELDS: usize = 50;
const MAX_ROLLUPS: usize = 40;
const MAX_HIGHLIGHTS: usize = 16;
const HAVOC_PERSONAL_FOUL_LIMIT: i32 = 6;

static mut BATTLE_SCRATCH: [f64; BATTLE_SCRATCH_DOUBLES] = [0.0; BATTLE_SCRATCH_DOUBLES];
static mut BATTLE_STRING_SCRATCH: [u8; BATTLE_SCRATCH_BYTES] = [0; BATTLE_SCRATCH_BYTES];
static mut BATTLES: Vec<Option<Box<Battle>>> = Vec::new();

const MUT_GROWTH_SPURT: usize = 0;
const MUT_FOUR_POINT_DUNK: usize = 22;
const MUT_GOLDEN_ASSIST: usize = 23;
const MUT_HEAT_CHECK: usize = 24;
const MUT_SECOND_CHANCE_JACKPOT: usize = 25;
const MUT_AND_ONE_MACHINE: usize = 26;
const MUT_POSSESSION_REFUND: usize = 27;
const MUT_REBOUND_LOOP: usize = 28;
const MUT_THE_BOUNTY: usize = 29;
const MUT_FOUL_THIEF: usize = 30;
const MUT_BASKETBALL_ROULETTE: usize = 31;
const MUT_BUZZER_BANDIT: usize = 32;
const MUT_CHARITY_CASINO: usize = 33;
const MUT_COLD_BLOODED: usize = 34;
const MUT_TRIPLE_THREAT: usize = 35;
const MUT_CLONE_ARMY: usize = 36;
const MUT_TIME_LORD: usize = 37;
const MUT_BODY_SNATCHER: usize = 38;
const MUT_REVERSE_BASKETBALL: usize = 39;
const MUT_DOUBLE_OR_NOTHING: usize = 40;
const MUT_THE_GREAT_EQUALIZER: usize = 41;
const MUT_FUSION_DANCE: usize = 42;
const MUT_BASKETBALL_DARWINISM: usize = 43;
const MUT_OOPS_ALL_CENTERS: usize = 44;
const MUT_HOSTILE_TAKEOVER: usize = 45;

const CHANNEL_TWO_POINT: u16 = 1 << 0;
const CHANNEL_THREE_POINT: u16 = 1 << 1;
const CHANNEL_FREE_THROW: u16 = 1 << 3;
const ALL_CHANNELS: u16 = (1 << CHANNEL_COUNT) - 1;
const DARWINISM_CHANNELS: u16 = CHANNEL_TWO_POINT | CHANNEL_THREE_POINT | CHANNEL_FREE_THROW;

const HAVOC_DUNK_BASE: f64 = 0.15;
const HAVOC_DUNK_VERTICAL_WEIGHT: f64 = 0.45;
const HAVOC_DUNK_INSIDE_WEIGHT: f64 = 0.2;
const HAVOC_DUNK_HEIGHT_WEIGHT: f64 = 0.02;
const HAVOC_UNCOVERED_CONTEST_SCALE: f64 = 0.35;
const HAVOC_HELP_PRESSURE_CAP: f64 = 0.05;
const HAVOC_CONTEST_REACH_POINTS: f64 = 0.015;
const HAVOC_BLOCK_REACH_POINTS: f64 = 0.02;
const HAVOC_FINISH_HEIGHT_POINTS: f64 = 0.015;
const HAVOC_WINGSPAN_REBOUND_WEIGHT: f64 = 0.1;
const HAVOC_HEAT_EXPIRY_POSSESSIONS: i32 = 5;
const HAVOC_BOUNTY_EXPIRY_POSSESSIONS: i32 = 5;
const HAVOC_REBOUND_LOOP_EVERY: i32 = 3;
const HAVOC_GOLDEN_ASSIST_EVERY: i32 = 3;
const HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS: usize = 1;
const HAVOC_EXTRA_POSSESSION_RUSH_SECONDS: f64 = 12.0;
const HAVOC_DOUBLE_MISS_GIFT: f64 = 1.0;
const HAVOC_HEAT_STREAK_ARMS_AT: i32 = 2;
const HAVOC_ROULETTE_EVERY_ATTEMPTS: i32 = 4;
const HAVOC_BUZZER_WINDOW_TENTHS: i32 = 50;
const HAVOC_BUZZER_MISS_PENALTY: f64 = -1.0;
const HAVOC_DARWINISM_OWN_TEAM_REDUCTION: f64 = 3.0;
const HAVOC_DARWINISM_OPPONENT_REDUCTION: f64 = 5.0;
const HAVOC_COLD_BLOOD_MAX_BONUS: f64 = 5.0;
const HAVOC_COLD_BLOOD_OPPONENT_GIFT: f64 = 1.0;
const HAVOC_TRIPLE_THREAT_BONUS: f64 = 6.0;

const EV_PERIOD_START: usize = 1;
const EV_PERIOD_END: usize = 2;
const EV_POSSESSION_START: usize = 3;
const EV_SHOT_ATTEMPT: usize = 4;
const EV_FREE_THROW_ATTEMPT: usize = 5;
const EV_REBOUND: usize = 6;
const EV_ASSIST: usize = 7;
const EV_STEAL: usize = 8;
const EV_BLOCK: usize = 9;
const EV_TURNOVER: usize = 10;
const EV_TURNOVER_CANCELLED: usize = 11;
const EV_FOUL: usize = 12;
const EV_SUBSTITUTION: usize = 13;
const EV_SHOT_CLOCK_VIOLATION: usize = 14;
const EV_EXTRA_POSSESSION: usize = 15;
const EV_CLONE: usize = 16;
const EV_TIME_LORD: usize = 17;
const EV_BODY_SNATCHER: usize = 18;
const EV_GREAT_EQUALIZER: usize = 19;
const EV_FOUR_POINT_DUNK: usize = 20;
const EV_GOLDEN_ASSIST: usize = 21;
const EV_HEAT_CHECK: usize = 22;
const EV_PUTBACK: usize = 23;
const EV_AND_ONE_BONUS: usize = 24;
const EV_DOUBLE_OR_NOTHING_FOUL: usize = 25;
const EV_POSSESSION_REFUND: usize = 26;
const EV_REBOUND_LOOP: usize = 27;
const EV_BOUNTY: usize = 28;
const EV_FOUL_RELIEF: usize = 29;
const EV_ROULETTE: usize = 30;
const EV_BUZZER_BANDIT: usize = 31;
const EV_CHARITY_CASINO: usize = 32;
const EV_FUSION_DANCE: usize = 33;
const EV_DARWINISM: usize = 34;
const EV_COLD_BLOODED: usize = 35;
const EV_TRIPLE_THREAT: usize = 36;
const EV_OOPS_ALL_CENTERS: usize = 37;
const EV_HOSTILE_TAKEOVER: usize = 38;
const EV_GAME_END: usize = 39;

const ROLLUP_TRIGGERS: usize = 0;
const ROLLUP_POINTS_DELTA: usize = 1;
const ROLLUP_FREE_THROWS: usize = 2;
const ROLLUP_TURNOVERS_CANCELLED: usize = 3;
const ROLLUP_EXTRA_EARNED: usize = 4;
const ROLLUP_EXTRA_USED: usize = 5;
const ROLLUP_EXTRA_EXPIRED: usize = 6;
const ROLLUP_SWAP_POINTS: usize = 7;
const ROLLUP_RATING_CHANGES: usize = 8;

struct Participant {
    team: usize,
    kind: u8,
    slot_index: usize,
    owner: i32,
    instance: String,
    player_id: String,
    version: String,
    source_overall: f64,
    mutations: u64,
    mutation_order: [usize; 3],
    mutation_count: usize,
    authority: u16,
    source_ratings: [f64; RATING_COUNT],
    source_tendencies: [f64; TENDENCY_COUNT],
    base_ratings: [f64; RATING_COUNT],
    base_tendencies: [f64; TENDENCY_COUNT],
    height: f64,
    original_height: f64,
    weight: f64,
    wingspan: f64,
    reach: f64,
    baseline_height: f64,
    ratings: [f64; RATING_COUNT],
    tendencies: [f64; TENDENCY_COUNT],
    evidence_mask: u16,
    active: bool,
    started: bool,
    replaced: bool,
    clone_exited: bool,
    committed_fouls: i32,
    charged_fouls: i32,
    swap_with: i32,
    swapped_by: i32,
    fg_streak: i32,
    heat_armed: bool,
    heat_armed_at: i32,
    fga_count: i32,
    assist_count: i32,
    shooting_fouls_drawn: i32,
    refund_used: [bool; 40],
    rebound_loop_count: i32,
    putback_armed_at: i32,
    bounty_armed: bool,
    bounty_armed_at: i32,
    active_seconds: f64,
    darwinism_decay: f64,
    fusion_donor: i32,
    fusion_owner: i32,
    cold_blood_streak: i32,
    triple_threat_period: i32,
    triple_threat_zones: u8,
    takeover_with: i32,
    takeover_by: i32,
    rollup: [[f64; 9]; MUTATION_COUNT],
    stats: [f64; STAT_FIELDS],
    personal_fouls: f64,
}

impl Participant {
    fn has(&self, mutation: usize) -> bool {
        self.mutations & (1u64 << mutation) != 0
    }
    fn rollup(&mut self, mutation: usize) -> Option<&mut [f64; 9]> {
        if self.has(mutation) {
            Some(&mut self.rollup[mutation])
        } else {
            None
        }
    }
}

struct BattleTeam {
    participants: Vec<usize>,
    active: Vec<usize>,
    extra_queue: Vec<i32>,
    centers_owner: i32,
    stats: [f64; STAT_FIELDS],
    period_points: Vec<f64>,
}

impl BattleTeam {
    fn new(_side: usize) -> Self {
        Self {
            participants: Vec::new(),
            active: Vec::new(),
            extra_queue: Vec::new(),
            centers_owner: -1,
            stats: [0.0; STAT_FIELDS],
            period_points: vec![0.0],
        }
    }
}

#[derive(Clone, Copy)]
struct DerivedStream {
    state: u32,
    external: bool,
}
struct CoverageCache {
    possession: u32,
    assignment: Vec<i32>,
    help: Vec<usize>,
    rng_state: DerivedStream,
    valid: bool,
}

impl CoverageCache {
    fn new(participants: usize) -> Self {
        Self {
            possession: u32::MAX,
            assignment: vec![-1; participants],
            help: Vec::new(),
            rng_state: DerivedStream {
                state: 0,
                external: false,
            },
            valid: false,
        }
    }
}

struct Battle {
    seed: String,
    game_number: u32,
    c: Constants,
    strings: Vec<String>,
    participants: Vec<Participant>,
    teams: [BattleTeam; 2],
    events: Vec<[f64; EVENT_FIELDS]>,
    scoring: Vec<[f64; SCORING_FIELDS]>,
    event_seq: u32,
    score_seq: u32,
    period: u32,
    possession_id: u32,
    seconds: f64,
    clock: Option<f64>,
    period_fouls: [f64; 2],
    personal_fouls: Vec<f64>,
    possession_start: usize,
    rng_state: u32,
    internal_rng: bool,
    shot_kind_ordinal: u32,
    coverage: CoverageCache,
    rushed_extra_side: i32,
    darwinism_dirty: bool,
    last_capped: [Vec<String>; 2],
    equalizer_applied: [bool; 2],
    last_time_lord: [f64; 2],
    layouts: Vec<Option<Vec<f64>>>,
    aprons: Vec<usize>,
    apron_targets: Vec<i32>,
    open: bool,
    destroyed: bool,
}

impl Battle {
    fn new() -> Self {
        Self {
            seed: String::new(),
            game_number: 1,
            c: Constants {
                mean_trip: 0.0,
                era_poss: 0.0,
                pass_anchor: 0.0,
                min_start: 0.0,
                min_trip: 0.0,
                shot_clock: 0.0,
                inbound: 0.0,
                continuation: 0.0,
                non_shooting_foul: 0.0,
                offensive_foul_share: 0.0,
                foul_trouble_start: 0.0,
                foul_avoid_per: 0.0,
                foul_avoid_floor: 0.0,
                bonus_regulation: 0.0,
                bonus_overtime: 0.0,
                fouled_shot_scale: 0.0,
                home_defense: 0.0,
                away_turnover: 0.0,
                has_havoc: false,
                twenty_second: false,
                deep_four: false,
                has_race: false,
                has_effects: false,
                has_apron: false,
                off_rebound_rate: 0.0,
                off_rebound_scale: 0.0,
                off_rebound_range: 0.0,
                off_rebound_rim_bonus: 0.0,
                off_rebound_perimeter_penalty: 0.0,
                deep_four_split: 0.0,
                deep_four_make_scale: 0.0,
                deep_four_ft_miss: 0,
                internal_rng: false,
            },
            strings: Vec::new(),
            participants: Vec::new(),
            teams: [BattleTeam::new(0), BattleTeam::new(1)],
            events: Vec::new(),
            scoring: Vec::new(),
            event_seq: 0,
            score_seq: 0,
            period: 1,
            possession_id: 0,
            seconds: 0.0,
            clock: None,
            period_fouls: [0.0; 2],
            personal_fouls: Vec::new(),
            possession_start: 0,
            rng_state: 0,
            internal_rng: true,
            shot_kind_ordinal: 0,
            coverage: CoverageCache::new(MAX_PARTICIPANTS),
            rushed_extra_side: -1,
            darwinism_dirty: false,
            last_capped: [Vec::new(), Vec::new()],
            equalizer_applied: [false, false],
            last_time_lord: [24.0, 24.0],
            layouts: (0..4).map(|_| None).collect(),
            aprons: Vec::new(),
            apron_targets: Vec::new(),
            open: false,
            destroyed: false,
        }
    }
    fn team(&self, side: usize) -> &BattleTeam {
        &self.teams[side]
    }
    fn participant(&self, index: i32) -> Option<&Participant> {
        if index < 0 {
            return None;
        }
        self.participants.get(index as usize)
    }
    fn participant_mut(&mut self, index: i32) -> Option<&mut Participant> {
        if index < 0 {
            return None;
        }
        self.participants.get_mut(index as usize)
    }
    fn active_owner_count(&self, side: usize, mutation: usize) -> usize {
        self.teams[side]
            .active
            .iter()
            .filter(|index| {
                self.participants
                    .get(**index)
                    .is_some_and(|participant| participant.has(mutation))
            })
            .count()
    }
    fn active_owners(&self, side: usize, mutation: usize) -> Vec<usize> {
        self.teams[side]
            .active
            .iter()
            .copied()
            .filter(|index| {
                self.participants
                    .get(*index)
                    .is_some_and(|participant| participant.has(mutation))
            })
            .collect()
    }
    fn evidence_mask_of(&self, index: usize) -> u16 {
        let Some(participant) = self.participants.get(index) else {
            return 0;
        };
        if participant.swap_with >= 0 || participant.swapped_by >= 0 {
            return ALL_CHANNELS;
        }
        if participant.fusion_donor >= 0 {
            return ALL_CHANNELS;
        }
        if participant.fusion_owner >= 0 {
            let owner_active = self
                .participant(participant.fusion_owner)
                .is_some_and(|owner| owner.active);
            if owner_active {
                return ALL_CHANNELS;
            }
        }
        if participant.darwinism_decay > 0.0 {
            return participant.authority | DARWINISM_CHANNELS;
        }
        participant.authority
    }
    fn clock_seconds(&self) -> f64 {
        self.seconds.max(0.0).round()
    }
    fn push_event(&mut self, kind: usize) -> usize {
        let sequence = self.event_seq;
        let mut record = [0.0; EVENT_FIELDS];
        record[0] = kind as f64;
        record[1] = sequence as f64;
        record[2] = self.game_number as f64;
        record[3] = self.period as f64;
        record[4] = self.clock_seconds();
        record[11] = self.possession_id as f64;
        self.events.push(record);
        self.event_seq = self.event_seq.wrapping_add(1);
        sequence as usize
    }
    fn set_event(&mut self, sequence: usize, field: usize, value: f64) {
        if let Some(record) = self.events.get_mut(sequence) {
            record[field] = value;
        }
    }
    fn push_scoring(&mut self, entry: [f64; SCORING_FIELDS]) -> usize {
        let sequence = self.score_seq;
        let mut record = entry;
        record[0] = sequence as f64;
        record[1] = self.game_number as f64;
        record[2] = self.period as f64;
        record[3] = self.clock_seconds();
        record[4] = self.possession_id as f64;
        self.scoring.push(record);
        if record[6] == 0.0 || record[6] == 1.0 {
            if let Some(actor) = self.participant_mut(record[7] as i32) {
                if actor.swap_with >= 0 {
                    if let Some(counters) = actor.rollup(MUT_BODY_SNATCHER) {
                        counters[ROLLUP_SWAP_POINTS] += record[10];
                    }
                }
            }
        }
        self.score_seq = self.score_seq.wrapping_add(1);
        sequence as usize
    }
    fn attribute(&mut self, owner: i32, source: usize, points: f64) {
        let mutation = mutation_of_source(source);
        if let Some(participant) = self.participant_mut(owner) {
            if let Some(counters) = participant.rollup(mutation) {
                counters[ROLLUP_POINTS_DELTA] += points;
            }
        }
    }
    fn side_points(&self, side: usize) -> f64 {
        self.scoring
            .iter()
            .filter(|entry| entry[5] as usize == side)
            .map(|entry| entry[10])
            .fold(0.0, |total, points| total + points)
    }
    fn participant_points(&self, index: usize) -> f64 {
        self.scoring
            .iter()
            .filter(|entry| entry[7] as usize == index && entry[6] as usize != 3)
            .map(|entry| entry[10])
            .fold(0.0, |total, points| total + points)
    }
    fn team_bonus_points(&self, side: usize) -> f64 {
        self.scoring
            .iter()
            .filter(|entry| entry[5] as usize == side && entry[6] as usize == 3)
            .map(|entry| entry[10])
            .fold(0.0, |total, points| total + points)
    }
}

fn mutation_of_source(source: usize) -> usize {
    match source {
        0 => MUT_BASKETBALL_ROULETTE,
        1 => MUT_FOUR_POINT_DUNK,
        2 => MUT_REVERSE_BASKETBALL,
        3 => MUT_GOLDEN_ASSIST,
        4 => MUT_DOUBLE_OR_NOTHING,
        5 => MUT_HEAT_CHECK,
        6 => MUT_SECOND_CHANCE_JACKPOT,
        7 => MUT_THE_BOUNTY,
        8 => MUT_BUZZER_BANDIT,
        9 => MUT_CHARITY_CASINO,
        10 => MUT_COLD_BLOODED,
        11 => MUT_TRIPLE_THREAT,
        _ => MUT_GROWTH_SPURT,
    }
}

fn battle_ptr(handle: u32) -> Option<&'static mut Battle> {
    if handle == 0 {
        return None;
    }
    unsafe {
        let battles = &mut *core::ptr::addr_of_mut!(BATTLES);
        battles
            .get_mut(handle as usize - 1)
            .and_then(|entry| entry.as_deref_mut())
    }
}

fn battle_ref(handle: u32) -> Option<&'static Battle> {
    if handle == 0 {
        return None;
    }
    unsafe {
        let battles = &*core::ptr::addr_of!(BATTLES);
        battles
            .get(handle as usize - 1)
            .and_then(|entry| entry.as_deref())
    }
}

fn seed_state(seed: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in seed.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn season_digest_hex(material: &str) -> String {
    const OFFSETS: [u32; 4] = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
    let mut state = OFFSETS;
    for code in material.encode_utf16() {
        for value in state.iter_mut() {
            *value ^= code as u32;
            *value = value.wrapping_mul(0x01000193);
        }
    }
    let mut out = String::with_capacity(32);
    for value in state {
        out.push_str(&format!("{:08x}", value));
    }
    out
}

fn derived_rng_state(material: &str, external: bool) -> DerivedStream {
    let seed = season_digest_hex(material);
    DerivedStream {
        state: if external {
            unsafe { derived_create(seed.as_ptr(), seed.len() as u32) }
        } else {
            seed_state(&seed)
        },
        external,
    }
}
fn derived_next(stream: &mut DerivedStream) -> f64 {
    if stream.external {
        unsafe { derived_next_host(stream.state) }
    } else {
        internal_next(&mut stream.state)
    }
}
fn derived_pick(stream: &mut DerivedStream, total: f64, weights: &[f64]) -> usize {
    if stream.external {
        unsafe {
            derived_pick_host(stream.state, weights.as_ptr(), weights.len() as u32, total) as usize
        }
    } else {
        internal_weighted_pick(&mut stream.state, total, weights)
    }
}
fn derived_int(stream: &mut DerivedStream, min: i32, max: i32) -> i32 {
    if stream.external {
        unsafe { derived_int_host(stream.state, min, max) }
    } else {
        (derived_next(stream) * (max - min + 1) as f64).floor() as i32 + min
    }
}

fn internal_next(state: &mut u32) -> f64 {
    *state = state.wrapping_add(0x6d2b79f5);
    let mut t = (*state ^ (*state >> 15)).wrapping_mul(1 | *state);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    ((t ^ (t >> 14)) as f64) / 4294967296.0
}

fn internal_chance(state: &mut u32, probability: f64) -> bool {
    if probability <= 0.0 {
        false
    } else if probability >= 1.0 {
        true
    } else {
        internal_next(state) < probability
    }
}

fn internal_weighted_pick(state: &mut u32, total: f64, weights: &[f64]) -> usize {
    if weights.is_empty() {
        return 0;
    }
    if total <= 0.0 {
        return ((internal_next(state) * weights.len() as f64).floor() as usize)
            .min(weights.len() - 1);
    }
    let mut roll = internal_next(state) * total;
    for (index, weight) in weights.iter().enumerate() {
        if roll < *weight {
            return index;
        }
        roll -= *weight;
    }
    weights.len() - 1
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_scratch_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(BATTLE_SCRATCH).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_scratch_capacity() -> u32 {
    BATTLE_SCRATCH_DOUBLES as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_string_scratch_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(BATTLE_STRING_SCRATCH).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_string_scratch_capacity() -> u32 {
    BATTLE_SCRATCH_BYTES as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_create() -> u32 {
    let battle = Box::new(Battle::new());
    unsafe {
        let battles = &mut *core::ptr::addr_of_mut!(BATTLES);
        for (index, slot) in battles.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(battle);
                return index as u32 + 1;
            }
        }
        battles.push(Some(battle));
        battles.len() as u32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_destroy(handle: u32) {
    unsafe {
        let battles = &mut *core::ptr::addr_of_mut!(BATTLES);
        if let Some(slot) = battles.get_mut(handle as usize - 1) {
            if let Some(mut battle) = slot.take() {
                battle.destroyed = true;
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_intern(handle: u32, length: u32) -> i32 {
    let Some(battle) = battle_ptr(handle) else {
        return -1;
    };
    let length = length as usize;
    if length > BATTLE_SCRATCH_BYTES {
        return -1;
    }
    let bytes = unsafe {
        core::slice::from_raw_parts(
            core::ptr::addr_of!(BATTLE_STRING_SCRATCH).cast::<u8>(),
            length,
        )
    };
    let text = match core::str::from_utf8(bytes) {
        Ok(value) => value.to_owned(),
        Err(_) => return -1,
    };
    battle.strings_push(text)
}

impl Battle {
    fn strings_push(&mut self, value: String) -> i32 {
        self.strings.push(value);
        self.strings.len() as i32 - 1
    }
}

struct BattleReader {
    data: &'static [f64],
    cursor: usize,
}

impl BattleReader {
    fn f(&mut self) -> f64 {
        let value = self.data[self.cursor];
        self.cursor += 1;
        value
    }
    fn u(&mut self) -> usize {
        self.f() as usize
    }
    fn i(&mut self) -> i32 {
        self.f() as i32
    }
    fn ratings(&mut self) -> [f64; RATING_COUNT] {
        let mut values = [0.0; RATING_COUNT];
        for value in values.iter_mut() {
            *value = self.f();
        }
        values
    }
    fn tendencies(&mut self) -> [f64; TENDENCY_COUNT] {
        let mut values = [0.0; TENDENCY_COUNT];
        for value in values.iter_mut() {
            *value = self.f();
        }
        values
    }
}

const BATTLE_MAGIC: f64 = 7.0;
const BATTLE_VERSION: f64 = 1.0;

fn battle_scratch() -> &'static mut [f64] {
    unsafe {
        core::slice::from_raw_parts_mut(
            core::ptr::addr_of_mut!(BATTLE_SCRATCH).cast::<f64>(),
            BATTLE_SCRATCH_DOUBLES,
        )
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_init(handle: u32, length: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    let length = length as usize;
    if length > BATTLE_SCRATCH_DOUBLES {
        return 2;
    }
    let data = unsafe {
        core::slice::from_raw_parts(core::ptr::addr_of!(BATTLE_SCRATCH).cast::<f64>(), length)
    };
    let mut r = BattleReader { data, cursor: 0 };
    if r.f() != BATTLE_MAGIC || r.f() != BATTLE_VERSION {
        return 3;
    }
    battle.game_number = r.f() as u32;
    let seed_index = r.i();
    let flags = r.f() as u32;
    battle.internal_rng = flags & 1 == 0;
    battle.c = Constants {
        mean_trip: r.f(),
        era_poss: r.f(),
        pass_anchor: r.f(),
        min_start: r.f(),
        min_trip: r.f(),
        shot_clock: r.f(),
        inbound: r.f(),
        continuation: r.f(),
        non_shooting_foul: r.f(),
        offensive_foul_share: r.f(),
        foul_trouble_start: r.f(),
        foul_avoid_per: r.f(),
        foul_avoid_floor: r.f(),
        bonus_regulation: r.f(),
        bonus_overtime: r.f(),
        fouled_shot_scale: r.f(),
        home_defense: r.f(),
        away_turnover: r.f(),
        off_rebound_rate: r.f(),
        off_rebound_scale: r.f(),
        off_rebound_range: r.f(),
        off_rebound_rim_bonus: r.f(),
        off_rebound_perimeter_penalty: r.f(),
        deep_four_split: r.f(),
        deep_four_make_scale: r.f(),
        deep_four_ft_miss: r.f() as usize,
        has_havoc: true,
        twenty_second: false,
        deep_four: false,
        has_race: false,
        has_effects: false,
        has_apron: flags & 16 != 0,
        internal_rng: flags & 1 == 0,
    };
    let participant_count = r.u();
    if participant_count > MAX_PARTICIPANTS {
        return 4;
    }
    let team0_count = r.u();
    let team1_count = r.u();
    if team0_count + team1_count != participant_count {
        return 5;
    }
    let apron_count = r.u();
    let mut apron_specs: Vec<(u32, u32, i32, u32)> = Vec::new();
    for _ in 0..apron_count {
        apron_specs.push((r.f() as u32, r.f() as u32, r.i(), r.f() as u32));
    }
    if seed_index < 0 {
        return 6;
    }
    battle.seed = battle
        .strings
        .get(seed_index as usize)
        .cloned()
        .unwrap_or_default();
    let strings = battle.strings.clone();
    battle.rng_state = seed_state(&battle.seed);
    battle.personal_fouls = vec![0.0; participant_count];
    battle.coverage = CoverageCache::new(participant_count);
    battle.participants.clear();
    battle.teams = [BattleTeam::new(0), BattleTeam::new(1)];
    for index in 0..participant_count {
        let team = r.u();
        let kind = r.f() as u8;
        let slot_index = r.u();
        let owner = r.i();
        let source_overall = r.f();
        let mutations = r.f() as u64;
        let mutation_order = [r.u(), r.u(), r.u()];
        let mutation_count = mutation_order.iter().filter(|value| **value > 0).count();
        let height = r.f();
        let weight = r.f();
        let wingspan = r.f();
        let reach = r.f();
        let baseline_height = r.f();
        let authority = r.f() as u16;
        let source_ratings = r.ratings();
        let source_tendencies = r.tendencies();
        let base_ratings = r.ratings();
        let base_tendencies = r.tendencies();
        let instance_index = r.i();
        let player_index = r.i();
        let version_index = r.i();
        let lookup = |idx: i32| -> String {
            if idx < 0 {
                String::new()
            } else {
                strings.get(idx as usize).cloned().unwrap_or_default()
            }
        };
        let instance = lookup(instance_index);
        let player_id = lookup(player_index);
        let version = lookup(version_index);
        battle.participants.push(Participant {
            team,
            kind,
            slot_index,
            owner,
            instance,
            player_id,
            version,
            source_overall,
            mutations,
            mutation_order,
            mutation_count,
            authority,
            source_ratings,
            source_tendencies,
            base_ratings,
            base_tendencies,
            height,
            original_height: height,
            weight,
            wingspan,
            reach,
            baseline_height,
            ratings: base_ratings,
            tendencies: base_tendencies,
            evidence_mask: authority,
            active: false,
            started: false,
            replaced: false,
            clone_exited: false,
            committed_fouls: 0,
            charged_fouls: 0,
            swap_with: -1,
            swapped_by: -1,
            fg_streak: 0,
            heat_armed: false,
            heat_armed_at: -1,
            fga_count: 0,
            assist_count: 0,
            shooting_fouls_drawn: 0,
            refund_used: [false; 40],
            rebound_loop_count: 0,
            putback_armed_at: -1,
            bounty_armed: false,
            bounty_armed_at: -1,
            active_seconds: 0.0,
            darwinism_decay: 0.0,
            fusion_donor: -1,
            fusion_owner: -1,
            cold_blood_streak: 0,
            triple_threat_period: 0,
            triple_threat_zones: 0,
            takeover_with: -1,
            takeover_by: -1,
            rollup: [[0.0; 9]; MUTATION_COUNT],
            stats: [0.0; STAT_FIELDS],
            personal_fouls: 0.0,
        });

        battle.teams[team].participants.push(index);
        if kind == 0 {
            let participant = &mut battle.participants[index];
            participant.active = true;
            participant.started = true;
        }
    }
    for (side, payroll, target, handle) in apron_specs {
        let apron = if handle > 0 {
            handle
        } else {
            apron_create(side, payroll)
        };
        if apron == 0 {
            return 7;
        }
        battle.aprons.push(apron as usize);
        battle.apron_targets.push(target);
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_participant_count(handle: u32) -> u32 {
    battle_ref(handle).map_or(0, |battle| battle.participants.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_active_count(handle: u32, side: u32) -> u32 {
    battle_ref(handle).map_or(0, |battle| battle.team(side as usize).active.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_active_index(handle: u32, side: u32, slot: u32) -> i32 {
    battle_ref(handle).map_or(-1, |battle| {
        battle
            .team(side as usize)
            .active
            .get(slot as usize)
            .map_or(-1, |index| *index as i32)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_struck_index(handle: u32, side: u32) -> i32 {
    let Some(battle) = battle_ref(handle) else {
        return -1;
    };
    for (position, apron_handle) in battle.aprons.iter().enumerate() {
        let target = battle.apron_targets.get(position).copied().unwrap_or(-1);
        if target < 0 {
            continue;
        }
        let Some(participant) = battle.participants.get(target as usize) else {
            continue;
        };
        if participant.team == side as usize && participant.active {
            let Some(apron) = apron_ref(*apron_handle as u32) else {
                continue;
            };
            if apron.side == side {
                return target;
            }
        }
    }
    -1
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_fill_team_spec(handle: u32, side: u32) -> u32 {
    let Some(battle) = battle_ref(handle) else {
        return 0;
    };
    let scratch = battle_scratch();
    let mut cursor = 0usize;
    let active = &battle.teams[side as usize].active;
    scratch[cursor] = active.len() as f64;
    cursor += 1;
    for index in active {
        let Some(participant) = battle.participants.get(*index) else {
            continue;
        };
        scratch[cursor] = *index as f64;
        cursor += 1;
        scratch[cursor] = participant.height;
        cursor += 1;
        scratch[cursor] = participant.weight;
        cursor += 1;
        scratch[cursor] = participant.wingspan;
        cursor += 1;
        scratch[cursor] = participant.reach;
        cursor += 1;
        scratch[cursor] = participant.baseline_height;
        cursor += 1;
        for value in participant.ratings {
            scratch[cursor] = value;
            cursor += 1;
        }
        for value in participant.tendencies {
            scratch[cursor] = value;
            cursor += 1;
        }
        scratch[cursor] = battle.evidence_mask_of(*index) as f64;
        cursor += 1;
        scratch[cursor] = participant.slot_index as f64;
        cursor += 1;
        scratch[cursor] =
            (1.0 + (HAVOC_WINGSPAN_REBOUND_WEIGHT * participant.wingspan.max(0.0)) / 24.0) as f64;
        cursor += 1;
        scratch[cursor] = 4.0 * participant.reach;
        cursor += 1;
        scratch[cursor] = participant.source_overall;
        cursor += 1;
    }
    cursor as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_install_layout(handle: u32, side: u32, struck: u32, length: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    let length = length as usize;
    if length > BATTLE_SCRATCH_DOUBLES {
        return 2;
    }
    let data = unsafe {
        core::slice::from_raw_parts(core::ptr::addr_of!(BATTLE_SCRATCH).cast::<f64>(), length)
    };
    let slot = (side as usize) * 2 + struck as usize;
    battle.layouts[slot] = Some(data.to_vec());
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_seed(handle: u32) -> f64 {
    battle_ref(handle).map_or(0.0, |battle| battle.rng_state as f64)
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_seconds(handle: u32) -> f64 {
    battle_ref(handle).map_or(0.0, |battle| battle.seconds)
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_side_points_scalar(handle: u32, side: u32) -> f64 {
    battle_ref(handle).map_or(0.0, |battle| battle.side_points(side as usize))
}

fn battle_active_participant(battle: &Battle, side: usize, slot: usize) -> i32 {
    battle
        .teams
        .get(side)
        .and_then(|team| team.active.get(slot))
        .map_or(-1, |index| *index as i32)
}

fn battle_full_clock(handle: u32, side: usize) -> f64 {
    let Some(battle) = battle_ref(handle) else {
        return 0.0;
    };
    let mut limit: f64 = if battle.active_owner_count(side, MUT_TIME_LORD) > 0 {
        30.0
    } else if battle.active_owner_count(1 - side, MUT_TIME_LORD) > 0 {
        12.0
    } else {
        24.0
    };
    if battle.rushed_extra_side == side as i32 {
        limit = limit.min(HAVOC_EXTRA_POSSESSION_RUSH_SECONDS);
    }
    limit
}

fn battle_rebound_clock(handle: u32, side: usize) -> f64 {
    battle_full_clock(handle, side).min(14.0)
}

fn battle_sync(handle: u32, remaining: f64, clock: Option<f64>) {
    if let Some(battle) = battle_ptr(handle) {
        battle.seconds = remaining;
        battle.clock = clock;
    }
}

fn battle_shot_clock_violation(handle: u32, side: usize, limit: f64, remaining: f64) {
    if let Some(battle) = battle_ptr(handle) {
        battle.seconds = remaining;
        let sequence = battle.push_event(EV_SHOT_CLOCK_VIOLATION);
        let possession = battle.possession_id;
        battle.set_event(sequence, 5, possession as f64);
        battle.set_event(sequence, 6, side as f64);
        battle.set_event(sequence, 7, limit.max(1.0).round());
    }
}

fn battle_cancel_turnover(handle: u32, offense: usize, handler: usize) -> bool {
    let Some(battle) = battle_ptr(handle) else {
        return false;
    };
    let index = battle_active_participant(battle, offense, handler);
    let Some(participant) = battle.participant(index) else {
        return false;
    };
    if !participant.has(MUT_POSSESSION_REFUND) {
        return false;
    }
    let period = battle.period as usize;
    if period >= 40 {
        return false;
    }
    let Some(participant) = battle.participant_mut(index) else {
        return false;
    };
    if participant.refund_used[period] {
        return false;
    }
    participant.refund_used[period] = true;
    if let Some(counters) = participant.rollup(MUT_POSSESSION_REFUND) {
        counters[ROLLUP_TRIGGERS] += 1.0;
        counters[ROLLUP_TURNOVERS_CANCELLED] += 1.0;
    }
    true
}

fn battle_turnover(handle: u32, offense: usize, handler: usize, cancelled: bool) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let index = battle_active_participant(battle, offense, handler);
    if index < 0 {
        return;
    }
    let sequence = battle.push_event(EV_TURNOVER);
    battle.set_event(sequence, 5, index as f64);
    battle.set_event(sequence, 6, offense as f64);
    if cancelled {
        let cancelled_sequence = battle.push_event(EV_TURNOVER_CANCELLED);
        battle.set_event(cancelled_sequence, 5, index as f64);
        battle.set_event(cancelled_sequence, 6, offense as f64);
        battle.set_event(cancelled_sequence, 7, sequence as f64);
        let refund = battle.push_event(EV_POSSESSION_REFUND);
        battle.set_event(refund, 5, index as f64);
        battle.set_event(refund, 6, offense as f64);
        battle.set_event(refund, 7, sequence as f64);
    }
    if let Some(participant) = battle.participant_mut(index) {
        participant.putback_armed_at = -1;
    }
}

fn battle_steal(handle: u32, defense: usize, stealer: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let index = battle_active_participant(battle, defense, stealer);
    let sequence = battle.push_event(EV_STEAL);
    battle.set_event(sequence, 5, index as f64);
    battle.set_event(sequence, 6, defense as f64);
}

fn zone_defense_skill(battle: &Battle, index: usize, zone: usize) -> f64 {
    let Some(participant) = battle.participants.get(index) else {
        return 0.0;
    };
    let ratings = &participant.ratings;
    match zone {
        0 | 1 => ratings[11],
        2 => (ratings[11] + ratings[10]) / 2.0,
        _ => ratings[10],
    }
}

fn zone_defense_weight(battle: &Battle, index: usize, zone: usize) -> f64 {
    ((zone_defense_skill(battle, index, zone) - 45.0) / 35.0).max(0.25)
}

fn slot_group(slot: usize) -> usize {
    match slot {
        0 | 1 => 0,
        2 | 3 => 1,
        _ => 2,
    }
}

fn same_group_match_weight(defender_slot: usize, shooter_slot: usize) -> f64 {
    if slot_group(defender_slot) == slot_group(shooter_slot) {
        1.35
    } else {
        1.0
    }
}

fn battle_ensure_coverage(handle: u32, offense: usize, defense: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    if battle.teams[offense].active.len() == 5 && battle.teams[defense].active.len() == 5 {
        battle.coverage.valid = false;
        return;
    }
    if battle.coverage.valid && battle.coverage.possession == battle.possession_id {
        return;
    }
    let offense_active = &battle.teams[offense].active;
    let defense_active = &battle.teams[defense].active;
    let material = format!(
        "havoc-runtime-v1\u{0}{}\u{0}coverage\u{0}{}\u{0}{}",
        battle.seed, battle.possession_id, offense
    );
    let mut rng = derived_rng_state(&material, !battle.internal_rng);
    let mut covered: Vec<bool> = vec![false; battle.participants.len()];
    let mut assignment: Vec<i32> = vec![-1; battle.participants.len()];
    for defender in defense_active {
        let candidates: Vec<usize> = offense_active
            .iter()
            .copied()
            .filter(|shooter| !covered[*shooter])
            .collect();
        if candidates.is_empty() {
            break;
        }
        let weights: Vec<f64> = candidates
            .iter()
            .map(|shooter| {
                let defender_slot = battle
                    .participants
                    .get(*defender)
                    .map_or(0, |participant| participant.slot_index);
                let shooter_slot = battle
                    .participants
                    .get(*shooter)
                    .map_or(0, |participant| participant.slot_index);
                same_group_match_weight(defender_slot, shooter_slot).max(0.0001)
            })
            .collect();
        let total: f64 = weights.iter().sum();
        let chosen = derived_pick(&mut rng, total, &weights);
        let shooter = candidates[chosen];
        assignment[shooter] = *defender as i32;
        covered[shooter] = true;
    }
    let help: Vec<usize> = defense_active
        .iter()
        .copied()
        .filter(|defender| !assignment.contains(&(*defender as i32)))
        .collect();
    battle.coverage.possession = battle.possession_id;
    battle.coverage.assignment = assignment;
    battle.coverage.help = help;
    battle.coverage.rng_state = rng;
    battle.coverage.valid = true;
}

fn battle_pick_helper(handle: u32, defense: usize, zone: usize) -> i32 {
    let Some(battle) = battle_ptr(handle) else {
        return -1;
    };
    let team_active = &battle.teams[defense].active;
    let mut candidates = [0usize; MAX_UNITS];
    let mut count = 0;
    for &defender in team_active {
        if !battle.coverage.assignment.contains(&(defender as i32)) {
            candidates[count] = defender;
            count += 1;
        }
    }
    if count == 0 {
        count = team_active.len();
        candidates[..count].copy_from_slice(team_active);
    }
    if count == 0 {
        return -1;
    }
    let candidates = &candidates[..count];
    let mut storage = [0.0; MAX_UNITS];
    for (slot, &defender) in candidates.iter().enumerate() {
        storage[slot] = zone_defense_weight(battle, defender, zone);
    }
    let weights = &storage[..count];
    let total: f64 = weights.iter().sum();
    let mut rng = battle.coverage.rng_state;
    let chosen = derived_pick(&mut rng, total, &weights);
    battle.coverage.rng_state = rng;
    candidates[chosen] as i32
}

fn battle_help_pressure(handle: u32, zone: usize) -> f64 {
    let Some(battle) = battle_ref(handle) else {
        return 0.0;
    };
    let mut total = 0.0;
    for defender in &battle.coverage.help {
        let skill = zone_defense_skill(battle, *defender, zone);
        total += 0.01 * (skill.max(0.0) / 100.0).floor();
    }
    total.min(HAVOC_HELP_PRESSURE_CAP)
}

fn battle_plan_shot(
    handle: u32,
    offense: usize,
    defense: usize,
    shooter_slot: usize,
    zone: usize,
    _action: usize,
    passed: bool,
) -> Plan {
    let Some(battle) = battle_ptr(handle) else {
        return Plan::none();
    };
    let shooter_index = battle_active_participant(battle, offense, shooter_slot);
    let Some(shooter) = battle.participant(shooter_index) else {
        return Plan::none();
    };
    let putback = shooter.putback_armed_at >= 0 && !passed;
    let shooter_height = shooter.original_height;
    let shooter_baseline = shooter.baseline_height;
    let shooter_instance = shooter.instance.clone();
    let shooter_ratings = shooter.ratings;
    battle_ensure_coverage(handle, offense, defense);
    let defense_count = battle.teams[defense].active.len();
    let mut defender: i32 = -1;
    let mut contest_scale = 1.0;
    let mut help_pressure = 0.0;
    if battle.coverage.valid {
        let assigned = battle.coverage.assignment[shooter_index as usize];
        if assigned >= 0 {
            defender = assigned;
        } else {
            let helper = battle_pick_helper(handle, defense, zone);
            if helper >= 0 {
                defender = helper;
                contest_scale = HAVOC_UNCOVERED_CONTEST_SCALE;
            }
        }
        help_pressure = battle_help_pressure(handle, zone);
    }
    let interior = zone == 0 || zone == 1;
    let defender_reach = battle
        .participant(defender)
        .map_or(0.0, |participant| participant.reach);
    let contest_point_delta = if interior {
        -HAVOC_CONTEST_REACH_POINTS * defender_reach
    } else {
        0.0
    };
    let block_point_delta = if interior {
        HAVOC_BLOCK_REACH_POINTS * defender_reach
    } else {
        0.0
    };
    let height_feet = ((shooter_height - shooter_baseline) / 12.0).clamp(-2.0, 2.0);
    let finish_delta = if zone == 0 {
        HAVOC_FINISH_HEIGHT_POINTS * height_feet
    } else {
        0.0
    };
    let shot_kind = if zone != 0 {
        0
    } else if putback {
        1
    } else {
        battle.shot_kind_ordinal += 1;
        let material = format!(
            "havoc-runtime-v1\u{0}{}\u{0}shot-kind\u{0}{}\u{0}{}\u{0}{}",
            battle.seed, battle.possession_id, battle.shot_kind_ordinal, shooter_instance
        );
        let mut rng = derived_rng_state(&material, !battle.internal_rng);
        let probability = (HAVOC_DUNK_BASE
            + HAVOC_DUNK_VERTICAL_WEIGHT * (shooter_ratings[17] / 100.0)
            + HAVOC_DUNK_INSIDE_WEIGHT * (shooter_ratings[0] / 100.0)
            + HAVOC_DUNK_HEIGHT_WEIGHT * (shooter_height - 78.0))
            .clamp(0.05, 0.95);
        if derived_next(&mut rng) < probability {
            2
        } else {
            1
        }
    };
    let defender_slot = if defender >= 0 {
        battle.teams[defense]
            .active
            .iter()
            .position(|index| *index as i32 == defender)
            .map_or(-1, |slot| slot as i32)
    } else {
        -1
    };
    let mut plan = Plan::none();
    plan.has = true;
    plan.defender = defender_slot;
    plan.contest_scale = contest_scale;
    plan.contest_delta = contest_point_delta;
    plan.make_delta = finish_delta - help_pressure;
    plan.block_delta = block_point_delta;
    plan.shot_kind = shot_kind;
    plan.putback = putback;
    if plan.defender < 0 {
        for slot in 0..defense_count.min(10) {
            let index = battle.teams[defense].active[slot];
            let reach = battle
                .participants
                .get(index)
                .map_or(0.0, |participant| participant.reach);
            plan.reach_contest[slot] = if interior {
                -HAVOC_CONTEST_REACH_POINTS * reach
            } else {
                0.0
            };
            plan.reach_block[slot] = if interior {
                HAVOC_BLOCK_REACH_POINTS * reach
            } else {
                0.0
            };
        }
    }
    plan
}

fn battle_rollup_trigger(battle: &mut Battle, index: i32, mutation: usize) {
    if let Some(participant) = battle.participant_mut(index) {
        if let Some(counters) = participant.rollup(mutation) {
            counters[ROLLUP_TRIGGERS] += 1.0;
        }
    }
}

fn battle_foul(
    handle: u32,
    fouler_slot: usize,
    fouler_side: usize,
    offense_side: usize,
    shooter_slot: i32,
    shooting: bool,
    made_shot: bool,
    in_bonus: bool,
    zone: i32,
) -> FoulAwards {
    let Some(battle) = battle_ptr(handle) else {
        return FoulAwards::none();
    };
    let fouler_index = battle_active_participant(battle, fouler_side, fouler_slot);
    if fouler_index < 0 {
        return FoulAwards::none();
    }
    let double_owners = battle.active_owners(fouler_side, MUT_DOUBLE_OR_NOTHING);
    let double_free_throws = if double_owners.is_empty() {
        0
    } else {
        HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS
    };
    let mut free_throws_awarded = 0usize;
    let mut bonus_attempts = 0usize;
    let mut and_one_shooter: i32 = -1;
    if shooting {
        if made_shot {
            free_throws_awarded = 1;
        } else {
            free_throws_awarded = if zone < 0 {
                2
            } else if zone >= 3 {
                3
            } else {
                2
            };
        }
    } else if in_bonus {
        free_throws_awarded = 2;
    }
    if shooting && shooter_slot >= 0 && made_shot {
        let shooter_index = battle_active_participant(battle, offense_side, shooter_slot as usize);
        if let Some(shooter) = battle.participant(shooter_index) {
            if shooter.has(MUT_AND_ONE_MACHINE) {
                and_one_shooter = shooter_index;
                free_throws_awarded += 1;
                bonus_attempts = 1;
            }
        }
    }
    let technical_free_throws = if battle
        .participant(fouler_index)
        .is_some_and(|value| value.kind == 1 && value.committed_fouls >= HAVOC_PERSONAL_FOUL_LIMIT)
    {
        1
    } else {
        0
    };
    if let Some(fouler) = battle.participant_mut(fouler_index) {
        fouler.committed_fouls += 1;
        fouler.charged_fouls += 1;
    }
    let shooter_instance = if shooter_slot >= 0 {
        battle_active_participant(battle, offense_side, shooter_slot as usize)
    } else {
        -1
    };
    let foul_sequence = battle.push_event(EV_FOUL);
    battle.set_event(foul_sequence, 5, fouler_index as f64);
    battle.set_event(foul_sequence, 6, fouler_side as f64);
    battle.set_event(foul_sequence, 7, shooting as u32 as f64);
    battle.set_event(foul_sequence, 8, shooter_instance as f64);
    battle.set_event(foul_sequence, 9, free_throws_awarded as f64);
    battle.set_event(foul_sequence, 10, technical_free_throws as f64);
    if and_one_shooter >= 0 {
        if let Some(participant) = battle.participant_mut(and_one_shooter) {
            if let Some(counters) = participant.rollup(MUT_AND_ONE_MACHINE) {
                counters[ROLLUP_TRIGGERS] += 1.0;
                counters[ROLLUP_FREE_THROWS] += 1.0;
            }
        }
        let sequence = battle.push_event(EV_AND_ONE_BONUS);
        battle.set_event(sequence, 5, and_one_shooter as f64);
        battle.set_event(sequence, 6, offense_side as f64);
        battle.set_event(sequence, 7, foul_sequence as f64);
        battle.set_event(sequence, 8, 1.0);
    }
    if double_free_throws > 0 {
        if let Some(owner) = double_owners.first().copied() {
            if let Some(participant) = battle.participant_mut(owner as i32) {
                if let Some(counters) = participant.rollup(MUT_DOUBLE_OR_NOTHING) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                    counters[ROLLUP_FREE_THROWS] += double_free_throws as f64;
                }
            }
            let sequence = battle.push_event(EV_DOUBLE_OR_NOTHING_FOUL);
            battle.set_event(sequence, 5, owner as f64);
            battle.set_event(sequence, 6, fouler_side as f64);
            battle.set_event(sequence, 7, foul_sequence as f64);
            battle.set_event(sequence, 8, double_free_throws as f64);
        }
    }
    if shooting && shooter_slot >= 0 {
        let shooter_index = battle_active_participant(battle, offense_side, shooter_slot as usize);
        let thief = battle
            .participant(shooter_index)
            .is_some_and(|value| value.has(MUT_FOUL_THIEF));
        if thief {
            let mut relief_after: i32 = -1;
            if let Some(shooter) = battle.participant_mut(shooter_index) {
                let drawn = shooter.shooting_fouls_drawn + 1;
                shooter.shooting_fouls_drawn = drawn;
                if drawn % 2 == 0 && shooter.charged_fouls > 0 {
                    shooter.charged_fouls -= 1;
                    relief_after = shooter.charged_fouls;
                    if let Some(counters) = shooter.rollup(MUT_FOUL_THIEF) {
                        counters[ROLLUP_TRIGGERS] += 1.0;
                    }
                }
            }
            if relief_after >= 0 {
                let sequence = battle.push_event(EV_FOUL_RELIEF);
                battle.set_event(sequence, 5, shooter_index as f64);
                battle.set_event(sequence, 6, offense_side as f64);
                battle.set_event(sequence, 7, foul_sequence as f64);
                battle.set_event(sequence, 8, relief_after as f64);
            }
        }
    }
    FoulAwards {
        free_throws: free_throws_awarded,
        bonus_attempts,
        technical: technical_free_throws,
        technical_for_defense: fouler_side == offense_side && !shooting,
        double_or_nothing: double_free_throws,
    }
}

struct FieldGoalValue {
    addends: [(usize, f64); 8],
    addend_count: usize,
    multipliers: [(usize, f64); 4],
    multiplier_count: usize,
    contributions: [(usize, f64); 8],
    contribution_count: usize,
    points: f64,
}

fn battle_field_goal_value(
    nominal: f64,
    roulette: Option<f64>,
    four_point_dunk: bool,
    reverse: bool,
    heat_check: bool,
    putback: bool,
    bounty: bool,
    double_or_nothing: bool,
    buzzer: bool,
    cold_blood_bonus: f64,
    triple_threat_bonus: f64,
    three: bool,
) -> FieldGoalValue {
    let mut value = nominal;
    let mut result = FieldGoalValue {
        addends: [(0, 0.0); 8],
        addend_count: 0,
        multipliers: [(0, 0.0); 4],
        multiplier_count: 0,
        contributions: [(0, 0.0); 8],
        contribution_count: 0,
        points: 0.0,
    };
    macro_rules! add {
        ($source:expr, $points:expr) => {{
            result.addends[result.addend_count] = ($source, $points);
            result.addend_count += 1;
            result.contributions[result.contribution_count] = ($source, $points);
            result.contribution_count += 1;
            value += $points;
        }};
    }
    if let Some(rolled) = roulette {
        add!(0, rolled - nominal);
    }
    if reverse {
        add!(2, if three { -2.0 } else { 1.0 });
    }
    if cold_blood_bonus > 0.0 {
        add!(10, cold_blood_bonus);
    }
    if triple_threat_bonus > 0.0 {
        add!(11, triple_threat_bonus);
    }
    macro_rules! multiply {
        ($source:expr, $factor:expr) => {{
            result.multipliers[result.multiplier_count] = ($source, $factor);
            result.multiplier_count += 1;
            result.contributions[result.contribution_count] = ($source, value * ($factor - 1.0));
            result.contribution_count += 1;
            value *= $factor;
        }};
    }
    if heat_check {
        multiply!(5, 2.0);
    } else if putback {
        multiply!(6, 2.0);
    } else if bounty {
        multiply!(7, 3.0);
    } else if double_or_nothing {
        multiply!(4, 2.0);
    } else if buzzer {
        multiply!(8, 2.0);
    }
    if four_point_dunk {
        add!(1, 1.0);
    }
    result.points = value;
    result
}

fn battle_field_goal(
    handle: u32,
    offense: usize,
    shooter_slot: usize,
    made: bool,
    three: bool,
    passed: bool,
    shot_kind: usize,
    putback_arg: bool,
    zone: usize,
) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let shooter_index = battle_active_participant(battle, offense, shooter_slot);
    let Some(shooter_state) = battle.participant(shooter_index) else {
        return;
    };
    let instance = shooter_state.instance.clone();
    let has_heat = shooter_state.has(MUT_HEAT_CHECK);
    let has_bounty = shooter_state.has(MUT_THE_BOUNTY);
    let has_four = shooter_state.has(MUT_FOUR_POINT_DUNK);
    let has_cold = shooter_state.has(MUT_COLD_BLOODED);
    let has_roulette = shooter_state.has(MUT_BASKETBALL_ROULETTE);
    let has_triple = shooter_state.has(MUT_TRIPLE_THREAT);
    let heat_before = has_heat && shooter_state.heat_armed;
    let bounty_before = has_bounty && shooter_state.bounty_armed;
    let cold_blood_streak = shooter_state.cold_blood_streak;
    let triple_period = shooter_state.triple_threat_period;
    let triple_zones = shooter_state.triple_threat_zones;
    let shooter_active = shooter_state.active;
    let nominal = if three { 3.0 } else { 2.0 };
    let shot_sequence = battle.push_event(EV_SHOT_ATTEMPT);
    battle.set_event(shot_sequence, 5, shooter_index as f64);
    battle.set_event(shot_sequence, 6, offense as f64);
    battle.set_event(shot_sequence, 7, zone as f64);
    battle.set_event(shot_sequence, 8, shot_kind as f64);
    battle.set_event(shot_sequence, 9, made as u32 as f64);
    battle.set_event(shot_sequence, 10, nominal);
    let putback_valid = putback_arg && !passed;
    let putback_arm = battle
        .participant(shooter_index)
        .map_or(-1, |value| value.putback_armed_at);
    if putback_arm >= 0 {
        if let Some(participant) = battle.participant_mut(shooter_index) {
            participant.putback_armed_at = -1;
            if let Some(counters) = participant.rollup(MUT_SECOND_CHANCE_JACKPOT) {
                counters[ROLLUP_TRIGGERS] += 1.0;
            }
        }
    }
    let four_point_dunk = made && shot_kind == 2 && has_four;
    let reverse_owners = battle.active_owners(offense, MUT_REVERSE_BASKETBALL);
    let double_owners = battle.active_owners(offense, MUT_DOUBLE_OR_NOTHING);
    let cold_blood_bonus = if made && has_cold {
        HAVOC_COLD_BLOOD_MAX_BONUS.min(cold_blood_streak as f64)
    } else {
        0.0
    };
    let shot_class: i32 = if three {
        2
    } else if zone == 0 {
        0
    } else if zone == 1 || zone == 2 {
        1
    } else {
        -1
    };
    let triple_threat_completes = made
        && shot_class >= 0
        && has_triple
        && triple_period == battle.period as i32
        && (triple_zones & (1 << shot_class)) == 0
        && triple_zones.count_ones() == 2;
    let triple_threat_bonus = if triple_threat_completes {
        HAVOC_TRIPLE_THREAT_BONUS
    } else {
        0.0
    };
    let shot_clock_tenths = battle
        .clock
        .map_or(-1, |clock| (clock * 10.0).round() as i32);
    let buzzer_qualifies = shooter_active
        && battle
            .participant(shooter_index)
            .is_some_and(|value| value.has(MUT_BUZZER_BANDIT))
        && shot_clock_tenths >= 0
        && shot_clock_tenths <= HAVOC_BUZZER_WINDOW_TENTHS;
    let mut roulette: Option<(i32, i32)> = None;
    if has_roulette {
        let fga = battle
            .participant(shooter_index)
            .map_or(0, |value| value.fga_count + 1);
        if let Some(participant) = battle.participant_mut(shooter_index) {
            participant.fga_count = fga;
        }
        if fga % HAVOC_ROULETTE_EVERY_ATTEMPTS == 0 {
            let material = format!(
                "havoc-runtime-v1\u{0}{}\u{0}roulette\u{0}{}\u{0}{}",
                battle.seed, instance, fga
            );
            let mut rng = derived_rng_state(&material, !battle.internal_rng);
            let rolled = derived_int(&mut rng, 1, 4);
            roulette = Some((fga, rolled));
        }
    }
    let mut scoring_sequence: i32 = -1;
    if made {
        let value = battle_field_goal_value(
            nominal,
            roulette.map(|entry| entry.1 as f64),
            four_point_dunk,
            !reverse_owners.is_empty(),
            heat_before,
            putback_valid,
            bounty_before,
            !double_owners.is_empty(),
            buzzer_qualifies,
            cold_blood_bonus,
            triple_threat_bonus,
            three,
        );
        let mut owner_ids: Vec<usize> = Vec::new();
        let mut attributions: Vec<(i32, usize, f64)> = Vec::new();
        for index in 0..value.contribution_count.min(8) {
            let (source, points) = value.contributions[index];
            let owners: Vec<usize> = if source == 2 {
                reverse_owners.clone()
            } else if matches!(source, 0 | 1 | 5 | 6 | 7 | 8 | 10 | 11) {
                vec![shooter_index as usize]
            } else {
                double_owners.clone()
            };
            let Some(primary) = owners.first().copied() else {
                continue;
            };
            if source == 2 || source == 4 {
                for owner in &owners {
                    if !owner_ids.contains(owner) {
                        owner_ids.push(*owner);
                    }
                }
            } else if !owner_ids.contains(&primary) {
                owner_ids.push(primary);
            }
            attributions.push((primary as i32, source, points));
        }
        let mut entry = [0.0; SCORING_FIELDS];
        entry[5] = offense as f64;
        entry[6] = 0.0;
        entry[7] = shooter_index as f64;
        entry[8] = -1.0;
        entry[9] = nominal;
        entry[10] = value.points;
        entry[11] = shot_sequence as f64;
        entry[12] = value.addend_count as f64;
        entry[13] = value.multiplier_count as f64;
        for index in 0..value.addend_count.min(8) {
            let (source, points) = value.addends[index];
            entry[20 + index * 2] = source as f64;
            entry[21 + index * 2] = points;
        }
        for index in 0..value.multiplier_count.min(4) {
            let (source, factor) = value.multipliers[index];
            entry[36 + index * 2] = source as f64;
            entry[37 + index * 2] = factor;
        }
        entry[14] = owner_ids.len() as f64;
        for (index, owner) in owner_ids.iter().take(5).enumerate() {
            entry[15 + index] = *owner as f64;
        }
        scoring_sequence = battle.push_scoring(entry) as i32;
        for (owner, source, points) in attributions {
            battle.attribute(owner, source, points);
        }
        if buzzer_qualifies {
            battle_rollup_trigger(battle, shooter_index, MUT_BUZZER_BANDIT);
            let sequence = battle.push_event(EV_BUZZER_BANDIT);
            battle.set_event(sequence, 5, 0.0);
            battle.set_event(sequence, 6, shooter_index as f64);
            battle.set_event(sequence, 7, shooter_index as f64);
            battle.set_event(sequence, 8, offense as f64);
            battle.set_event(sequence, 9, shot_clock_tenths as f64);
            battle.set_event(sequence, 10, scoring_sequence as f64);
        }
    } else {
        if let Some(penalty_owner) = double_owners.first().copied() {
            let opponent = 1 - offense;
            let mut entry = [0.0; SCORING_FIELDS];
            entry[5] = opponent as f64;
            entry[6] = 3.0;
            entry[7] = shooter_index as f64;
            entry[8] = -1.0;
            entry[10] = HAVOC_DOUBLE_MISS_GIFT;
            entry[11] = shot_sequence as f64;
            entry[12] = 1.0;
            entry[20] = 4.0;
            entry[21] = HAVOC_DOUBLE_MISS_GIFT;
            entry[14] = double_owners.len() as f64;
            for (index, owner) in double_owners.iter().take(5).enumerate() {
                entry[15 + index] = *owner as f64;
            }
            battle.push_scoring(entry);
            battle.attribute(penalty_owner as i32, 4, -HAVOC_DOUBLE_MISS_GIFT);
        }
        if buzzer_qualifies {
            let mut entry = [0.0; SCORING_FIELDS];
            entry[5] = offense as f64;
            entry[6] = 2.0;
            entry[7] = shooter_index as f64;
            entry[8] = -1.0;
            entry[10] = HAVOC_BUZZER_MISS_PENALTY;
            entry[11] = shot_sequence as f64;
            entry[12] = 1.0;
            entry[20] = 8.0;
            entry[21] = HAVOC_BUZZER_MISS_PENALTY;
            entry[14] = 1.0;
            entry[15] = shooter_index as f64;
            let penalty_sequence = battle.push_scoring(entry);
            if let Some(participant) = battle.participant_mut(shooter_index) {
                if let Some(counters) = participant.rollup(MUT_BUZZER_BANDIT) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                    counters[ROLLUP_POINTS_DELTA] += HAVOC_BUZZER_MISS_PENALTY;
                }
            }
            let sequence = battle.push_event(EV_BUZZER_BANDIT);
            battle.set_event(sequence, 5, 1.0);
            battle.set_event(sequence, 6, shooter_index as f64);
            battle.set_event(sequence, 7, shooter_index as f64);
            battle.set_event(sequence, 8, offense as f64);
            battle.set_event(sequence, 9, shot_clock_tenths as f64);
            battle.set_event(sequence, 10, penalty_sequence as f64);
        }
    }
    battle_field_goal_after(
        battle,
        offense,
        shooter_index,
        made,
        shot_sequence,
        scoring_sequence,
        putback_arm,
        putback_valid,
        cold_blood_bonus,
        shot_class,
        triple_threat_completes,
        triple_zones,
        four_point_dunk,
        heat_before,
        has_heat,
        bounty_before,
        roulette,
        nominal,
    );
}

#[allow(clippy::too_many_arguments)]
fn battle_field_goal_after(
    battle: &mut Battle,
    offense: usize,
    shooter_index: i32,
    made: bool,
    shot_sequence: usize,
    scoring_sequence: i32,
    putback_arm: i32,
    putback_valid: bool,
    cold_blood_bonus: f64,
    shot_class: i32,
    triple_threat_completes: bool,
    triple_zones: u8,
    four_point_dunk: bool,
    heat_before: bool,
    has_heat: bool,
    bounty_before: bool,
    roulette: Option<(i32, i32)>,
    nominal: f64,
) {
    if made {
        let mut darwinism_owners = battle.active_owners(0, MUT_BASKETBALL_DARWINISM);
        darwinism_owners.extend(battle.active_owners(1, MUT_BASKETBALL_DARWINISM));
        if let Some(primary) = darwinism_owners.first().copied() {
            let same_team = darwinism_owners
                .iter()
                .any(|owner| battle.participants[*owner].team == offense);
            let reduction = if same_team {
                HAVOC_DARWINISM_OWN_TEAM_REDUCTION
            } else {
                HAVOC_DARWINISM_OPPONENT_REDUCTION
            };
            if let Some(shooter) = battle.participant_mut(shooter_index) {
                shooter.darwinism_decay += reduction;
            }
            for owner in &darwinism_owners {
                if let Some(participant) = battle.participant_mut(*owner as i32) {
                    if let Some(counters) = participant.rollup(MUT_BASKETBALL_DARWINISM) {
                        counters[ROLLUP_TRIGGERS] += 1.0;
                        counters[ROLLUP_RATING_CHANGES] += reduction;
                    }
                }
            }
            let decay = battle
                .participant(shooter_index)
                .map_or(0.0, |participant| participant.darwinism_decay);
            let sequence = battle.push_event(EV_DARWINISM);
            battle.set_event(sequence, 5, primary as f64);
            battle.set_event(sequence, 6, battle.participants[primary].team as f64);
            battle.set_event(sequence, 7, shooter_index as f64);
            battle.set_event(sequence, 8, decay);
            battle.darwinism_dirty = true;
        }
    }
    if four_point_dunk {
        battle_rollup_trigger(battle, shooter_index, MUT_FOUR_POINT_DUNK);
        let sequence = battle.push_event(EV_FOUR_POINT_DUNK);
        battle.set_event(sequence, 5, shooter_index as f64);
        battle.set_event(sequence, 6, offense as f64);
        battle.set_event(sequence, 7, scoring_sequence.max(0) as f64);
    }
    if putback_arm >= 0 {
        let sequence = battle.push_event(EV_PUTBACK);
        battle.set_event(sequence, 5, if putback_valid && made { 1.0 } else { 2.0 });
        battle.set_event(sequence, 6, shooter_index as f64);
        battle.set_event(sequence, 7, offense as f64);
        battle.set_event(sequence, 8, putback_arm as f64);
        battle.set_event(
            sequence,
            9,
            if putback_valid && made {
                scoring_sequence as f64
            } else {
                -1.0
            },
        );
    }
    let team_active = battle.teams[offense].active.clone();
    for mate in team_active {
        if mate == shooter_index as usize {
            continue;
        }
        let arm = battle.participants[mate].putback_armed_at;
        if arm < 0 {
            continue;
        }
        battle.participants[mate].putback_armed_at = -1;
        let sequence = battle.push_event(EV_PUTBACK);
        battle.set_event(sequence, 5, 2.0);
        battle.set_event(sequence, 6, mate as f64);
        battle.set_event(sequence, 7, offense as f64);
        battle.set_event(sequence, 8, arm as f64);
        battle.set_event(sequence, 9, -1.0);
    }
    if has_heat {
        if made {
            if heat_before {
                if let Some(participant) = battle.participant_mut(shooter_index) {
                    participant.heat_armed = false;
                    participant.heat_armed_at = -1;
                    participant.fg_streak = 0;
                    if let Some(counters) = participant.rollup(MUT_HEAT_CHECK) {
                        counters[ROLLUP_TRIGGERS] += 1.0;
                    }
                }
                let sequence = battle.push_event(EV_HEAT_CHECK);
                battle.set_event(sequence, 5, 1.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, scoring_sequence as f64);
            } else {
                let streak = battle
                    .participant(shooter_index)
                    .map_or(0, |value| value.fg_streak + 1);
                let possession_id = battle.possession_id as i32;
                let mut armed = false;
                if let Some(participant) = battle.participant_mut(shooter_index) {
                    participant.fg_streak = streak;
                    if streak >= HAVOC_HEAT_STREAK_ARMS_AT {
                        participant.heat_armed = true;
                        participant.heat_armed_at = possession_id;
                        armed = true;
                    }
                }
                if armed {
                    battle_rollup_trigger(battle, shooter_index, MUT_HEAT_CHECK);
                    let sequence = battle.push_event(EV_HEAT_CHECK);
                    battle.set_event(sequence, 5, 0.0);
                    battle.set_event(sequence, 6, shooter_index as f64);
                    battle.set_event(sequence, 7, offense as f64);
                    battle.set_event(sequence, 8, -1.0);
                }
            }
        } else {
            let was_armed = battle
                .participant(shooter_index)
                .is_some_and(|value| value.heat_armed);
            if let Some(participant) = battle.participant_mut(shooter_index) {
                participant.fg_streak = 0;
                if was_armed {
                    participant.heat_armed = false;
                    participant.heat_armed_at = -1;
                }
            }
            if was_armed {
                let sequence = battle.push_event(EV_HEAT_CHECK);
                battle.set_event(sequence, 5, 2.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, -1.0);
            }
        }
    }
    if made && bounty_before {
        if let Some(participant) = battle.participant_mut(shooter_index) {
            participant.bounty_armed = false;
            participant.bounty_armed_at = -1;
            if let Some(counters) = participant.rollup(MUT_THE_BOUNTY) {
                counters[ROLLUP_TRIGGERS] += 1.0;
            }
        }
        let sequence = battle.push_event(EV_BOUNTY);
        battle.set_event(sequence, 5, 1.0);
        battle.set_event(sequence, 6, shooter_index as f64);
        battle.set_event(sequence, 7, offense as f64);
        battle.set_event(sequence, 8, -1.0);
        battle.set_event(sequence, 9, scoring_sequence as f64);
    }
    if let Some((ordinal, rolled)) = roulette {
        battle_rollup_trigger(battle, shooter_index, MUT_BASKETBALL_ROULETTE);
        let sequence = battle.push_event(EV_ROULETTE);
        battle.set_event(sequence, 5, shooter_index as f64);
        battle.set_event(sequence, 6, offense as f64);
        battle.set_event(sequence, 7, ordinal as f64);
        battle.set_event(sequence, 8, rolled as f64);
        battle.set_event(sequence, 9, nominal);
        battle.set_event(
            sequence,
            10,
            if made { scoring_sequence as f64 } else { -1.0 },
        );
    }
    if battle
        .participant(shooter_index)
        .is_some_and(|value| value.has(MUT_COLD_BLOODED))
    {
        if made {
            let streak = battle
                .participant(shooter_index)
                .map_or(0, |value| value.cold_blood_streak);
            if let Some(participant) = battle.participant_mut(shooter_index) {
                participant.cold_blood_streak = 0;
                if let Some(counters) = participant.rollup(MUT_COLD_BLOODED) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                    counters[ROLLUP_POINTS_DELTA] += cold_blood_bonus;
                }
            }
            if cold_blood_bonus > 0.0 {
                let sequence = battle.push_event(EV_COLD_BLOODED);
                battle.set_event(sequence, 5, 1.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, streak as f64);
                battle.set_event(sequence, 9, scoring_sequence as f64);
            }
        } else {
            let streak = battle
                .participant(shooter_index)
                .map_or(0, |value| value.cold_blood_streak + 1);
            if let Some(participant) = battle.participant_mut(shooter_index) {
                participant.cold_blood_streak = streak;
                if let Some(counters) = participant.rollup(MUT_COLD_BLOODED) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                }
            }
            let sequence = battle.push_event(EV_COLD_BLOODED);
            battle.set_event(sequence, 5, 0.0);
            battle.set_event(sequence, 6, shooter_index as f64);
            battle.set_event(sequence, 7, offense as f64);
            battle.set_event(sequence, 8, streak as f64);
            battle.set_event(sequence, 9, -1.0);
            if streak % 2 == 0 {
                let opponent = 1 - offense;
                let mut entry = [0.0; SCORING_FIELDS];
                entry[5] = opponent as f64;
                entry[6] = 3.0;
                entry[7] = shooter_index as f64;
                entry[8] = -1.0;
                entry[10] = HAVOC_COLD_BLOOD_OPPONENT_GIFT;
                entry[11] = shot_sequence as f64;
                entry[12] = 1.0;
                entry[20] = 10.0;
                entry[21] = HAVOC_COLD_BLOOD_OPPONENT_GIFT;
                entry[14] = 1.0;
                entry[15] = shooter_index as f64;
                let gift_sequence = battle.push_scoring(entry);
                if let Some(counters) = battle
                    .participant_mut(shooter_index)
                    .and_then(|participant| participant.rollup(MUT_COLD_BLOODED))
                {
                    counters[ROLLUP_POINTS_DELTA] -= HAVOC_COLD_BLOOD_OPPONENT_GIFT;
                }
                let sequence = battle.push_event(EV_COLD_BLOODED);
                battle.set_event(sequence, 5, 3.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, streak as f64);
                battle.set_event(sequence, 9, gift_sequence as f64);
            }
        }
    }
    let has_triple = battle
        .participant(shooter_index)
        .is_some_and(|value| value.has(MUT_TRIPLE_THREAT));
    if has_triple {
        let current_period = battle.period as i32;
        let stored_period = battle
            .participant(shooter_index)
            .map_or(0, |value| value.triple_threat_period);
        if current_period != stored_period {
            if let Some(participant) = battle.participant_mut(shooter_index) {
                participant.triple_threat_period = current_period;
                participant.triple_threat_zones = 0;
            }
        }
        let zones = battle
            .participant(shooter_index)
            .map_or(0, |value| value.triple_threat_zones);
        if !made {
            if zones != 0 {
                if let Some(participant) = battle.participant_mut(shooter_index) {
                    participant.triple_threat_zones = 0;
                }
                let sequence = battle.push_event(EV_TRIPLE_THREAT);
                battle.set_event(sequence, 5, 3.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, shot_class as f64);
                battle.set_event(sequence, 9, -1.0);
            }
        } else if shot_class >= 0 && (zones & (1 << shot_class)) == 0 {
            if triple_threat_completes {
                if let Some(participant) = battle.participant_mut(shooter_index) {
                    participant.triple_threat_zones = 0;
                    if let Some(counters) = participant.rollup(MUT_TRIPLE_THREAT) {
                        counters[ROLLUP_TRIGGERS] += 1.0;
                        counters[ROLLUP_POINTS_DELTA] += HAVOC_TRIPLE_THREAT_BONUS;
                    }
                }
                let sequence = battle.push_event(EV_TRIPLE_THREAT);
                battle.set_event(sequence, 5, 1.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, shot_class as f64);
                battle.set_event(sequence, 9, scoring_sequence as f64);
            } else {
                if let Some(participant) = battle.participant_mut(shooter_index) {
                    participant.triple_threat_zones |= 1 << shot_class;
                }
                let sequence = battle.push_event(EV_TRIPLE_THREAT);
                battle.set_event(sequence, 5, 0.0);
                battle.set_event(sequence, 6, shooter_index as f64);
                battle.set_event(sequence, 7, offense as f64);
                battle.set_event(sequence, 8, shot_class as f64);
                battle.set_event(sequence, 9, -1.0);
            }
        }
    }
    let _ = triple_zones;
}

fn battle_free_throw(handle: u32, side: usize, shooter_slot: usize, made: bool, bonus: bool) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let shooter_index = battle_active_participant(battle, side, shooter_slot);
    let Some(shooter_state) = battle.participant(shooter_index) else {
        return;
    };
    let charity = shooter_state.active && shooter_state.has(MUT_CHARITY_CASINO);
    let attempt_sequence = battle.push_event(EV_FREE_THROW_ATTEMPT);
    battle.set_event(attempt_sequence, 5, shooter_index as f64);
    battle.set_event(attempt_sequence, 6, side as f64);
    battle.set_event(attempt_sequence, 7, made as u32 as f64);
    battle.set_event(attempt_sequence, 8, bonus as u32 as f64);
    let double_owners = battle.active_owners(side, MUT_DOUBLE_OR_NOTHING);
    if made {
        let mut entry = [0.0; SCORING_FIELDS];
        entry[5] = side as f64;
        entry[6] = 1.0;
        entry[7] = shooter_index as f64;
        entry[8] = -1.0;
        entry[9] = 1.0;
        entry[10] = if charity { 3.0 } else { 1.0 };
        entry[11] = attempt_sequence as f64;
        entry[12] = if charity { 1.0 } else { 0.0 };
        entry[14] = if charity { 1.0 } else { 0.0 };
        if charity {
            entry[20] = 9.0;
            entry[21] = 2.0;
            entry[15] = shooter_index as f64;
        }
        let scoring_sequence = battle.push_scoring(entry);
        if charity {
            battle_rollup_trigger(battle, shooter_index, MUT_CHARITY_CASINO);
            battle.attribute(shooter_index, 9, 2.0);
            let sequence = battle.push_event(EV_CHARITY_CASINO);
            battle.set_event(sequence, 5, 0.0);
            battle.set_event(sequence, 6, shooter_index as f64);
            battle.set_event(sequence, 7, side as f64);
            battle.set_event(sequence, 8, scoring_sequence as f64);
            battle.set_event(sequence, 9, -1.0);
        }
    } else {
        if let Some(primary) = double_owners.first().copied() {
            let opponent = 1 - side;
            let mut entry = [0.0; SCORING_FIELDS];
            entry[5] = opponent as f64;
            entry[6] = 3.0;
            entry[7] = shooter_index as f64;
            entry[8] = -1.0;
            entry[10] = HAVOC_DOUBLE_MISS_GIFT;
            entry[11] = attempt_sequence as f64;
            entry[12] = 1.0;
            entry[20] = 4.0;
            entry[21] = HAVOC_DOUBLE_MISS_GIFT;
            entry[14] = double_owners.len() as f64;
            for (index, owner) in double_owners.iter().take(5).enumerate() {
                entry[15 + index] = *owner as f64;
            }
            battle.push_scoring(entry);
            battle.attribute(primary as i32, 4, -HAVOC_DOUBLE_MISS_GIFT);
        }
        if charity {
            let opponent = 1 - side;
            let mut entry = [0.0; SCORING_FIELDS];
            entry[5] = opponent as f64;
            entry[6] = 3.0;
            entry[7] = shooter_index as f64;
            entry[8] = -1.0;
            entry[10] = 2.0;
            entry[11] = attempt_sequence as f64;
            entry[12] = 1.0;
            entry[20] = 9.0;
            entry[21] = 2.0;
            entry[14] = 1.0;
            entry[15] = shooter_index as f64;
            let bonus_sequence = battle.push_scoring(entry);
            if let Some(participant) = battle.participant_mut(shooter_index) {
                if let Some(counters) = participant.rollup(MUT_CHARITY_CASINO) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                    counters[ROLLUP_POINTS_DELTA] -= 2.0;
                }
            }
            let sequence = battle.push_event(EV_CHARITY_CASINO);
            battle.set_event(sequence, 5, 1.0);
            battle.set_event(sequence, 6, shooter_index as f64);
            battle.set_event(sequence, 7, side as f64);
            battle.set_event(sequence, 8, -1.0);
            battle.set_event(sequence, 9, bonus_sequence as f64);
        }
    }
}

fn battle_assist(handle: u32, offense: usize, assister_slot: usize, scorer_slot: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let passer_index = battle_active_participant(battle, offense, assister_slot);
    let receiver_index = battle_active_participant(battle, offense, scorer_slot);
    let assist_sequence = battle.push_event(EV_ASSIST);
    battle.set_event(assist_sequence, 5, passer_index as f64);
    battle.set_event(assist_sequence, 6, receiver_index as f64);
    battle.set_event(assist_sequence, 7, offense as f64);
    let golden = battle
        .participant(passer_index)
        .is_some_and(|value| value.has(MUT_GOLDEN_ASSIST));
    if !golden {
        return;
    }
    let count = battle
        .participant(passer_index)
        .map_or(0, |value| value.assist_count + 1);
    if let Some(participant) = battle.participant_mut(passer_index) {
        participant.assist_count = count;
    }
    if count % HAVOC_GOLDEN_ASSIST_EVERY != 0 {
        return;
    }
    battle_rollup_trigger(battle, passer_index, MUT_GOLDEN_ASSIST);
    let mut entry = [0.0; SCORING_FIELDS];
    entry[5] = offense as f64;
    entry[6] = 2.0;
    entry[7] = passer_index as f64;
    entry[8] = receiver_index as f64;
    entry[10] = 1.0;
    entry[11] = assist_sequence as f64;
    entry[12] = 1.0;
    entry[20] = 3.0;
    entry[21] = 1.0;
    entry[14] = 1.0;
    entry[15] = passer_index as f64;
    let scoring_sequence = battle.push_scoring(entry);
    battle.attribute(passer_index, 3, 1.0);
    let sequence = battle.push_event(EV_GOLDEN_ASSIST);
    battle.set_event(sequence, 5, passer_index as f64);
    battle.set_event(sequence, 6, offense as f64);
    battle.set_event(sequence, 7, scoring_sequence as f64);
}

fn battle_rebound(handle: u32, side: usize, rebounder_slot: usize, offensive: bool) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let index = battle_active_participant(battle, side, rebounder_slot);
    let rebounder_sequence = battle.push_event(EV_REBOUND);
    battle.set_event(rebounder_sequence, 5, index as f64);
    battle.set_event(rebounder_sequence, 6, side as f64);
    battle.set_event(rebounder_sequence, 7, offensive as u32 as f64);
    if !offensive {
        return;
    }
    let Some(participant) = battle.participant(index) else {
        return;
    };
    let has_loop = participant.has(MUT_REBOUND_LOOP);
    let has_jackpot = participant.has(MUT_SECOND_CHANCE_JACKPOT);
    if has_loop {
        let count = participant.rebound_loop_count + 1;
        if let Some(participant) = battle.participant_mut(index) {
            participant.rebound_loop_count = count;
        }
        if count % HAVOC_REBOUND_LOOP_EVERY == 0 {
            if let Some(participant) = battle.participant_mut(index) {
                if let Some(counters) = participant.rollup(MUT_REBOUND_LOOP) {
                    counters[ROLLUP_TRIGGERS] += 1.0;
                    counters[ROLLUP_EXTRA_EARNED] += 1.0;
                }
            }
            let sequence = battle.push_event(EV_REBOUND_LOOP);
            battle.set_event(sequence, 5, index as f64);
            battle.set_event(sequence, 6, side as f64);
            battle.set_event(sequence, 7, count as f64);
            battle.set_event(sequence, 8, 1.0);
            battle.teams[side].extra_queue.push(index);
            let queued = battle.push_event(EV_EXTRA_POSSESSION);
            battle.set_event(queued, 5, 0.0);
            battle.set_event(queued, 6, index as f64);
            battle.set_event(queued, 7, side as f64);
            battle.set_event(queued, 8, -1.0);
        }
    }
    if has_jackpot {
        if let Some(participant) = battle.participant_mut(index) {
            participant.putback_armed_at = rebounder_sequence as i32;
        }
        let sequence = battle.push_event(EV_PUTBACK);
        battle.set_event(sequence, 5, 0.0);
        battle.set_event(sequence, 6, index as f64);
        battle.set_event(sequence, 7, side as f64);
        battle.set_event(sequence, 8, rebounder_sequence as f64);
        battle.set_event(sequence, 9, -1.0);
    }
}

fn battle_bounty_target(battle: &Battle, side: usize) -> i32 {
    let opponent = 1 - side;
    let starters: Vec<usize> = battle.teams[opponent]
        .participants
        .iter()
        .copied()
        .filter(|index| battle.participants[*index].kind == 0)
        .collect();
    ranked_battle_starters(battle, &starters)
        .first()
        .map_or(-1, |index| *index as i32)
}

fn ranked_battle_starters(battle: &Battle, starters: &[usize]) -> Vec<usize> {
    let mut ranked = starters.to_vec();
    ranked.sort_by(|left, right| {
        let a = &battle.participants[*left];
        let b = &battle.participants[*right];
        b.source_overall
            .partial_cmp(&a.source_overall)
            .unwrap_or(core::cmp::Ordering::Equal)
            .then_with(|| {
                let av = if a.version.is_empty() {
                    &a.player_id
                } else {
                    &a.version
                };
                let bv = if b.version.is_empty() {
                    &b.player_id
                } else {
                    &b.version
                };
                av.cmp(bv)
            })
            .then_with(|| a.instance.cmp(&b.instance))
    });
    ranked
}

fn battle_block(handle: u32, defense: usize, blocker_slot: usize, shooter_slot: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let blocker_index = battle_active_participant(battle, defense, blocker_slot);
    let shooter_index = battle_active_participant(battle, 1 - defense, shooter_slot);
    let sequence = battle.push_event(EV_BLOCK);
    battle.set_event(sequence, 5, blocker_index as f64);
    battle.set_event(sequence, 6, shooter_index as f64);
    battle.set_event(sequence, 7, defense as f64);
    let has_bounty = battle
        .participant(blocker_index)
        .is_some_and(|value| value.has(MUT_THE_BOUNTY) && !value.bounty_armed);
    if !has_bounty {
        return;
    }
    let target = battle_bounty_target(battle, defense);
    if target >= 0 && shooter_index == target {
        let possession_id = battle.possession_id as i32;
        if let Some(participant) = battle.participant_mut(blocker_index) {
            participant.bounty_armed = true;
            participant.bounty_armed_at = possession_id;
            if let Some(counters) = participant.rollup(MUT_THE_BOUNTY) {
                counters[ROLLUP_TRIGGERS] += 1.0;
            }
        }
        let sequence = battle.push_event(EV_BOUNTY);
        battle.set_event(sequence, 5, 0.0);
        battle.set_event(sequence, 6, blocker_index as f64);
        battle.set_event(sequence, 7, defense as f64);
        battle.set_event(sequence, 8, shooter_index as f64);
        battle.set_event(sequence, 9, -1.0);
    }
}

fn battle_pass_intercepted(handle: u32, offense: usize, passer: usize, defender: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let passer_index = battle_active_participant(battle, offense, passer);
    let defender_index = battle_active_participant(battle, 1 - offense, defender);
    let passer_id = battle
        .participant(passer_index)
        .map_or(String::new(), |p| p.player_id.clone());
    let defender_id = battle
        .participant(defender_index)
        .map_or(String::new(), |p| p.player_id.clone());
    for apron_handle in battle.aprons.clone() {
        if apron_record_interception(apron_handle as u32) == 0 {
            if let Some(fact) = apron_mut(apron_handle as u32).and_then(|s| s.facts.last_mut()) {
                fact.passer = passer_id.clone();
                fact.defender = defender_id.clone();
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apron_fact_player_ptr(handle: u32, index: u32, defender: u32) -> *const u8 {
    apron_ref(handle)
        .and_then(|s| s.facts.get(index as usize))
        .map_or(core::ptr::null(), |f| {
            if defender != 0 {
                f.defender.as_ptr()
            } else {
                f.passer.as_ptr()
            }
        })
}
#[unsafe(no_mangle)]
pub extern "C" fn apron_fact_player_len(handle: u32, index: u32, defender: u32) -> usize {
    apron_ref(handle)
        .and_then(|s| s.facts.get(index as usize))
        .map_or(0, |f| {
            if defender != 0 {
                f.defender.len()
            } else {
                f.passer.len()
            }
        })
}

fn battle_rebuild_profiles(handle: u32) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let count = battle.participants.len();
    for index in 0..count {
        let (team, kind, donor_base, owner_base) = {
            let participant = &battle.participants[index];
            let donor = if participant.fusion_donor >= 0 {
                battle
                    .participants
                    .get(participant.fusion_donor as usize)
                    .map(|value| (value.base_ratings, value.active))
            } else {
                None
            };
            let owner = if participant.fusion_owner >= 0 {
                battle
                    .participants
                    .get(participant.fusion_owner as usize)
                    .map(|value| value.active)
            } else {
                None
            };
            (participant.team, participant.kind, donor, owner)
        };
        let equalizer = {
            let other = 1 - team;
            battle.teams.get(other).is_some_and(|value| {
                value
                    .active
                    .iter()
                    .any(|owner| battle.participants[*owner].has(MUT_THE_GREAT_EQUALIZER))
            })
        };
        let participant = &battle.participants[index];
        let mut ratings = participant.base_ratings;
        let mut tendencies = participant.base_tendencies;
        let mut height = participant.height;
        if let Some((donor_ratings, donor_active)) = donor_base {
            if donor_active {
                for field in 0..RATING_COUNT {
                    ratings[field] = ratings[field].max(donor_ratings[field]);
                }
                tendencies[0] = 99.0;
            }
        } else if owner_base == Some(true) {
            for field in 0..RATING_COUNT {
                ratings[field] = 40.0;
            }
        }
        if participant.swap_with >= 0 {
            if let Some(target) = battle.participants.get(participant.swap_with as usize) {
                ratings = target.source_ratings;
                tendencies = target.source_tendencies;
            }
        } else if participant.swapped_by >= 0 {
            if let Some(owner) = battle.participants.get(participant.swapped_by as usize) {
                ratings = owner.source_ratings;
                tendencies = owner.source_tendencies;
            }
        }
        if participant.takeover_with >= 0 {
            if let Some(target) = battle.participants.get(participant.takeover_with as usize) {
                ratings = target.base_ratings;
                tendencies = target.base_tendencies;
            }
        } else if participant.takeover_by >= 0 {
            if let Some(owner) = battle.participants.get(participant.takeover_by as usize) {
                ratings = owner.base_ratings;
                tendencies = owner.base_tendencies;
            }
        }
        if battle.teams[team].centers_owner >= 0 && kind != 2 {
            height = 87.0;
            ratings[16] = ratings[16].max(95.0);
            ratings[11] = ratings[11].max(95.0);
            ratings[8] = ratings[8].max(95.0);
            ratings[9] = ratings[9].max(95.0);
            ratings[15] = ratings[15].min(35.0);
            ratings[5] = ratings[5].min(35.0);
            ratings[3] = ratings[3].min(40.0);
        }
        if participant.darwinism_decay > 0.0 {
            for field in 0..5 {
                ratings[field] = (ratings[field] - participant.darwinism_decay).max(0.0);
            }
        }
        if equalizer {
            for value in ratings.iter_mut() {
                *value = value.min(85.0);
            }
        }
        let evidence_mask = battle_evidence_mask_for(&battle.participants, index);
        let participant = &mut battle.participants[index];
        participant.ratings = ratings;
        participant.tendencies = tendencies;
        participant.height = height;
        participant.evidence_mask = evidence_mask;
    }
}

fn battle_evidence_mask_for(participants: &[Participant], index: usize) -> u16 {
    let Some(participant) = participants.get(index) else {
        return 0;
    };
    if participant.swap_with >= 0 || participant.swapped_by >= 0 {
        return ALL_CHANNELS;
    }
    if participant.fusion_donor >= 0 {
        return ALL_CHANNELS;
    }
    if participant.fusion_owner >= 0 {
        if participants
            .get(participant.fusion_owner as usize)
            .is_some_and(|owner| owner.active)
        {
            return ALL_CHANNELS;
        }
    }
    if participant.darwinism_decay > 0.0 {
        return participant.authority | DARWINISM_CHANNELS;
    }
    participant.authority
}

fn battle_rebuild_active(handle: u32) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    for side in 0..2 {
        let mut active: Vec<usize> = Vec::new();
        for slot in 0..5 {
            if let Some(index) = battle.teams[side]
                .participants
                .iter()
                .copied()
                .find(|index| {
                    let participant = &battle.participants[*index];
                    participant.active && participant.kind != 2 && participant.slot_index == slot
                })
            {
                active.push(index);
            }
        }
        for index in battle.teams[side].participants.clone() {
            let participant = &battle.participants[index];
            if participant.active && participant.kind == 2 {
                active.push(index);
            }
        }
        battle.teams[side].active = active;
    }
}

fn battle_rebuild_all(handle: u32) {
    battle_rebuild_active(handle);
    battle_rebuild_profiles(handle);
    battle_rebuild_active(handle);
}

fn battle_recompute_equalizer(handle: u32, tipoff: bool) -> bool {
    let Some(battle) = battle_ptr(handle) else {
        return false;
    };
    let mut changed = false;
    for side in 0..2 {
        let owners = battle.active_owners(side, MUT_THE_GREAT_EQUALIZER);
        if owners.is_empty() {
            continue;
        }
        let mut capped: Vec<String> = battle.teams[1 - side]
            .active
            .iter()
            .map(|index| battle.participants[*index].instance.clone())
            .collect();
        capped.sort();
        if !tipoff && capped == battle.last_capped[side] {
            continue;
        }
        battle.last_capped[side] = capped.clone();
        changed = true;
        let owner = owners[0];
        battle_rollup_trigger(battle, owner as i32, MUT_THE_GREAT_EQUALIZER);
        let sequence = battle.push_event(EV_GREAT_EQUALIZER);
        battle.set_event(
            sequence,
            5,
            if battle.equalizer_applied[side] {
                1.0
            } else {
                0.0
            },
        );
        battle.set_event(sequence, 6, owner as f64);
        battle.set_event(sequence, 7, capped.len().min(10) as f64);
        for (index, id) in capped.iter().take(10).enumerate() {
            let participant_index = battle
                .participants
                .iter()
                .position(|participant| participant.instance == *id)
                .unwrap_or(0);
            battle.set_event(sequence, 8 + index, participant_index as f64);
        }
        battle.equalizer_applied[side] = true;
    }
    if !tipoff && changed {
        battle_rebuild_profiles(handle);
    }
    changed
}

fn battle_recompute_time_lord(handle: u32, owner_exit: bool) -> bool {
    let Some(battle) = battle_ptr(handle) else {
        return false;
    };
    let limits = [battle_full_clock(handle, 0), battle_full_clock(handle, 1)];
    if limits == battle.last_time_lord {
        return false;
    }
    let previous = battle.last_time_lord;
    battle.last_time_lord = limits;
    for side in 0..2 {
        if limits[side] == previous[side] {
            continue;
        }
        let sequence = battle.push_event(EV_TIME_LORD);
        battle.set_event(sequence, 5, side as f64);
        battle.set_event(sequence, 6, limits[side]);
        battle.set_event(sequence, 7, limits[side].min(14.0));
        battle.set_event(sequence, 8, if owner_exit { 1.0 } else { 0.0 });
        if owner_exit {
            if let Some(clock) = battle.clock {
                battle.clock = Some(clock.min(limits[side]));
            }
        }
    }
    true
}

fn battle_end_powers_for(battle: &mut Battle, index: usize) {
    let side = battle.participants[index].team;
    {
        let participant = &mut battle.participants[index];
        participant.heat_armed = false;
        participant.heat_armed_at = -1;
        participant.fg_streak = 0;
        participant.bounty_armed = false;
        participant.bounty_armed_at = -1;
        participant.putback_armed_at = -1;
        participant.cold_blood_streak = 0;
        participant.triple_threat_zones = 0;
    }
    if battle.teams[side].centers_owner == index as i32 {
        battle.teams[side].centers_owner = -1;
    }
    let donor = battle.participants[index].fusion_donor;
    if donor >= 0 {
        if let Some(participant) = battle.participant_mut(index as i32) {
            participant.fusion_donor = -1;
        }
        if let Some(value) = battle.participant_mut(donor) {
            value.fusion_owner = -1;
        }
        let sequence = battle.push_event(EV_FUSION_DANCE);
        battle.set_event(sequence, 5, 1.0);
        battle.set_event(sequence, 6, index as f64);
        battle.set_event(sequence, 7, donor as f64);
        battle.set_event(sequence, 8, side as f64);
    }
    let swap = battle.participants[index].swap_with;
    if swap >= 0 {
        if let Some(participant) = battle.participant_mut(index as i32) {
            participant.swap_with = -1;
        }
        if let Some(value) = battle.participant_mut(swap) {
            value.swapped_by = -1;
        }
        let sequence = battle.push_event(EV_BODY_SNATCHER);
        battle.set_event(sequence, 5, 1.0);
        battle.set_event(sequence, 6, index as f64);
        battle.set_event(sequence, 7, swap as f64);
        battle.set_event(sequence, 8, side as f64);
    }
}

fn battle_remove_clone(battle: &mut Battle, team: usize, owner: i32, fouled_out: bool) {
    let clone = battle.teams[team]
        .participants
        .iter()
        .copied()
        .find(|index| {
            let participant = &battle.participants[*index];
            participant.kind == 2 && participant.owner == owner && participant.active
        });
    let Some(clone) = clone else {
        return;
    };
    battle.participants[clone].active = false;
    battle.participants[clone].clone_exited = true;
    let sequence = battle.push_event(EV_CLONE);
    battle.set_event(sequence, 5, 1.0);
    battle.set_event(sequence, 6, owner as f64);
    battle.set_event(sequence, 7, clone as f64);
    battle.set_event(sequence, 8, team as f64);
    battle.set_event(sequence, 9, if fouled_out { 1.0 } else { 0.0 });
}

fn battle_process_exits_inner(battle: &mut Battle) -> bool {
    let mut changed = false;
    for team_index in 0..2 {
        for index in battle.teams[team_index].participants.clone() {
            let (active, charged, kind, replaced, owner) = {
                let participant = &battle.participants[index];
                (
                    participant.active,
                    participant.charged_fouls,
                    participant.kind,
                    participant.replaced,
                    participant.owner,
                )
            };
            if !active || charged < HAVOC_PERSONAL_FOUL_LIMIT {
                continue;
            }
            if kind == 0 && !replaced {
                let replacement =
                    battle.teams[team_index]
                        .participants
                        .iter()
                        .copied()
                        .find(|candidate| {
                            let participant = &battle.participants[*candidate];
                            participant.kind == 1 && participant.owner == index as i32
                        });
                battle.participants[index].active = false;
                battle.participants[index].replaced = true;
                let in_index = if let Some(replacement) = replacement {
                    battle.participants[replacement].active = true;
                    battle.participants[replacement].started = true;
                    replacement
                } else {
                    index
                };
                let sequence = battle.push_event(EV_SUBSTITUTION);
                battle.set_event(sequence, 5, index as f64);
                battle.set_event(sequence, 6, in_index as f64);
                battle.set_event(sequence, 7, 0.0);
                battle_end_powers_for(battle, index);
                battle_remove_clone(battle, team_index, index as i32, false);
                changed = true;
            } else if kind == 2 {
                battle_remove_clone(battle, team_index, owner, true);
                changed = true;
            }
        }
    }
    changed
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_tipoff(handle: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    for side in 0..2 {
        for index in battle.teams[side].participants.clone() {
            let (kind, owner) = {
                let participant = &battle.participants[index];
                (participant.kind, participant.owner)
            };
            if kind != 2 || owner < 0 {
                continue;
            }
            let owner_active = battle.participant(owner).is_some_and(|value| value.active);
            let owner_has_clone = battle
                .participant(owner)
                .is_some_and(|value| value.has(MUT_CLONE_ARMY));
            if !owner_active || !owner_has_clone {
                continue;
            }
            battle.participants[index].active = true;
            battle.participants[index].started = true;
            battle_rollup_trigger(battle, owner, MUT_CLONE_ARMY);
            let sequence = battle.push_event(EV_CLONE);
            battle.set_event(sequence, 5, 0.0);
            battle.set_event(sequence, 6, owner as f64);
            battle.set_event(sequence, 7, index as f64);
            battle.set_event(sequence, 8, side as f64);
            battle.set_event(sequence, 9, -1.0);
        }
    }
    for side in 0..2 {
        let owner = battle.teams[side]
            .participants
            .iter()
            .copied()
            .find(|index| {
                let participant = &battle.participants[*index];
                participant.kind == 0 && participant.has(MUT_FUSION_DANCE)
            });
        let Some(owner) = owner else { continue };
        let starters: Vec<usize> = battle.teams[side]
            .participants
            .iter()
            .copied()
            .filter(|index| {
                let participant = &battle.participants[*index];
                participant.kind == 0 && *index != owner
            })
            .collect();
        let donor = {
            let mut ranked = starters.clone();
            ranked.sort_by(|left, right| {
                let a = &battle.participants[*left];
                let b = &battle.participants[*right];
                b.source_overall
                    .partial_cmp(&a.source_overall)
                    .unwrap_or(core::cmp::Ordering::Equal)
                    .then_with(|| a.slot_index.cmp(&b.slot_index))
            });
            ranked.first().copied()
        };
        let Some(donor) = donor else { continue };
        battle.participants[owner].fusion_donor = donor as i32;
        battle.participants[donor].fusion_owner = owner as i32;
        battle_rollup_trigger(battle, owner as i32, MUT_FUSION_DANCE);
        let sequence = battle.push_event(EV_FUSION_DANCE);
        battle.set_event(sequence, 5, 0.0);
        battle.set_event(sequence, 6, owner as f64);
        battle.set_event(sequence, 7, donor as f64);
        battle.set_event(sequence, 8, side as f64);
    }
    for side in 0..2 {
        let opponents: Vec<usize> = battle.teams[1 - side]
            .participants
            .iter()
            .copied()
            .filter(|index| battle.participants[*index].kind == 0)
            .collect();
        let ranked = ranked_battle_starters(battle, &opponents);
        let owners: Vec<usize> = battle.teams[side]
            .participants
            .iter()
            .copied()
            .filter(|index| {
                let participant = &battle.participants[*index];
                participant.kind == 0 && participant.has(MUT_BODY_SNATCHER)
            })
            .collect();
        for (ordinal, owner) in owners.iter().enumerate() {
            let Some(target) = ranked.get(ordinal).copied() else {
                continue;
            };
            battle.participants[*owner].swap_with = target as i32;
            battle.participants[target].swapped_by = *owner as i32;
            battle_rollup_trigger(battle, *owner as i32, MUT_BODY_SNATCHER);
            let sequence = battle.push_event(EV_BODY_SNATCHER);
            battle.set_event(sequence, 5, 0.0);
            battle.set_event(sequence, 6, *owner as f64);
            battle.set_event(sequence, 7, target as f64);
            battle.set_event(sequence, 8, side as f64);
        }
        let takeover_owner = battle.teams[side]
            .participants
            .iter()
            .copied()
            .find(|index| {
                let participant = &battle.participants[*index];
                participant.kind == 0 && participant.has(MUT_HOSTILE_TAKEOVER)
            });
        if let Some(owner) = takeover_owner {
            let own_starters: Vec<usize> = battle.teams[side]
                .participants
                .iter()
                .copied()
                .filter(|index| battle.participants[*index].kind == 0)
                .collect();
            let mut lowest = own_starters.clone();
            lowest.sort_by(|left, right| {
                let a = &battle.participants[*left];
                let b = &battle.participants[*right];
                a.source_overall
                    .partial_cmp(&b.source_overall)
                    .unwrap_or(core::cmp::Ordering::Equal)
                    .then_with(|| {
                        let av = if a.version.is_empty() {
                            &a.player_id
                        } else {
                            &a.version
                        };
                        let bv = if b.version.is_empty() {
                            &b.player_id
                        } else {
                            &b.version
                        };
                        av.cmp(bv)
                    })
                    .then_with(|| a.instance.cmp(&b.instance))
            });
            let from = lowest.first().copied();
            let to = ranked.first().copied();
            if let (Some(from), Some(to)) = (from, to) {
                battle.participants[from].takeover_with = to as i32;
                battle.participants[to].takeover_by = from as i32;
                battle_rollup_trigger(battle, owner as i32, MUT_HOSTILE_TAKEOVER);
                let sequence = battle.push_event(EV_HOSTILE_TAKEOVER);
                battle.set_event(sequence, 5, 0.0);
                battle.set_event(sequence, 6, owner as f64);
                battle.set_event(sequence, 7, side as f64);
                battle.set_event(sequence, 8, from as f64);
                battle.set_event(sequence, 9, to as f64);
            }
        }
    }
    for side in 0..2 {
        let owner = battle.teams[side]
            .participants
            .iter()
            .copied()
            .find(|index| {
                let participant = &battle.participants[*index];
                participant.kind == 0 && participant.has(MUT_OOPS_ALL_CENTERS)
            });
        let Some(owner) = owner else { continue };
        battle.teams[side].centers_owner = owner as i32;
        let mut resized: Vec<String> = battle.teams[side]
            .participants
            .iter()
            .copied()
            .filter(|index| battle.participants[*index].kind == 0)
            .map(|index| battle.participants[index].instance.clone())
            .collect();
        resized.sort();
        battle_rollup_trigger(battle, owner as i32, MUT_OOPS_ALL_CENTERS);
        let sequence = battle.push_event(EV_OOPS_ALL_CENTERS);
        battle.set_event(sequence, 5, 0.0);
        battle.set_event(sequence, 6, owner as f64);
        battle.set_event(sequence, 7, side as f64);
        battle.set_event(sequence, 8, resized.len().min(10) as f64);
        for (index, id) in resized.iter().take(10).enumerate() {
            let participant_index = battle
                .participants
                .iter()
                .position(|participant| participant.instance == *id)
                .unwrap_or(0);
            battle.set_event(sequence, 9 + index, participant_index as f64);
        }
    }
    battle_rebuild_all(handle);
    battle_recompute_equalizer(handle, true);
    battle_recompute_time_lord(handle, false);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_open(handle: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 2;
    };
    battle.period = 1;
    battle.period_fouls = [0.0, 0.0];
    battle.possession_start = 0;
    battle.seconds = 0.0;
    battle.clock = None;
    battle.teams[0].period_points = vec![0.0];
    battle.teams[1].period_points = vec![0.0];
    battle.open = true;
    let offense = if battle.internal_rng {
        if internal_chance(&mut battle.rng_state, 0.5) {
            0
        } else {
            1
        }
    } else {
        unsafe { if rng_chance(0.5) != 0 { 0 } else { 1 } }
    };
    let event = battle.push_event(EV_PERIOD_START);
    battle.set_event(event, 4, 0.0);
    offense
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_begin_period(handle: u32, period: u32, _seconds: f64) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    battle.period = period;
    battle.period_fouls = [0.0, 0.0];
    battle.clock = None;
    battle.possession_start = 0;
    battle.teams[0].period_points.push(0.0);
    battle.teams[1].period_points.push(0.0);
    let event = battle.push_event(EV_PERIOD_START);
    battle.set_event(event, 4, 0.0);
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_end_period(handle: u32) -> f64 {
    let Some(battle) = battle_ptr(handle) else {
        return 0.0;
    };
    let home = battle.side_points(0);
    let away = battle.side_points(1);
    let sequence = battle.push_event(EV_PERIOD_END);
    battle.set_event(sequence, 5, home);
    battle.set_event(sequence, 6, away);
    home - away
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_begin_possession(handle: u32, possession_id: u32, offense: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    battle.possession_id = possession_id;
    battle.shot_kind_ordinal = 0;

    battle.coverage.valid = false;
    let sequence = battle.push_event(EV_POSSESSION_START);
    battle.set_event(sequence, 5, possession_id as f64);
    battle.set_event(sequence, 6, offense as f64);
    let aprons = battle.aprons.clone();
    for apron in aprons {
        apron_begin(apron as u32, offense);
    }
    for team_index in 0..2 {
        for index in battle.teams[team_index].participants.clone() {
            let participant = &battle.participants[index];
            if participant.heat_armed && participant.heat_armed_at >= 0 {
                if possession_id as i32 - participant.heat_armed_at >= HAVOC_HEAT_EXPIRY_POSSESSIONS
                {
                    battle.participants[index].heat_armed = false;
                    battle.participants[index].heat_armed_at = -1;
                    battle.participants[index].fg_streak = 0;
                    let event = battle.push_event(EV_HEAT_CHECK);
                    battle.set_event(event, 5, 2.0);
                    battle.set_event(event, 6, index as f64);
                    battle.set_event(event, 7, team_index as f64);
                    battle.set_event(event, 8, -1.0);
                }
            }
            let participant = &battle.participants[index];
            if participant.bounty_armed && participant.bounty_armed_at >= 0 {
                if possession_id as i32 - participant.bounty_armed_at
                    >= HAVOC_BOUNTY_EXPIRY_POSSESSIONS
                {
                    battle.participants[index].bounty_armed = false;
                    battle.participants[index].bounty_armed_at = -1;
                    let event = battle.push_event(EV_BOUNTY);
                    battle.set_event(event, 5, 2.0);
                    battle.set_event(event, 6, index as f64);
                    battle.set_event(event, 7, team_index as f64);
                    battle.set_event(event, 8, -1.0);
                    battle.set_event(event, 9, -1.0);
                }
            }
        }
    }
    0
}

fn battle_end_possession_inner(handle: u32, offense: usize) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    let team_index = offense;
    let active = battle.teams[team_index].active.clone();
    for index in active {
        let arm = battle.participants[index].putback_armed_at;
        if arm < 0 {
            continue;
        }
        battle.participants[index].putback_armed_at = -1;
        let sequence = battle.push_event(EV_PUTBACK);
        battle.set_event(sequence, 5, 2.0);
        battle.set_event(sequence, 6, index as f64);
        battle.set_event(sequence, 7, team_index as f64);
        battle.set_event(sequence, 8, arm as f64);
        battle.set_event(sequence, 9, -1.0);
    }
    battle.coverage.valid = false;
    battle.rushed_extra_side = -1;
    let aprons = battle.aprons.clone();
    for apron in aprons {
        apron_end(apron as u32);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_end_possession(handle: u32, offense: u32) {
    battle_end_possession_inner(handle, offense as usize);
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_boundary(handle: u32) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 0;
    };
    let changed = battle_process_exits_inner(battle);
    let equalizer_changed = battle_recompute_equalizer(handle, false);
    let time_lord_changed = battle_recompute_time_lord(handle, true);
    let darwinism_changed = battle.darwinism_dirty;
    battle.darwinism_dirty = false;
    if changed || equalizer_changed || time_lord_changed || darwinism_changed {
        battle_rebuild_all(handle);
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_expire_extra(handle: u32) {
    let Some(battle) = battle_ptr(handle) else {
        return;
    };
    for side in 0..2 {
        while let Some(owner) = battle.teams[side].extra_queue.first().copied() {
            battle.teams[side].extra_queue.remove(0);
            if let Some(participant) = battle.participant_mut(owner) {
                if let Some(counters) = participant.rollup(MUT_REBOUND_LOOP) {
                    counters[ROLLUP_EXTRA_EXPIRED] += 1.0;
                }
            }
            let sequence = battle.push_event(EV_EXTRA_POSSESSION);
            battle.set_event(sequence, 5, 2.0);
            battle.set_event(sequence, 6, owner as f64);
            battle.set_event(sequence, 7, side as f64);
            battle.set_event(sequence, 8, -1.0);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_consume_extra(handle: u32, side: u32) -> i32 {
    let Some(battle) = battle_ptr(handle) else {
        return -1;
    };
    let side = side as usize;
    if battle.teams[side].extra_queue.is_empty() {
        return -1;
    }
    let owner = battle.teams[side].extra_queue.remove(0);
    if let Some(participant) = battle.participant_mut(owner) {
        if let Some(counters) = participant.rollup(MUT_REBOUND_LOOP) {
            counters[ROLLUP_EXTRA_USED] += 1.0;
        }
    }
    battle.rushed_extra_side = side as i32;
    let sequence = battle.push_event(EV_EXTRA_POSSESSION);
    battle.set_event(sequence, 5, 1.0);
    battle.set_event(sequence, 6, owner as f64);
    battle.set_event(sequence, 7, side as f64);
    battle.set_event(sequence, 8, battle.possession_id as f64 + 1.0);
    owner
}

fn battle_struck_for_side(battle: &Battle, side: usize) -> bool {
    let target = battle_struck_index_from(battle, side);
    if target < 0 {
        return false;
    }
    let target = &battle.participants[target as usize];
    if battle.teams[side]
        .active
        .iter()
        .filter(|index| {
            let p = &battle.participants[**index];
            p.player_id == target.player_id && p.version == target.version
        })
        .count()
        != 1
    {
        return false;
    }
    for apron_handle in battle.aprons.iter() {
        let Some(apron) = apron_ref(*apron_handle as u32) else {
            continue;
        };
        if apron.side == side as u32 && apron.active && apron.strike {
            return true;
        }
    }
    false
}

fn battle_struck_index_from(battle: &Battle, side: usize) -> i32 {
    for (position, apron_handle) in battle.aprons.iter().enumerate() {
        let target = battle.apron_targets.get(position).copied().unwrap_or(-1);
        if target < 0 {
            continue;
        }
        let Some(participant) = battle.participants.get(target as usize) else {
            continue;
        };
        if participant.team == side && participant.active {
            let Some(apron) = apron_ref(*apron_handle as u32) else {
                continue;
            };
            if apron.side == side as u32 {
                return target;
            }
        }
    }
    -1
}

fn battle_kill_layout(battle: &mut Battle, side: usize, struck: bool) -> Vec<f64> {
    battle.layouts[side * 2 + struck as usize]
        .take()
        .unwrap_or_default()
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_trip(handle: u32, offense: u32, seconds: f64) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 0xffff_ffff;
    };
    let offense = offense as usize;
    if offense > 1 {
        return 0xffff_ffff;
    }
    let defense = 1 - offense;
    if battle.teams[offense].active.len() < 2 {
        return 0xffff_ffff;
    }
    battle.seconds = seconds;
    battle.clock = Some(battle_full_clock(handle, offense));
    let struck_offense = battle_struck_for_side(battle, offense) && offense != defense;
    let struck_defense = battle_struck_for_side(battle, defense);
    let _ = struck_offense;
    let layout0 = battle_kill_layout(battle, 0, false);
    let layout1 = battle_kill_layout(battle, 1, false);
    let layout0_struck = if struck_defense && defense == 0 {
        battle_kill_layout(battle, 0, true)
    } else {
        Vec::new()
    };
    let layout1_struck = if struck_defense && defense == 1 {
        battle_kill_layout(battle, 1, true)
    } else {
        Vec::new()
    };
    let use0 = if defense == 0 && struck_defense && !layout0_struck.is_empty() {
        layout0_struck.as_slice()
    } else {
        layout0.as_slice()
    };
    let use1 = if defense == 1 && struck_defense && !layout1_struck.is_empty() {
        layout1_struck.as_slice()
    } else {
        layout1.as_slice()
    };
    if use0.is_empty() || use1.is_empty() {
        battle.layouts[0] = Some(layout0);
        battle.layouts[2] = Some(layout1);
        if !layout0_struck.is_empty() {
            battle.layouts[1] = Some(layout0_struck);
        }
        if !layout1_struck.is_empty() {
            battle.layouts[3] = Some(layout1_struck);
        }
        return 0xffff_fffe;
    }
    let count0 = battle.teams[0].active.len();
    let count1 = battle.teams[1].active.len();
    let mut reader0 = Reader {
        data: use0,
        cursor: 0,
    };
    let team0 = Team::read(&mut reader0, count0, count1);
    let mut reader1 = Reader {
        data: use1,
        cursor: 0,
    };
    let team1 = Team::read(&mut reader1, count1, count0);
    let teams = [team0, team1];
    let mut dynamic = [0.0f64; 96];
    dynamic[0] = offense as f64;
    dynamic[1] = seconds;
    dynamic[2] = (battle.period - 1) as f64;
    dynamic[3] = battle.period_fouls[0];
    dynamic[4] = battle.period_fouls[1];
    dynamic[5] = battle.possession_start as f64;
    dynamic[6] = battle.clock.map_or(-1.0, |clock| clock);
    dynamic[7] = 0.0;
    dynamic[15] = battle.rng_state as f64;
    for side in 0..2 {
        let forced = {
            let mut value = -1.0;
            for (position, apron_handle) in battle.aprons.iter().enumerate() {
                let target = battle.apron_targets.get(position).copied().unwrap_or(-1);
                if target < 0 {
                    continue;
                }
                let Some(apron) = apron_ref(*apron_handle as u32) else {
                    continue;
                };
                if apron.side != side as u32 || !apron.active {
                    continue;
                }
                if battle
                    .participants
                    .get(target as usize)
                    .is_some_and(|participant| participant.active && participant.team == side)
                    && apron_isolation(*apron_handle as u32) != 0
                {
                    if let Some(slot) = battle.teams[side]
                        .active
                        .iter()
                        .position(|index| *index as i32 == target)
                    {
                        value = slot as f64;
                    }
                }
            }
            value
        };
        dynamic[11 + side] = forced;
        let mut chance = 0.0f64;
        for apron_handle in battle.aprons.iter() {
            chance = chance.max(apron_interception_chance(*apron_handle as u32, side as u32));
        }
        dynamic[13 + side] = chance;
    }
    let mut cursor = 16;
    for side in 0..2 {
        for &index in &battle.teams[side].active {
            dynamic[cursor] = battle.participants[index].personal_fouls;
            cursor += 1;
        }
    }
    let evidence_base = 16 + count0 + count1;
    let mut cursor = evidence_base;
    for side in 0..2 {
        for &index in &battle.teams[side].active {
            dynamic[cursor] =
                if battle_evidence_mask_for(&battle.participants, index) == ALL_CHANNELS {
                    2.0
                } else {
                    0.0
                };
            cursor += 1;
        }
    }
    let constants = battle.c;
    let mut trip = Trip {
        c: &constants,
        teams: &teams,
        dynamic: &dynamic,
        battle: handle,
        rng: Rng {
            state: battle.rng_state,
            internal: battle.internal_rng,
        },
        offense,
        remaining: seconds,
        started_remaining: seconds,
        period_index: (battle.period - 1) as usize,
        period_fouls: battle.period_fouls,
        personal: [[0.0; 10]; 2],
        possession_start: battle.possession_start,
        clock: battle.clock,
        dead: false,
        foul_index: 0,
        continuations: 0,
        rush_penalty: 0.0,
        handler: -1,
        shooter: -1,
        defender: -1,
        trip_rebounds: [0.0, 0.0],
        stats: [[[0.0; STAT_FIELDS]; MAX_UNITS]; 2],
        race_decided: 0,
        race_home: 0.0,
        race_away: 0.0,
        race_target: 0.0,
        evidence_base,
        done: false,
        ended: false,
        period_ended: false,
    };
    for side in 0..2 {
        for (slot, index) in battle.teams[side].active.iter().enumerate() {
            trip.personal[side][slot] = battle.participants[*index].personal_fouls;
        }
    }
    trip.sample_havoc();
    let ended = trip.ended;
    let remaining = trip.remaining;
    battle.seconds = remaining;
    battle.clock = trip.clock;
    battle.period_fouls = trip.period_fouls;
    battle.possession_start = trip.possession_start;
    battle.rng_state = trip.rng.state;
    for side in 0..2 {
        for (slot, index) in battle.teams[side].active.iter().enumerate() {
            battle.participants[*index].personal_fouls = trip.personal[side][slot];
        }
    }
    let elapsed = seconds - remaining;
    if elapsed > 0.0 {
        for side in 0..2 {
            for &index in &battle.teams[side].active {
                battle.participants[index].active_seconds += elapsed;
            }
        }
    }
    for side in 0..2 {
        let count = battle.teams[side].active.len();
        for unit in 0..=count {
            for field in 0..STAT_FIELDS {
                let value = trip.stats[side][unit][field];
                if value == 0.0 {
                    continue;
                }
                if unit == 0 {
                    battle.teams[side].stats[field] += value;
                } else if let Some(index) = battle.teams[side].active.get(unit - 1).copied() {
                    battle.participants[index].stats[field] += value;
                }
            }
        }
    }
    battle.layouts[0] = Some(layout0);
    battle.layouts[2] = Some(layout1);
    if !layout0_struck.is_empty() {
        battle.layouts[1] = Some(layout0_struck);
    }
    if !layout1_struck.is_empty() {
        battle.layouts[3] = Some(layout1_struck);
    }
    ended as u32
}

fn battle_round_court_seconds(battle: &Battle, game_seconds: f64) -> (Vec<f64>, f64) {
    let mut seconds = vec![0.0; battle.participants.len()];
    for (index, participant) in battle.participants.iter().enumerate() {
        if participant.started {
            seconds[index] = participant.active_seconds.round();
        }
    }
    for slot in 0..10 {
        let side = slot / 5;
        let slot = slot % 5;
        let chain: Vec<usize> = battle
            .participants
            .iter()
            .enumerate()
            .filter(|(_, participant)| {
                participant.team == side && participant.kind != 2 && participant.slot_index == slot
            })
            .map(|(index, _)| index)
            .collect();
        if chain.is_empty() {
            continue;
        }
        let rounded: f64 = chain.iter().map(|index| seconds[*index]).sum();
        let error = game_seconds - rounded;
        if error == 0.0 {
            continue;
        }
        let mut best = chain[0];
        let mut best_fraction = f64::NEG_INFINITY;
        for index in &chain {
            let fraction = battle.participants[*index].active_seconds
                - battle.participants[*index].active_seconds.floor();
            if fraction > best_fraction {
                best_fraction = fraction;
                best = *index;
            }
        }
        seconds[best] += error;
    }
    let clone_seconds: f64 = battle
        .participants
        .iter()
        .enumerate()
        .filter(|(_, participant)| participant.kind == 2 && participant.started)
        .map(|(index, _)| seconds[index])
        .sum();
    (seconds, clone_seconds)
}

fn battle_highlights(battle: &Battle) -> Vec<[f64; HIGHLIGHT_FIELDS]> {
    let mut highlights: Vec<[f64; HIGHLIGHT_FIELDS]> = Vec::new();
    for entry in &battle.scoring {
        if highlights.len() >= MAX_HIGHLIGHTS {
            break;
        }
        let addend_count = entry[12] as usize;
        let multiplier_count = entry[13] as usize;
        if addend_count == 0 && multiplier_count == 0 {
            continue;
        }
        let source = if addend_count > 0 {
            entry[20] as usize
        } else {
            entry[36] as usize
        };
        let mut record = [0.0; HIGHLIGHT_FIELDS];
        record[0] = 0.0;
        record[1] = entry[2];
        record[2] = entry[3];
        record[3] = entry[7];
        record[4] = mutation_of_source(source) as f64;
        record[5] = entry[10] - entry[9];
        highlights.push(record);
    }
    for team_index in 0..2 {
        for index in battle.teams[team_index].participants.clone() {
            if highlights.len() >= MAX_HIGHLIGHTS {
                break;
            }
            let participant = &battle.participants[index];
            if highlights.len() >= MAX_HIGHLIGHTS {
                break;
            }
            let fouled_out = (participant.kind == 0 && participant.replaced)
                || (participant.kind == 2 && participant.clone_exited);
            if fouled_out {
                let mut record = [0.0; HIGHLIGHT_FIELDS];
                record[0] = 1.0;
                record[1] = battle.period as f64;
                record[2] = 0.0;
                record[3] = index as f64;
                record[4] = -1.0;
                record[5] = 0.0;
                highlights.push(record);
            }
        }
    }
    let mut totals = [[0.0f64; 40]; 2];
    for entry in &battle.scoring {
        let side = entry[5] as usize;
        let period = entry[2] as usize - 1;
        if side < 2 && period < 40 {
            totals[side][period] += entry[10];
        }
    }
    for side in 0..2 {
        if highlights.len() >= MAX_HIGHLIGHTS {
            break;
        }
        if let Some(position) = totals[side]
            .iter()
            .take(battle.period as usize)
            .position(|value| *value < 0.0)
        {
            let mut record = [0.0; HIGHLIGHT_FIELDS];
            record[0] = 2.0;
            record[1] = position as f64 + 1.0;
            record[2] = 0.0;
            record[3] = -1.0;
            record[4] = -1.0;
            record[5] = totals[side][position];
            highlights.push(record);
        }
    }
    highlights
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_finalize(handle: u32, game_seconds: f64) -> u32 {
    let Some(battle) = battle_ptr(handle) else {
        return 1;
    };
    battle_expire_extra(handle);
    let home = battle.side_points(0);
    let away = battle.side_points(1);
    let sequence = battle.push_event(EV_GAME_END);
    battle.set_event(sequence, 5, home);
    battle.set_event(sequence, 6, away);
    battle.set_event(sequence, 7, if home > away { 0.0 } else { 1.0 });
    let (seconds, _clone_seconds) = battle_round_court_seconds(battle, game_seconds);
    let highlights = battle_highlights(battle);
    let rollups: Vec<[f64; ROLLUP_FIELDS]> = {
        let mut records = Vec::new();
        for side in 0..2 {
            for index in battle.teams[side].participants.clone() {
                let participant = &battle.participants[index];
                if participant.mutation_count == 0 {
                    continue;
                }
                let active_seconds = participant.active_seconds.round();
                for ordinal in 0..participant.mutation_count {
                    let mutation = participant.mutation_order[ordinal];
                    if mutation == 0 {
                        continue;
                    }
                    let mutation = mutation - 1;
                    if mutation >= MUTATION_COUNT {
                        continue;
                    }
                    let counters = participant.rollup[mutation];
                    let mut record = [0.0; ROLLUP_FIELDS];
                    record[0] = index as f64;
                    record[1] = mutation as f64;
                    record[2] = side as f64;
                    for field in 0..9 {
                        record[3 + field] = counters[field];
                    }
                    record[12] = if mutation == MUT_BODY_SNATCHER || mutation == MUT_FUSION_DANCE {
                        active_seconds
                    } else {
                        0.0
                    };
                    record[13] = if mutation == MUT_THE_GREAT_EQUALIZER {
                        active_seconds
                    } else {
                        0.0
                    };
                    record[14] = active_seconds;
                    records.push(record);
                    if records.len() >= MAX_ROLLUPS {
                        break;
                    }
                }
                if records.len() >= MAX_ROLLUPS {
                    break;
                }
            }
            if records.len() >= MAX_ROLLUPS {
                break;
            }
        }
        records
    };
    let scratch = battle_scratch();
    let mut cursor;
    scratch[0] = 2.0;
    scratch[1] = battle.participants.len() as f64;
    scratch[2] = rollups.len() as f64;
    scratch[3] = highlights.len() as f64;
    scratch[4] = battle.events.len() as f64;
    scratch[5] = battle.scoring.len() as f64;
    scratch[6] = battle.period as f64;
    scratch[7] = 44.0;
    scratch[8] = PARTICIPANT_RECORD_FIELDS as f64;
    scratch[9] = ROLLUP_FIELDS as f64;
    scratch[10] = HIGHLIGHT_FIELDS as f64;
    cursor = 16;
    for side in 0..2 {
        let base = cursor;
        let stats = battle.teams[side].stats;
        scratch[base] = side as f64;
        scratch[base + 1] = battle.side_points(side);
        for field in 0..STAT_FIELDS {
            scratch[base + 2 + field] = stats[field];
        }
        scratch[base + 42] = battle.team_bonus_points(side);
        scratch[base + 43] = 5.0 * game_seconds
            + battle
                .participants
                .iter()
                .enumerate()
                .filter(|(_, p)| p.team == side && p.kind == 2 && p.started)
                .map(|(i, _)| seconds[i])
                .sum::<f64>();
        cursor += 44;
    }
    for index in 0..battle.participants.len() {
        let participant = &battle.participants[index];
        let base = cursor;
        scratch[base] = index as f64;
        scratch[base + 1] = participant.kind as f64;
        scratch[base + 2] = participant.slot_index as f64;
        scratch[base + 3] = participant.owner as f64;
        scratch[base + 4] = seconds[index];
        scratch[base + 5] = participant.charged_fouls as f64;
        scratch[base + 6] = participant.started as u32 as f64;
        scratch[base + 7] = participant.replaced as u32 as f64;
        scratch[base + 8] = participant.clone_exited as u32 as f64;
        scratch[base + 9] = battle.participant_points(index);
        for field in 0..STAT_FIELDS {
            scratch[base + 10 + field] = participant.stats[field];
        }
        cursor += PARTICIPANT_RECORD_FIELDS;
    }
    for record in &rollups {
        for field in 0..ROLLUP_FIELDS {
            scratch[cursor + field] = record[field];
        }
        cursor += ROLLUP_FIELDS;
    }
    for record in &highlights {
        for field in 0..HIGHLIGHT_FIELDS {
            scratch[cursor + field] = record[field];
        }
        cursor += HIGHLIGHT_FIELDS;
    }
    for side in 0..2 {
        scratch[cursor] = side as f64;
        cursor += 1;
        scratch[cursor] = battle.period as f64;
        cursor += 1;
        for period in 0..battle.period as usize {
            scratch[cursor] = battle
                .scoring
                .iter()
                .filter(|entry| entry[5] as usize == side && entry[2] as usize == period + 1)
                .map(|entry| entry[10])
                .fold(0.0, |total, points| total + points);
            cursor += 1;
        }
    }
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_output_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(BATTLE_SCRATCH).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_event_ptr(handle: u32) -> *const f64 {
    battle_ref(handle).map_or(core::ptr::null(), |battle| battle.events.as_ptr().cast())
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_event_count(handle: u32) -> u32 {
    battle_ref(handle).map_or(0, |battle| battle.events.len() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_scoring_ptr(handle: u32) -> *const f64 {
    battle_ref(handle).map_or(core::ptr::null(), |battle| battle.scoring.as_ptr().cast())
}
#[unsafe(no_mangle)]
pub extern "C" fn battle_scoring_count(handle: u32) -> u32 {
    battle_ref(handle).map_or(0, |battle| battle.scoring.len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_layout_ptr(handle: u32, side: u32, struck: u32) -> *const f64 {
    battle_ref(handle)
        .and_then(|b| b.layouts.get(side as usize * 2 + struck as usize))
        .and_then(|v| v.as_ref())
        .map_or(core::ptr::null(), |v| v.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn battle_run_segment(
    handle: u32,
    mut offense: u32,
    mut seconds: f64,
    first: u32,
    mut possession_id: u32,
) -> u32 {
    let mut first = first != 0;
    while seconds > 0.0 {
        if battle_consume_extra(handle, offense) < 0 && !first {
            offense = 1 - offense;
        }
        first = false;
        possession_id += 1;
        battle_begin_possession(handle, possession_id, offense);
        let ended = battle_trip(handle, offense, seconds);
        if ended >= 0xffff_fffe {
            return ended;
        }
        seconds = battle_seconds(handle);
        battle_end_possession(handle, offense);
        let changed = battle_boundary(handle);
        if changed != 0 || ended == 0 || seconds <= 0.0 {
            let output = battle_scratch();
            output[0] = offense as f64;
            output[1] = seconds;
            output[2] = possession_id as f64;
            return changed | if ended == 0 || seconds <= 0.0 { 2 } else { 0 };
        }
    }
    2
}
