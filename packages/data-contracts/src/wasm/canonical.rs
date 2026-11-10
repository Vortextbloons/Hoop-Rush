use std::ops::Range;

static mut INPUT: Vec<u8> = Vec::new();
static mut OUTPUT: Vec<u8> = Vec::new();

#[unsafe(no_mangle)]
pub extern "C" fn reserve_input(length: u32) -> *mut u8 {
    let input = unsafe { &mut *core::ptr::addr_of_mut!(INPUT) };
    input.resize(length as usize, 0);
    input.as_mut_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    let output = unsafe { &*core::ptr::addr_of!(OUTPUT) };
    output.as_ptr()
}

enum Node {
    Leaf(Range<usize>),
    Array(Vec<usize>),
    Object(Vec<(Option<Vec<u16>>, Range<usize>, usize)>),
}

struct Parser<'a> {
    input: &'a [u8],
    cursor: usize,
    nodes: Vec<Node>,
}

impl Parser<'_> {
    fn string(&mut self) -> Option<Range<usize>> {
        let start = self.cursor;
        if self.input.get(self.cursor) != Some(&34) {
            return None;
        }
        self.cursor += 1;
        while let Some(&unit) = self.input.get(self.cursor) {
            self.cursor += 1;
            if unit == 34 {
                return Some(start..self.cursor);
            }
            if unit == 92 {
                self.cursor += 1;
                if self.cursor > self.input.len() {
                    return None;
                }
            }
        }
        None
    }

    fn key(&self, range: &Range<usize>) -> Option<Option<Vec<u16>>> {
        let raw = &self.input[range.start + 1..range.end - 1];
        if raw.iter().all(|&b| b < 128 && b != 92) {
            return Some(None);
        }
        let text = std::str::from_utf8(raw).ok()?;
        let mut chars = text.chars();
        let mut result = Vec::new();
        while let Some(ch) = chars.next() {
            if ch != '\\' {
                let mut units = [0; 2];
                result.extend_from_slice(ch.encode_utf16(&mut units));
                continue;
            }
            result.push(match chars.next()? {
                '"' => 34,
                '/' => 47,
                '\\' => 92,
                'b' => 8,
                'f' => 12,
                'n' => 10,
                'r' => 13,
                't' => 9,
                'u' => {
                    let mut value = 0;
                    for _ in 0..4 {
                        value = value * 16 + chars.next()?.to_digit(16)? as u16;
                    }
                    value
                }
                _ => return None,
            });
        }
        Some(Some(result))
    }

    fn value(&mut self, depth: usize) -> Option<usize> {
        if depth > 256 {
            return None;
        }
        let start = self.cursor;
        let node = match *self.input.get(self.cursor)? {
            34 => Node::Leaf(self.string()?),
            91 => {
                self.cursor += 1;
                let mut children = Vec::new();
                if self.input.get(self.cursor) != Some(&93) {
                    loop {
                        children.push(self.value(depth + 1)?);
                        match self.input.get(self.cursor)? {
                            44 => self.cursor += 1,
                            93 => break,
                            _ => return None,
                        }
                    }
                }
                self.cursor += 1;
                Node::Array(children)
            }
            123 => {
                self.cursor += 1;
                let mut fields = Vec::new();
                if self.input.get(self.cursor) != Some(&125) {
                    loop {
                        let range = self.string()?;
                        let key = self.key(&range)?;
                        if self.input.get(self.cursor) != Some(&58) {
                            return None;
                        }
                        self.cursor += 1;
                        let value = self.value(depth + 1)?;
                        fields.push((key, range, value));
                        match self.input.get(self.cursor)? {
                            44 => self.cursor += 1,
                            125 => break,
                            _ => return None,
                        }
                    }
                }
                self.cursor += 1;
                fields.sort_by(|left, right| {
                    let a = &self.input[left.1.start + 1..left.1.end - 1];
                    let b = &self.input[right.1.start + 1..right.1.end - 1];
                    match (&left.0, &right.0) {
                        (None, None) => a.cmp(b),
                        (Some(a), Some(b)) => a.cmp(b),
                        (Some(a), None) => a.iter().copied().cmp(b.iter().map(|&b| b as u16)),
                        (None, Some(b)) => a.iter().map(|&a| a as u16).cmp(b.iter().copied()),
                    }
                });
                Node::Object(fields)
            }
            _ => {
                while let Some(&unit) = self.input.get(self.cursor) {
                    if unit == 44 || unit == 93 || unit == 125 {
                        break;
                    }
                    self.cursor += 1;
                }
                if self.cursor == start {
                    return None;
                }
                Node::Leaf(start..self.cursor)
            }
        };
        self.nodes.push(node);
        Some(self.nodes.len() - 1)
    }

    fn write(&self, index: usize, output: &mut Vec<u8>) {
        match &self.nodes[index] {
            Node::Leaf(range) => output.extend_from_slice(&self.input[range.clone()]),
            Node::Array(children) => {
                output.push(91);
                for (i, &child) in children.iter().enumerate() {
                    if i > 0 {
                        output.push(44);
                    }
                    self.write(child, output);
                }
                output.push(93);
            }
            Node::Object(fields) => {
                output.push(123);
                for (i, (_, range, child)) in fields.iter().enumerate() {
                    if i > 0 {
                        output.push(44);
                    }
                    output.extend_from_slice(&self.input[range.clone()]);
                    output.push(58);
                    self.write(*child, output);
                }
                output.push(125);
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn canonicalize(length: u32) -> i32 {
    let input = unsafe { &*core::ptr::addr_of!(INPUT) };
    if length as usize > input.len() {
        return -1;
    }
    let mut parser = Parser {
        input: &input[..length as usize],
        cursor: 0,
        nodes: Vec::new(),
    };
    let Some(root) = parser.value(0) else {
        return -1;
    };
    if parser.cursor != length as usize {
        return -1;
    }
    let output = unsafe { &mut *core::ptr::addr_of_mut!(OUTPUT) };
    output.clear();
    parser.write(root, output);
    output.len() as i32
}
