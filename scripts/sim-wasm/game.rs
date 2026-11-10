const CAPACITY: usize = 32768;
static mut INPUT: [f64; CAPACITY] = [0.0; CAPACITY];
static mut OUTPUT: [f64; 481] = [0.0; 481];

#[unsafe(no_mangle)]
pub extern "C" fn input_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(INPUT).cast()
}
#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(OUTPUT).cast()
}

struct Reader<'a> {
    data: &'a [f64],
    cursor: usize,
}
impl<'a> Reader<'a> {
    fn array<const N: usize>(&mut self) -> [f64; N] {
        let result = self.data[self.cursor..self.cursor + N].try_into().unwrap();
        self.cursor += N;
        result
    }
    fn slice(&mut self, count: usize) -> &'a [f64] {
        let result = &self.data[self.cursor..self.cursor + count];
        self.cursor += count;
        result
    }
}
struct Team<'a> {
    initiator: [f64; 6],
    fouler: [f64; 6],
    stealer: [f64; 6],
    offensive_rebound: [f64; 6],
    defensive_rebound: [f64; 6],
    free_throw: [f64; 5],
    turnover: [f64; 5],
    steal: f64,
    rebound: [f64; 5],
    actions: &'a [f64],
    passes: &'a [f64],
    teammates: &'a [f64],
    zones: &'a [f64],
    defenders: &'a [f64],
    shots: &'a [f64],
    contests: &'a [f64],
    blocks: &'a [f64],
    fouls: &'a [f64],
    assists: &'a [f64],
}
impl<'a> Team<'a> {
    fn read(r: &mut Reader<'a>) -> Self {
        Self {
            initiator: r.array(),
            fouler: r.array(),
            stealer: r.array(),
            offensive_rebound: r.array(),
            defensive_rebound: r.array(),
            free_throw: r.array(),
            turnover: r.array(),
            steal: r.array::<1>()[0],
            rebound: r.array(),
            actions: r.slice(5 * 6 * 8),
            passes: r.slice(5 * 7),
            teammates: r.slice(5 * 7 * 5),
            zones: r.slice(5 * 7 * 6),
            defenders: r.slice(5 * 5 * 6),
            shots: r.slice(5 * 7 * 5 * 8),
            contests: r.slice(5 * 5),
            blocks: r.slice(5 * 7 * 5),
            fouls: r.slice(5 * 5 * 5),
            assists: r.slice(5 * 5 * 7 * 5),
        }
    }
}
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    fn chance(&mut self, p: f64) -> bool {
        if p <= 0.0 {
            false
        } else if p >= 1.0 {
            true
        } else {
            self.next() < p
        }
    }
    fn pick(&mut self, table: &[f64]) -> usize {
        let count = table.len() - 1;
        if table[0] <= 0.0 {
            return if count == 1 {
                0
            } else {
                (self.next() * count as f64).floor() as usize
            };
        }
        let mut roll = self.next() * table[0];
        for i in 0..count {
            if roll < table[i + 1] {
                return i;
            }
            roll -= table[i + 1];
        }
        count - 1
    }
}
struct Game<'a> {
    teams: &'a [Team<'a>; 2],
    c: &'a [f64; 14],
    rng: Rng,
    stats: [[[f64; 35]; 6]; 2],
    periods: [[f64; 30]; 2],
    period: usize,
    remaining: f64,
    period_fouls: [usize; 2],
    start: usize,
}
impl Game<'_> {
    fn add(&mut self, side: usize, player: usize, field: usize) {
        self.stats[side][0][field] += 1.0;
        self.stats[side][player + 1][field] += 1.0;
    }
    fn points(&mut self, side: usize, player: usize, points: f64) {
        self.stats[side][0][0] += points;
        self.stats[side][player + 1][0] += points;
        self.periods[side][self.period] += points;
    }
    fn consume(&mut self, seconds: f64) -> f64 {
        let consumed = seconds.min(self.remaining);
        self.remaining -= consumed;
        consumed
    }
    fn avoidance(&self, side: usize, player: usize) -> f64 {
        let trouble = (self.stats[side][player + 1][13] - self.c[8]).max(0.0);
        self.c[10].max(1.0 - self.c[9] * trouble * trouble)
    }
    fn foul(&mut self, side: usize, player: usize) {
        self.add(side, player, 13);
        self.period_fouls[side] += 1;
    }
    fn fouler(&mut self, side: usize) -> usize {
        loop {
            let player = self.rng.pick(&self.teams[side].fouler);
            if self.rng.chance(self.avoidance(side, player)) {
                return player;
            }
        }
    }
    fn rebound(&mut self, side: usize, zone: usize, dead: bool) -> bool {
        let defense = 1 - side;
        if dead {
            self.stats[defense][0][14] += 1.0;
            self.start = 2;
            return false;
        }
        self.stats[side][0][17] += 1.0;
        for player in 1..6 {
            self.stats[side][player][21] += 1.0;
            self.stats[defense][player][22] += 1.0;
        }
        if self.rng.chance(self.teams[side].rebound[zone]) {
            let player = self.rng.pick(&self.teams[side].offensive_rebound);
            self.add(side, player, 7);
            self.start = 5;
            true
        } else {
            let player = self.rng.pick(&self.teams[defense].defensive_rebound);
            self.add(defense, player, 8);
            self.start = 4;
            false
        }
    }
    fn free_throws(&mut self, side: usize, player: usize, attempts: usize, dead: bool) -> bool {
        let mut continues = false;
        for i in 0..attempts {
            let made = self.rng.chance(self.teams[side].free_throw[player]);
            self.add(side, player, 6);
            if made {
                self.add(side, player, 5);
                self.points(side, player, 1.0);
            } else if i == attempts - 1 {
                continues = self.rebound(side, 0, dead);
            } else {
                self.stats[1 - side][0][14] += 1.0;
            }
        }
        self.stats[side][0][16] += 1.0;
        continues
    }
    fn field_goal(&mut self, side: usize, player: usize, zone: usize, made: bool, passed: bool) {
        self.add(side, player, 2);
        self.add(side, player, 25 + zone);
        if zone >= 3 {
            self.add(side, player, 4);
        }
        if made {
            self.add(side, player, 1);
            self.add(side, player, 30 + zone);
            if zone >= 3 {
                self.add(side, player, 3);
            }
            self.stats[side][0][if passed { 18 } else { 19 }] += 1.0;
            self.points(side, player, if zone >= 3 { 3.0 } else { 2.0 });
        }
    }
    fn assist(
        &mut self,
        side: usize,
        initiator: usize,
        shooter: usize,
        action: usize,
        zone: usize,
        passed: bool,
    ) {
        if !passed {
            return;
        }
        self.stats[side][initiator + 1][20] += 1.0;
        let index = ((initiator * 5 + shooter) * 7 + action) * 5 + zone;
        if self.rng.chance(self.teams[side].assists[index]) {
            self.add(side, initiator, 9);
        }
    }
    fn shot(&mut self, side: usize, handler: Option<usize>, dead: bool) -> bool {
        let defense = 1 - side;
        let initiator = handler.unwrap_or_else(|| self.rng.pick(&self.teams[side].initiator));
        let offset = (initiator * 6 + self.start) * 8;
        let action = self.rng.pick(&self.teams[side].actions[offset..offset + 8]);
        let passed = self
            .rng
            .chance(self.teams[side].passes[initiator * 7 + action]);
        let shooter = if passed {
            let offset = (initiator * 7 + action) * 5;
            let index = self
                .rng
                .pick(&self.teams[side].teammates[offset..offset + 5]);
            if index >= initiator { index + 1 } else { index }
        } else {
            initiator
        };
        let offset = (shooter * 7 + action) * 6;
        let zone = self.rng.pick(&self.teams[side].zones[offset..offset + 6]);
        let offset = (zone * 5 + shooter) * 6;
        let defender = self
            .rng
            .pick(&self.teams[side].defenders[offset..offset + 6]);
        self.stats[defense][defender + 1][23] += 1.0;
        let offset = ((shooter * 7 + action) * 5 + zone) * 8;
        let values: [f64; 8] = self.teams[side].shots[offset..offset + 8]
            .try_into()
            .unwrap();
        let [
            base,
            skill,
            era,
            spacing,
            quality,
            floor,
            calibration,
            anchored,
        ] = values;
        let contest = self.teams[side].contests[defender * 5 + zone];
        let prefix = base + skill + contest + era + spacing + quality;
        let block = self.teams[side].blocks[(defender * 7 + action) * 5 + zone];
        let foul = self.teams[side].fouls[(shooter * 5 + defender) * 5 + zone];
        let late = if self.remaining <= 4.0 {
            -(0.04 + ((4.0 - self.remaining) / 4.0).clamp(0.0, 1.0) * 0.06)
        } else {
            0.0
        };
        let base = 0.97_f64.min(floor.max(0.03_f64.max(prefix + late + calibration + 0.0 + 0.0)));
        let drawn = self.rng.chance(foul) && self.rng.chance(self.avoidance(defense, defender));
        if drawn {
            self.foul(defense, defender);
            let made = self.rng.chance(base * self.c[13]);
            self.field_goal(side, shooter, zone, made, passed);
            let continues = if made {
                self.assist(side, initiator, shooter, action, zone, passed);
                // A missed and-one is live even if the field goal used the final clock time.
                self.start = 2;
                self.free_throws(side, shooter, 1, false)
            } else {
                self.stats[defense][0][14] += 1.0;
                self.start = 2;
                self.free_throws(side, shooter, if zone >= 3 { 3 } else { 2 }, dead)
            };
            return continues;
        }
        if self.rng.chance(block) {
            self.add(defense, defender, 11);
            self.field_goal(side, shooter, zone, false, passed);
            return self.rebound(side, zone, dead);
        }
        let probability = if anchored != 0.0 && zone < 3 {
            0.97_f64.min(base / 0.5_f64.max(1.0 - block))
        } else {
            base
        };
        let made = self.rng.chance(probability);
        self.field_goal(side, shooter, zone, made, passed);
        if made {
            self.assist(side, initiator, shooter, action, zone, passed);
            self.start = 1;
            false
        } else {
            self.rebound(side, zone, dead)
        }
    }
    fn trip(&mut self, side: usize) -> bool {
        if self.remaining < self.c[1] {
            return false;
        }
        let began = self.remaining;
        let raw = self.c[0] * (0.6 + self.rng.next() * 0.8);
        let sampled = raw.max(self.c[2]).min(self.c[3]).min(self.remaining);
        let consumed = self.consume(sampled);
        let dead = consumed >= began - self.c[1];
        let defense = 1 - side;
        let handler = self.rng.pick(&self.teams[side].initiator);
        if self.rng.chance(self.teams[side].turnover[handler]) {
            self.add(side, handler, 12);
            if self.rng.chance(self.teams[defense].steal) {
                let stealer = self.rng.pick(&self.teams[defense].stealer);
                self.add(defense, stealer, 10);
            }
            self.start = 3;
            self.stats[side][0][15] += 1.0;
            return true;
        }
        let mut bonus_continuation = false;
        for _ in 0..4 {
            if !self.rng.chance(self.c[6]) {
                break;
            }
            if self.rng.chance(self.c[7]) {
                let fouler = self.fouler(side);
                self.foul(side, fouler);
                self.add(side, fouler, 12);
                self.stats[side][0][15] += 1.0;
                self.start = 2;
                return true;
            }
            let fouler = self.fouler(defense);
            self.foul(defense, fouler);
            let limit = if self.period >= 4 {
                self.c[12]
            } else {
                self.c[11]
            };
            if self.period_fouls[defense] as f64 >= limit {
                self.start = 2;
                if !self.free_throws(side, handler, 2, dead) {
                    self.stats[side][0][15] += 1.0;
                    return true;
                }
                bonus_continuation = true;
                break;
            }
            self.consume(self.c[4]);
        }
        let mut continuations = 0;
        if bonus_continuation {
            continuations += 1;
            self.consume(self.c[5]);
            if self.remaining < self.c[1] {
                self.stats[side][0][15] += 1.0;
                return true;
            }
        }
        loop {
            let continues = self.shot(
                side,
                if continuations == 0 {
                    Some(handler)
                } else {
                    None
                },
                dead,
            );
            if !continues || continuations >= 4 {
                break;
            }
            continuations += 1;
            self.consume(self.c[5]);
            if self.remaining < self.c[1] {
                break;
            }
        }
        self.stats[side][0][15] += 1.0;
        true
    }
    fn play(&mut self) -> usize {
        let mut side = if self.rng.chance(0.5) { 0 } else { 1 };
        for period in 0..30 {
            if period >= 4 && self.stats[0][0][0] != self.stats[1][0][0] {
                return period;
            }
            self.period = period;
            self.period_fouls = [0; 2];
            self.remaining = if period < 4 { 720.0 } else { 300.0 };
            if period > 0 {
                self.start = 0;
            }
            while self.remaining > 0.0 {
                let began = self.remaining;
                if self.trip(side) {
                    side = 1 - side;
                } else if self.remaining == began {
                    break;
                }
            }
        }
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn simulate(seed: u32, length: u32) -> u32 {
    if length as usize > CAPACITY {
        return 1;
    }
    let data = unsafe { core::slice::from_raw_parts(input_ptr(), length as usize) };
    let mut reader = Reader { data, cursor: 0 };
    let constants = reader.array::<14>();
    let teams = [Team::read(&mut reader), Team::read(&mut reader)];
    if reader.cursor != length as usize {
        return 2;
    }
    let mut game = Game {
        teams: &teams,
        c: &constants,
        rng: Rng(seed),
        stats: [[[0.0; 35]; 6]; 2],
        periods: [[0.0; 30]; 2],
        period: 0,
        remaining: 720.0,
        period_fouls: [0; 2],
        start: 0,
    };
    let periods = game.play();
    if periods == 0 {
        return 3;
    }
    let output = unsafe { core::slice::from_raw_parts_mut(output_ptr(), 481) };
    output[0] = periods as f64;
    let mut cursor = 1;
    for side in 0..2 {
        for stats in &game.stats[side] {
            output[cursor..cursor + 35].copy_from_slice(stats);
            cursor += 35;
        }
        output[cursor..cursor + 30].copy_from_slice(&game.periods[side]);
        cursor += 30;
    }
    0
}
