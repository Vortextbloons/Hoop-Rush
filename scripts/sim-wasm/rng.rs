static mut OUTPUT: [f64; 4096] = [0.0; 4096];

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(OUTPUT).cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn fill(mut state: u32, count: u32) -> u32 {
    assert!(count <= 4096);
    for i in 0..count as usize {
        state = state.wrapping_add(0x6d2b79f5);
        let mut t = (state ^ (state >> 15)).wrapping_mul(1 | state);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        unsafe {
            output_ptr()
                .add(i)
                .write(((t ^ (t >> 14)) as f64) / 4294967296.0)
        };
    }
    state
}
